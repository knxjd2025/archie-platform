/**
 * The press of "Find it from the satellite", kept at the wizard (not the roof step) so the answer still lands in the draft if the
 * person moves to another step while it is looking. The button says it is looking in the same frame as the press; one press at a time.
 */
import { useCallback, useRef, useState } from 'react';
import { detectRoof } from './api';
import type { RoofDraft, WhereDraft } from './draft';
import { applyEstimate, readEstimate, useEstimate, whereBody, type PendingEstimate } from './satellite-model';
import { RR, plainMessage } from './words';

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

export function useSatellite(where: WhereDraft, setRoof: (change: (roof: RoofDraft) => RoofDraft) => void) {
  const [state, setState] = useState<SatelliteState>({ phase: 'idle' });
  const [confidence, setConfidence] = useState<'high' | 'medium' | 'low' | null>(null);
  const busy = useRef(false);
  const latestWhere = useRef(where);
  latestWhere.current = where;
  const pendingRef = useRef<PendingEstimate | null>(null);

  const find = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setState({ phase: 'looking' }); // said in the frame of the press, before anything is asked
    setConfidence(null);
    try {
      const read = readEstimate(await detectRoof(whereBody(latestWhere.current), pressKey()));
      if (!read.ok) { setState({ phase: 'failed', message: read.message }); return; }
      let asked: PendingEstimate | null = null;
      setRoof((roof) => { const r = applyEstimate(roof, read.estimate); asked = r.pending; return r.roof; });
      setConfidence(read.confidence);
      pendingRef.current = asked;
      setState(asked ? { phase: 'choose', pending: asked } : { phase: 'idle' });
    } catch (e) {
      setState({ phase: 'failed', message: plainMessage(e, RR.satellite.failed) });
    } finally {
      busy.current = false;
    }
  }, [setRoof]);

  const use = useCallback(() => {
    const pending = pendingRef.current;
    if (pending) setRoof((roof) => useEstimate(roof, pending));
    pendingRef.current = null;
    setState({ phase: 'idle' });
  }, [setRoof]);

  const keep = useCallback(() => { pendingRef.current = null; setState({ phase: 'idle' }); }, []);

  return { state, confidence, find, use, keep };
}
