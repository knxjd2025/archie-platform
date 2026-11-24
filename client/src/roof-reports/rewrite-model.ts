/**
 * The Rewrite buttons on a finding and on the summary, as plain functions with no
 * screen: what is drawn after each step, and the one call a press makes. The
 * screen only draws this and carries it out.
 *
 * A press is answered in the frame it was made in: that one field says
 * "Rewriting..." and nothing else on the page moves. When the new text lands, the
 * old text is kept so "Undo rewrite" can put it back (through the ordinary save of
 * that field, so the report is changed the one usual way). Typing in the field
 * yourself forgets the undo. One rewrite at a time. A failure is one plain
 * sentence on that field and changes nothing.
 */
import type { FieldKey } from './editor-model';
import { RR, plainMessage } from './words';

export type RewritePhase = 'idle' | 'rewriting' | 'done' | 'failed';
export interface RewriteField { phase: RewritePhase; error: string | null; /** The text before the last rewrite, to undo to. */ previous: string | null }
export type RewriteMap = Partial<Record<FieldKey, RewriteField>>;

export const idleRewrite = (): RewriteField => ({ phase: 'idle', error: null, previous: null });
export const initialRewrites = (): RewriteMap => ({});
export const rewriteStateOf = (map: RewriteMap, key: FieldKey): RewriteField => map[key] ?? idleRewrite();
export const rewriteBusy = (map: RewriteMap): boolean => Object.values(map).some((f) => f?.phase === 'rewriting');

export type RewriteAction =
  | { type: 'start'; key: FieldKey }
  | { type: 'done'; key: FieldKey; previous: string }
  | { type: 'failed'; key: FieldKey; error: string }
  | { type: 'clear'; key: FieldKey }
  | { type: 'reset' };

export function rewriteReducer(map: RewriteMap, a: RewriteAction): RewriteMap {
  if (a.type === 'reset') return {};
  if (a.type === 'clear') { const { [a.key]: _gone, ...rest } = map; return rest; }
  const now = rewriteStateOf(map, a.key);
  switch (a.type) {
    case 'start': return { ...map, [a.key]: { phase: 'rewriting', error: null, previous: now.previous } };
    case 'done': return { ...map, [a.key]: { phase: 'done', error: null, previous: a.previous } };
    case 'failed': return { ...map, [a.key]: { phase: 'failed', error: a.error, previous: now.previous } };
  }
}

export type RewriteResult =
  | { type: 'done'; key: FieldKey; previous: string; text: string; report: Record<string, unknown> }
  | { type: 'failed'; key: FieldKey; error: string };

/** Asks for the rewrite, and says what happened. The answer must be a rewrite with its new text and the report as it now stands. */
export async function submitRewrite(deps: { call: () => Promise<unknown> }, key: FieldKey, previous: string): Promise<RewriteResult> {
  try {
    const answer = await deps.call() as { status?: unknown; text?: unknown; report?: unknown } | null;
    const report = answer?.report;
    if (answer && answer.status === 'rewritten' && typeof answer.text === 'string' && answer.text.length > 0 && report && typeof report === 'object' && !Array.isArray(report)) {
      return { type: 'done', key, previous, text: answer.text, report: report as Record<string, unknown> };
    }
    return { type: 'failed', key, error: RR.rewrite.failed };
  } catch (e) {
    return { type: 'failed', key, error: plainMessage(e, RR.rewrite.failed) };
  }
}
