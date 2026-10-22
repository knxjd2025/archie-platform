/**
 * Everything about one canvassed door, opened from the list: tag it, label it,
 * set when to come back, and pull its storm history, roof measurements and
 * owner contact — together in one tap or one at a time.
 */
import { useEffect, useState } from 'react';
import CanvassEnrichment, { type Enrichment } from './CanvassEnrichment';
import CanvassLabels from './CanvassLabels';
import ContactActions from './ContactActions';
import CanvassAssessment from './CanvassAssessment';
import { formatPhone } from '../lib/format';
import { STATUS_META, STATUS_ORDER, toDateInput, isFollowUpDue, type HousePatch, type Property, type Rep } from '../lib/canvass';
import { CREDITS_PER_PROPERTY_LOOKUP, usd } from '../../../shared/canvass-areas';

interface Props {
  p: Property;
  enrichment: Enrichment | null;
  tracerfyOn: boolean;
  busy: boolean;
  canManage: boolean;
  reps: Rep[];
  onPatch: (patch: HousePatch) => void;
  onPullAll: () => void;
  onMeasure: () => void;
  onStorm: () => void;
  onEnrich: () => void;
  onConvert: () => void;
}

const BTN = 'text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 disabled:opacity-50';

function StormPanel({ p }: { p: Property }) {
  const s = p.stormSummary;
  if (!s) return null;
  const w = s.weather?.current;
  return (
    <div className="text-xs text-gray-600 bg-gray-50 rounded-lg p-2.5 space-y-1">
      <p>
        <span className="font-medium">⛈ Storm history (3 yrs, 10 mi):</span> {s.totalEvents} events ·{' '}
        {s.hailEvents} hail{s.maxHailSize ? ` (max ${s.maxHailSize}")` : ''} ·{' '}
        {s.windEvents} wind{s.maxWindMph ? ` (max ${Math.round(s.maxWindMph)} mph)` : ''}
        {s.lastEventDate ? ` · last ${s.lastEventDate}` : ''}
        {s.riskLevel ? ` · ${s.riskLevel} risk` : ''}
      </p>
      {w && (
        <p className="text-gray-500">
          🌤 Now: {w.description}{w.temperatureF != null ? `, ${w.temperatureF}°F` : ''}
          {w.windMph != null ? ` · wind ${w.windMph} mph` : ''}{w.windGustMph ? ` (gusts ${w.windGustMph})` : ''}
          {w.precipProbabilityPct != null ? ` · ${w.precipProbabilityPct}% rain` : ''}
          {s.weather?.windyDays ? ` · ${s.weather.windyDays} windy day${s.weather.windyDays === 1 ? '' : 's'} lately` : ''}
        </p>
      )}
      <p className="text-gray-500">Nearby reports indicate exposure, not confirmed damage at this house.</p>
      <p className="text-gray-500">Sources: {s.sources?.join(', ') || 'Refresh to load source details'} · Quality: {s.dataQuality || 'unknown'} · Updated: {s.fetchedAt ? new Date(s.fetchedAt).toLocaleString() : 'unknown'}</p>
      {!!s.events?.length && <details><summary className="cursor-pointer font-medium">Reported storm events ({s.events.length})</summary><div className="max-h-56 overflow-auto mt-2 space-y-2">{s.events.map((e, i) => <p key={`${e.date}-${i}`} className="border-t border-gray-200 pt-2">{e.date} · {e.type} · {e.distanceMiles == null ? 'Distance unknown' : `${e.distanceMiles.toFixed(1)} mi away`}{e.hailInches != null ? ` · ${e.hailInches} in hail` : ''}{e.windMph != null ? ` · ${e.windMph} mph wind` : ''} · {e.source}</p>)}</div></details>}
    </div>
  );
}

function RoofPanel({ p }: { p: Property }) {
  const m = p.measurements;
  if (!m) return null;
  return (
    <div className="text-xs text-gray-600 bg-gray-50 rounded-lg p-2.5">
      <span className="font-medium">📐 Roof:</span> {m.measuredSquares} squares
      {' '}({m.roofAreaSqFt.toLocaleString()} sq ft) · {m.averagePitch} pitch ·{' '}
      {m.segments} {m.segments === 1 ? 'facet' : 'facets'}
      {m.billableSquares !== m.measuredSquares ? ` · ${m.billableSquares} billable w/ waste` : ''}
      <span className="text-gray-400"> · imagery {m.imageryDate} · {m.confidence} confidence</span>
      {/* Satellite is a starting point, not a takeoff — say so rather than let a rep quote a roof off it. */}
      <p className="text-gray-400 mt-1">Estimate from satellite — confirm on site before quoting.</p>
    </div>
  );
}

export default function CanvassHouseDetails(props: Props) {
  const { p, enrichment, tracerfyOn, busy, canManage, reps } = props;
  const [notes, setNotes] = useState(p.notes || '');
  useEffect(() => setNotes(p.notes || ''), [p.id, p.notes]);
  const missing = !p.stormSummary || !p.measurements || (tracerfyOn && !enrichment);
  const due = isFollowUpDue(p.followUpAt);

  return (
    <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
      <div className="flex flex-wrap gap-1.5">
        {STATUS_ORDER.map((s) => (
          <button key={s} onClick={() => props.onPatch({ status: s })} aria-pressed={p.status === s} className={`text-xs px-2.5 py-1.5 rounded-full border ${p.status === s ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600'}`}>
            {STATUS_META[s].label}
          </button>
        ))}
      </div>

      {missing && (
        <button onClick={props.onPullAll} disabled={busy} className="w-full sm:w-auto text-sm px-4 py-2.5 rounded-lg bg-navy text-white font-medium hover:opacity-90 disabled:opacity-50">
          ⚡ {busy ? 'Pulling…' : `Pull everything${tracerfyOn && !enrichment ? ` · ${usd(CREDITS_PER_PROPERTY_LOOKUP)}` : ''}`}
          <span className="block text-[11px] font-normal opacity-80">
            {[!p.stormSummary && 'storm history', !p.measurements && 'roof size', tracerfyOn && !enrichment && 'owner & phone'].filter(Boolean).join(' · ')}
          </span>
        </button>
      )}

      <CanvassAssessment key={p.id} p={p} enrichment={enrichment} />
      <StormPanel p={p} />
      {!enrichment && <div className="text-sm text-gray-700 rounded-lg bg-gray-50 p-3"><p className="font-medium">{p.ownerName || 'Owner not yet identified'}</p><p>{[p.phone && formatPhone(p.phone), p.email].filter(Boolean).join(' · ') || 'Contact information not yet available'}</p></div>}
      {enrichment && <CanvassEnrichment e={enrichment} busy={busy} onPull={props.onEnrich} />}
      <RoofPanel p={p} />

      <CanvassLabels labels={p.labels} busy={busy} onChange={(labels) => props.onPatch({ labels })} />

      <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-start">
        <label className="text-xs text-gray-700 space-y-1">
          <span className="font-medium block">🔁 Follow up on {due && <span className="text-red-600">· due</span>}</span>
          <span className="flex gap-1.5">
            <input
              type="date"
              value={toDateInput(p.followUpAt)}
              onChange={(e) => props.onPatch({ followUpAt: e.target.value || null })}
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5"
            />
            {p.followUpAt && <button onClick={() => props.onPatch({ followUpAt: null })} className="text-xs text-gray-500 hover:underline">Clear</button>}
          </span>
        </label>
        <label className="text-xs text-gray-700 space-y-1">
          <span className="font-medium block">📝 Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => { if (notes !== (p.notes || '')) props.onPatch({ notes }); }}
            rows={2}
            maxLength={2000}
            placeholder="What happened at the door, who to ask for, best time…"
            className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={props.onStorm} disabled={busy} className={BTN}>⛈ {p.stormSummary ? 'Refresh storms' : 'Pull storm history'}</button>
        <button onClick={props.onMeasure} disabled={busy} className={BTN}>📐 {p.measurements ? 'Re-measure roof' : 'Measure roof'}</button>
        {!enrichment && tracerfyOn && <CanvassEnrichment e={null} busy={busy} onPull={props.onEnrich} />}
        <a href={`https://maps.google.com/?q=${encodeURIComponent(p.address)}`} target="_blank" rel="noopener noreferrer" className={BTN}>🧭 Directions</a>
        {/* A converted lead calls/texts through GoHighLevel; a bare property (no lead yet) still uses the phone's own apps. */}
        {p.phone && <span title={formatPhone(p.phone)}><ContactActions externalId={p.leadExternalId} phone={p.phone} size="md" showEmail={false} /></span>}
        {!p.leadExternalId && (
          <button onClick={props.onConvert} disabled={busy} className="text-sm px-3 py-2 rounded-lg bg-brick text-white font-medium hover:bg-brick-dark disabled:opacity-50">＋ Make it a lead</button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
        {canManage ? (
          <label className="flex items-center gap-1.5">
            Rep:
            <select
              value={p.ownerEmail || ''}
              onChange={(e) => { if (e.target.value && e.target.value !== p.ownerEmail) props.onPatch({ ownerEmail: e.target.value }); }}
              className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-700"
            >
              {!reps.some((r) => r.email === p.ownerEmail) && <option value={p.ownerEmail || ''}>{p.ownerRepName || 'Unassigned'}</option>}
              {reps.map((r) => <option key={r.email} value={r.email}>{r.name}</option>)}
            </select>
          </label>
        ) : null}
        {p.knockedBy && <span>Last updated by {p.knockedBy}</span>}
      </div>
    </div>
  );
}
