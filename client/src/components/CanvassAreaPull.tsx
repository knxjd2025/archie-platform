/**
 * Draw an area on the canvass map, filter it for roofing prospects, preview
 * the count and cost for free, then pull every home's owner contact info.
 * The paid step is one explicit button that states the cost.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ROOFING_PRESETS, filtersForPreset, usd, type AreaFilters, type AreaShape, CREDITS_PER_LEAD_ROW, MAX_ROWS_PER_PULL } from '../../../shared/canvass-areas';

export interface TracerfyStatus { configured: boolean; sandbox?: boolean; balance?: number; costs?: { leadRow: number; propertyLookup: number; maxRows: number } }
export interface AreaRow { id: number; name: string; status: string; requestedCount: number | null; deliveredCount: number | null; inAreaCount: number | null; creditsDeducted: number | null; error: string | null; createdAt: string | null; shape: AreaShape }
interface Preview { matchesInRadius: number; willDeliver: number; credits: number; usd: number; pins: Array<{ lat: number; lng: number; inside: boolean }>; pinsInside: number; pinsSampled: number; geography: { radius: number } }

interface Props {
  shape: AreaShape | null;
  onClearShape: () => void;
  status: TracerfyStatus | null;
  onPreview: (pins: Preview['pins']) => void;
  onPulled: (area: AreaRow) => void;
  flash: (m: string) => void;
}

const MAX_POLL_FAILURES = 5;

export default function CanvassAreaPull({ shape, onClearShape, status, onPreview, onPulled, flash }: Props) {
  const [filters, setFilters] = useState<AreaFilters>(filtersForPreset('aging_roofs'));
  const [count, setCount] = useState(100);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'pull' | null>(null);
  const [pulling, setPulling] = useState<AreaRow | null>(null);
  const [progress, setProgress] = useState<string>('');

  useEffect(() => { setPreview(null); onPreview([]); }, [shape]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPreset = (preset: string) => setFilters(filtersForPreset(preset));
  const upd = (patch: Partial<AreaFilters>) => setFilters((f) => ({ ...f, ...patch, preset: 'custom' }));

  const runPreview = async () => {
    if (!shape) return;
    setBusy('preview');
    try {
      const r = await api.post<Preview>('/api/canvass/areas/preview', { shape, filters, requestedCount: count });
      setPreview(r);
      onPreview(r.pins || []);
    } catch (e: any) { flash(e?.message || 'Preview failed.'); }
    finally { setBusy(null); }
  };

  const pull = async () => {
    if (!shape || !preview) return;
    const n = Math.min(preview.willDeliver, count);
    if (!window.confirm(`Pull owner contact info for up to ${n} homes? Up to ${preview.credits} credits (${usd(preview.credits)}). Misses are free.`)) return;
    // Cancel on the name box means stop. It used to fall through as "no name"
    // and start the paid pull anyway.
    const named = window.prompt('Name this area (so the list can be filtered to it):', `Area ${new Date().toLocaleDateString('en-US')}`);
    if (named === null) return;
    const name = named.trim() || undefined;
    setBusy('pull');
    try {
      const r = await api.post<{ area: AreaRow }>('/api/canvass/areas', { shape, filters, requestedCount: count, previewCount: preview.matchesInRadius, name });
      setPulling(r.area);
      setProgress('Tracerfy is building the list…');
    } catch (e: any) { flash(e?.message || 'Could not start the pull.'); setBusy(null); }
  };

  // Poll the running pull; the server imports the rows once Tracerfy is done.
  // A failed poll is retried, but not forever: a phone that lost signal kept
  // waking every 3s for as long as the page was open, with the buttons stuck
  // on "pulling". After a run of failures we stop, free the buttons and say
  // so — the pull itself carries on server-side and lands in the areas list.
  useEffect(() => {
    if (!pulling) return;
    let stop = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const r = await api.get<{ area: AreaRow; progress?: { percent: number | null; stage: string }; imported?: { delivered: number; inArea: number; taken?: number } }>(`/api/canvass/areas/${pulling.id}`);
        if (stop) return;
        if (r.area.status === 'complete') {
          setPulling(null); setBusy(null); setProgress('');
          const taken = r.imported?.taken ?? 0;
          flash(`Pulled ${r.area.deliveredCount ?? r.imported?.delivered ?? 0} homes — ${r.area.inAreaCount ?? r.imported?.inArea ?? 0} inside your drawing.${taken ? ` ${taken} already belong to another rep and stay theirs.` : ''}`);
          onPulled(r.area); onClearShape();
          return;
        }
        if (r.area.status === 'failed') { setPulling(null); setBusy(null); setProgress(''); flash(`Pull failed: ${r.area.error || 'unknown'}`); return; }
        failures = 0;
        setProgress(r.area.status === 'importing' ? 'Saving the homes to your list…' : `Tracerfy: ${r.progress?.stage || 'working'}${r.progress?.percent != null ? ` · ${r.progress.percent}%` : ''}`);
      } catch (e: any) {
        if (stop) return;
        failures += 1;
        if (failures >= MAX_POLL_FAILURES) {
          setPulling(null); setBusy(null); setProgress('');
          flash(`Lost track of the pull (${e?.message || 'no connection'}). It keeps running — check your areas list in a minute.`);
          return;
        }
      }
      if (!stop) timer = setTimeout(tick, 3000);
    };
    tick();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [pulling]); // eslint-disable-line react-hooks/exhaustive-deps

  const input = 'text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white w-full';

  if (status && !status.configured) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <b>Tracerfy isn't connected.</b> An admin adds <code className="bg-white/70 rounded px-1">TRACERFY_API_KEY</code> to the deployment; then you can draw an area and pull owner contacts.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">🎯 Pull owners in an area</h3>
          <p className="text-xs text-gray-500">{shape ? `Area drawn (${shape.type}). Set the filters, preview for free, then pull.` : 'Use the drawing tools on the map (polygon, rectangle or circle) to outline a neighbourhood.'}</p>
        </div>
        {status?.balance != null && <span className="text-xs text-gray-500 whitespace-nowrap" title={status.sandbox ? 'Sandbox data' : ''}>{status.balance.toLocaleString()} credits{status.sandbox ? ' · sandbox' : ''}</span>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {Object.entries(ROOFING_PRESETS).map(([k, p]) => (
          <button key={k} type="button" onClick={() => setPreset(k)} title={p.blurb} className={`text-xs px-2.5 py-1.5 rounded-full border ${filters.preset === k ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600'}`}>{p.label}</button>
        ))}
      </div>
      <p className="text-xs text-gray-500">{ROOFING_PRESETS[filters.preset]?.blurb ?? 'Custom filters.'}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="text-xs text-gray-600">Property
          <select value={filters.propertyType ?? 'SFR'} onChange={(e) => upd({ propertyType: e.target.value as any })} className={input}>
            <option value="SFR">Single-family</option><option value="MFH">Multi-family</option><option value="CONDO">Condo / town</option><option value="ANY">Any</option>
          </select>
        </label>
        <label className="text-xs text-gray-600">Built before
          <input type="number" inputMode="numeric" value={filters.yearBuiltMax ?? ''} onChange={(e) => upd({ yearBuiltMax: e.target.value ? Number(e.target.value) : null })} placeholder="e.g. 2011" className={input} />
        </label>
        <label className="text-xs text-gray-600">Built after
          <input type="number" inputMode="numeric" value={filters.yearBuiltMin ?? ''} onChange={(e) => upd({ yearBuiltMin: e.target.value ? Number(e.target.value) : null })} placeholder="optional" className={input} />
        </label>
        <label className="text-xs text-gray-600">Who lives there
          <select value={filters.ownerOccupied === true ? 'owner' : filters.ownerOccupied === false ? 'absentee' : 'any'} onChange={(e) => upd({ ownerOccupied: e.target.value === 'owner' ? true : e.target.value === 'absentee' ? false : null })} className={input}>
            <option value="owner">Owner lives there</option><option value="absentee">Absentee / landlord</option><option value="any">Either</option>
          </select>
        </label>
        <label className="text-xs text-gray-600">Value from
          <input type="number" inputMode="decimal" value={filters.valueMin ?? ''} onChange={(e) => upd({ valueMin: e.target.value ? Number(e.target.value) : null })} placeholder="$" className={input} />
        </label>
        <label className="text-xs text-gray-600">Value to
          <input type="number" inputMode="decimal" value={filters.valueMax ?? ''} onChange={(e) => upd({ valueMax: e.target.value ? Number(e.target.value) : null })} placeholder="$" className={input} />
        </label>
        <label className="text-xs text-gray-600">Owned at least (yrs)
          <input type="number" inputMode="numeric" value={filters.yearsOwnedMin ?? ''} onChange={(e) => upd({ yearsOwnedMin: e.target.value ? Number(e.target.value) : null })} placeholder="optional" className={input} />
        </label>
        <label className="text-xs text-gray-600">Roof score at least
          <input type="number" inputMode="numeric" min={0} max={100} value={filters.roofScoreMin ?? ''} onChange={(e) => upd({ roofScoreMin: e.target.value ? Number(e.target.value) : null })} placeholder="0–100" className={input} />
        </label>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-gray-700">
        <label className="flex items-center gap-1"><input type="checkbox" checked={!!filters.highEquity} onChange={(e) => upd({ highEquity: e.target.checked })} /> High equity</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={!!filters.freeClear} onChange={(e) => upd({ freeClear: e.target.checked })} /> Paid off (free &amp; clear)</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={!!filters.excludeListed} onChange={(e) => upd({ excludeListed: e.target.checked })} /> Skip homes on the market</label>
        <label className="flex items-center gap-1">Up to <input type="number" inputMode="numeric" min={1} max={MAX_ROWS_PER_PULL} value={count} onChange={(e) => setCount(Math.min(Math.max(Number(e.target.value) || 1, 1), MAX_ROWS_PER_PULL))} className="w-20 text-sm border border-gray-200 rounded-lg px-2 py-1" /> homes</label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={runPreview} disabled={!shape || busy !== null} className="text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-800 font-medium hover:bg-gray-200 disabled:opacity-50">{busy === 'preview' ? 'Counting…' : '👀 Preview (free)'}</button>
        {preview && (
          <span className="text-xs text-gray-600">
            <b>{preview.matchesInRadius.toLocaleString()}</b> match within {preview.geography.radius} mi · you'd get <b>{preview.willDeliver}</b> · up to <b>{preview.credits} credits ({usd(preview.credits)})</b>
            {preview.pinsSampled > 0 && <> · sample: {preview.pinsInside}/{preview.pinsSampled} pins inside your drawing</>}
          </span>
        )}
        {preview && preview.willDeliver > 0 && (
          <button type="button" onClick={pull} disabled={busy !== null} className="text-sm px-3 py-2 rounded-lg bg-brick text-white font-medium hover:bg-brick-dark disabled:opacity-50">
            {busy === 'pull' ? 'Pulling…' : `📇 Pull contacts · ${Math.min(preview.willDeliver, count)} homes · ${usd(Math.min(preview.willDeliver, count) * CREDITS_PER_LEAD_ROW)}`}
          </button>
        )}
        {shape && <button type="button" onClick={onClearShape} disabled={busy !== null} className="text-xs text-gray-500 underline">Clear drawing</button>}
      </div>
      {progress && <p className="text-xs text-blue-700">{progress}</p>}
      <p className="text-[11px] text-gray-400">Tracerfy pulls by radius, so a few homes outside your drawing may come back; they are marked and you only pay for delivered rows. Phones on the Do-Not-Call list are shown but not dialable from the app.</p>
    </div>
  );
}
