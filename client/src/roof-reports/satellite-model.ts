/**
 * What "Find it from the satellite" does to the roof step, as plain functions with no screen.
 *
 * The result only PREFILLS. A field that is empty is filled and marked as an
 * estimate; a field the person already typed is never overwritten: it is kept,
 * and the person is asked whether to use the estimate instead. The mark lives
 * in the draft (`RoofDraft.estimate`) and goes the moment the person changes
 * that field, so "Estimated from a satellite picture. Check these numbers." is
 * said only while it is still true.
 */
import { ROOF_PITCH_CHOICES, ROOF_SQUARES_MAX, SATELLITE_ESTIMATE_NOTE, SATELLITE_NOT_FOUND } from '../../../shared/roof-reports';
import type { RoofDraft, WhereDraft } from './draft';
import { RR, plainMessage } from './words';

export interface SatelliteEstimate { squares: number; pitch: string | null }
/** The estimate's text for each field the person had already typed into, which was kept. */
export interface PendingEstimate { squares?: string; pitch?: string }

/** The address from the draft, and nothing else: no job, no customer, no numbers. */
export function whereBody(w: WhereDraft): { address: string; city: string; state: string; zip: string } {
  return { address: w.address.trim(), city: w.city.trim(), state: w.state.trim(), zip: w.zip.trim() };
}

const squaresText = (n: number): string => String(Math.round(n * 10) / 10);

/** Fills the empty fields, marks them, and keeps (and reports) any field the person typed that the estimate would change. */
export function applyEstimate(roof: RoofDraft, est: SatelliteEstimate): { roof: RoofDraft; pending: PendingEstimate | null } {
  const next: RoofDraft = { ...roof };
  const marks = { squares: roof.estimate?.squares ?? '', pitch: roof.estimate?.pitch ?? '' };
  const pending: PendingEstimate = {};
  const wanted: Array<['squares' | 'pitch', string | null]> = [['squares', squaresText(est.squares)], ['pitch', est.pitch]];
  for (const [field, value] of wanted) {
    if (value === null) continue;
    const typed = roof[field].trim();
    if (typed === '') { next[field] = value; marks[field] = value; }
    else if (field === 'squares' ? Number(typed) !== Number(value) : typed !== value) pending[field] = value;
  }
  if (marks.squares || marks.pitch) next.estimate = marks; else delete next.estimate;
  return { roof: next, pending: Object.keys(pending).length ? pending : null };
}

/** The person chose the estimate: it goes in over what was typed, and is marked. */
export function useEstimate(roof: RoofDraft, pending: PendingEstimate): RoofDraft {
  const marks = { squares: roof.estimate?.squares ?? '', pitch: roof.estimate?.pitch ?? '' };
  const next: RoofDraft = { ...roof };
  for (const field of ['squares', 'pitch'] as const) {
    const value = pending[field];
    if (value !== undefined) { next[field] = value; marks[field] = value; }
  }
  if (marks.squares || marks.pitch) next.estimate = marks;
  return next;
}

/** The roof after the person changes something: a field they changed is theirs now, so it is no longer an estimate. */
export function editedRoof(roof: RoofDraft, patch: Partial<RoofDraft>): RoofDraft {
  const next: RoofDraft = { ...roof, ...patch };
  delete next.estimate;
  const old = roof.estimate;
  if (!old) return next;
  const marks = { squares: next.squares === roof.squares ? old.squares : '', pitch: next.pitch === roof.pitch ? old.pitch : '' };
  if (marks.squares || marks.pitch) next.estimate = marks;
  return next;
}

/** The sentence to put beside the numbers: said while any field still holds the text the satellite gave it. */
export function estimateNote(roof: RoofDraft): string | null {
  const e = roof.estimate;
  if (!e) return null;
  return (e.squares !== '' && roof.squares === e.squares) || (e.pitch !== '' && roof.pitch === e.pitch) ? SATELLITE_ESTIMATE_NOTE : null;
}

export type EstimateRead = { ok: true; estimate: SatelliteEstimate; confidence: 'high' | 'medium' | 'low' | null } | { ok: false; message: string };

/** What the server answered, accepted only when it is an estimate this form can hold. */
export function readEstimate(body: unknown): EstimateRead {
  const fail: EstimateRead = { ok: false, message: SATELLITE_NOT_FOUND };
  const e = body && typeof body === 'object' ? (body as { estimate?: unknown; confidence?: unknown }).estimate : null;
  if (!e || typeof e !== 'object') return fail;
  const { squares, pitch } = e as { squares?: unknown; pitch?: unknown };
  if (typeof squares !== 'number' || !Number.isFinite(squares) || squares <= 0 || squares > ROOF_SQUARES_MAX) return fail;
  if (pitch !== null && (typeof pitch !== 'string' || !(ROOF_PITCH_CHOICES as readonly string[]).includes(pitch))) return fail;
  const c = (body as { confidence?: unknown }).confidence;
  return { ok: true, estimate: { squares, pitch: pitch as string | null }, confidence: c === 'high' || c === 'medium' || c === 'low' ? c : null };
}

export type FindState =
  | { phase: 'idle' }
  | { phase: 'failed'; message: string }
  | { phase: 'choose'; pending: PendingEstimate };

/**
 * One press, after "Looking..." is already on the screen. The roof is read at the moment the answer arrives (not when
 * the press began), so what the person typed while it looked is what is kept. A field they typed is never overwritten;
 * the question for them comes back with the answer.
 */
export async function findRoof(args: {
  where: WhereDraft;
  getRoof: () => RoofDraft;
  setRoof: (roof: RoofDraft) => void;
  detect: (body: ReturnType<typeof whereBody>, key: string) => Promise<unknown>;
  key: () => string;
}): Promise<{ state: FindState; confidence: 'high' | 'medium' | 'low' | null }> {
  try {
    const read = readEstimate(await args.detect(whereBody(args.where), args.key()));
    if (!read.ok) return { state: { phase: 'failed', message: read.message }, confidence: null };
    const applied = applyEstimate(args.getRoof(), read.estimate);
    args.setRoof(applied.roof);
    return { state: applied.pending ? { phase: 'choose', pending: applied.pending } : { phase: 'idle' }, confidence: read.confidence };
  } catch (e) {
    return { state: { phase: 'failed', message: plainMessage(e, RR.satellite.failed) }, confidence: null };
  }
}
