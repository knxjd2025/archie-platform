/**
 * The press of "Find it from the satellite", kept at the wizard (not the roof step) so the answer still lands in the draft if the
 * person moves to another step while it is looking. The button says it is looking in the same frame as the press; one press at a time.
 */
import { useCallback, useRef, useState } from 'react';
import { detectRoof } from './api';
import type { RoofDraft, WhereDraft } from './draft';
import { findRoof, useEstimate, type PendingEstimate } from './satellite-model';

export type SatelliteState =
  | { phase: 'idle' }
  | { phase: 'looking' }
  | { phase: 'failed'; message: string }
  | { phase: 'choose'; pending: PendingEstimate };

/** A request key for one press: the same press repeated is not paid for twice, a new press is a new key. */
function pressKey(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `sat-${random}`;
}

export function useSatellite(where: WhereDraft, roof: RoofDraft, setRoof: (roof: RoofDraft) => void) {
  const [state, setState] = useState<SatelliteState>({ phase: 'idle' });
  const [confidence, setConfidence] = useState<'high' | 'medium' | 'low' | null>(null);
  const busy = useRef(false);
  // What the screen holds right now, read when the answer arrives.
  const latest = useRef({ where, roof, setRoof });
  latest.current = { where, roof, setRoof };
  const pendingRef = useRef<PendingEstimate | null>(null);

  const find = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setState({ phase: 'looking' }); // said in the frame of the press, before anything is asked
    setConfidence(null);
    const r = await findRoof({ where: latest.current.where, getRoof: () => latest.current.roof, setRoof: (next) => latest.current.setRoof(next), detect: detectRoof, key: pressKey });
    pendingRef.current = r.state.phase === 'choose' ? r.state.pending : null;
    setConfidence(r.confidence);
    setState(r.state);
    busy.current = false;
  }, []);

  const use = useCallback(() => {
    const pending = pendingRef.current;
    if (pending) latest.current.setRoof(useEstimate(latest.current.roof, pending));
    pendingRef.current = null;
    setState({ phase: 'idle' });
  }, []);

  const keep = useCallback(() => { pendingRef.current = null; setState({ phase: 'idle' }); }, []);

  return { state, confidence, find, use, keep };
}
