/**
 * The pieces every pipeline shares: an ordered stage list, optional ordered
 * steps inside a stage (trades on a production job, dispute steps on a
 * claim), tick-boxes a stage asks for, and the forward-move rule — moving
 * back is always allowed, moving forward checks the entry gate of every
 * stage crossed so skipping a column can't skip its requirements.
 */
export interface StageDef { key: string; label: string; hint: string }
export interface StepDef { key: string; label: string }
export interface Step { key: string; done: boolean }
export interface CheckDef { key: string; label: string }

export function indexOf(stages: readonly StageDef[], key: string): number {
  return stages.findIndex((s) => s.key === key);
}
export function labelOf(stages: readonly StageDef[], key: string): string {
  return stages.find((s) => s.key === key)?.label ?? key;
}
export function nextOf(stages: readonly StageDef[], key: string): string | null {
  const i = indexOf(stages, key);
  return i >= 0 && i < stages.length - 1 ? stages[i + 1].key : null;
}
export function prevOf(stages: readonly StageDef[], key: string): string | null {
  const i = indexOf(stages, key);
  return i > 0 ? stages[i - 1].key : null;
}

/**
 * Why a move from `from` to `to` isn't allowed, or null. `entryBlocker`
 * answers for one stage; this walks every stage strictly after `from` up to
 * and including `to`.
 */
export function moveBlocker(stages: readonly StageDef[], from: string, to: string, entryBlocker: (stage: string) => string | null): string | null {
  const a = indexOf(stages, from);
  const b = indexOf(stages, to);
  if (b < 0) return 'Unknown stage.';
  if (b <= a) return null;
  for (let i = a + 1; i <= b; i++) {
    const why = entryBlocker(stages[i].key);
    if (why) return why;
  }
  return null;
}

/** Valid keys only, catalog order, no duplicates; `fallback` when nothing valid was given. */
export function normalizeSteps(catalog: readonly StepDef[], input: unknown, prior: Step[] = [], fallback: string[] = []): Step[] {
  const wanted = new Set<string>();
  if (Array.isArray(input)) for (const k of input) if (typeof k === 'string' && catalog.some((c) => c.key === k)) wanted.add(k);
  if (!wanted.size) for (const k of fallback) wanted.add(k);
  const priorDone = new Map(prior.map((p) => [p.key, p.done]));
  return catalog.filter((c) => wanted.has(c.key)).map((c) => ({ key: c.key, done: priorDone.get(c.key) ?? false }));
}
export const currentStep = (steps: Step[]): string | null => steps.find((s) => !s.done)?.key ?? null;
export const allStepsDone = (steps: Step[]): boolean => steps.length > 0 && steps.every((s) => s.done);
export function completeCurrentStep(steps: Step[]): Step[] {
  const cur = currentStep(steps);
  return steps.map((s) => (s.key === cur ? { ...s, done: true } : s));
}
/** Jump to a step: everything before it done, it and everything after open. */
export function jumpToStep(steps: Step[], key: string): Step[] {
  const i = steps.findIndex((s) => s.key === key);
  if (i < 0) return steps;
  return steps.map((s, j) => ({ ...s, done: j < i }));
}

export function missingChecks(defs: CheckDef[] | undefined, checks: Record<string, boolean>): string[] {
  return (defs || []).filter((c) => !checks?.[c.key]).map((c) => c.label);
}
