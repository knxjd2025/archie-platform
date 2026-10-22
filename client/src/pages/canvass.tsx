import { useState, useEffect, useMemo, useRef } from 'react';
import { GoogleMap, MarkerF, InfoWindowF, DrawingManagerF, PolygonF, RectangleF, CircleF, useJsApiLoader } from '@react-google-maps/api';
import CanvassAreaPull, { type AreaRow, type TracerfyStatus } from '../components/CanvassAreaPull';
import { roofScoreTone, type Enrichment } from '../components/CanvassEnrichment';
import CanvassHouseDetails from '../components/CanvassHouseDetails';
import { LabelChips } from '../components/CanvassLabels';
import type { AreaShape } from '../../../shared/canvass-areas';
import { SUGGESTED_LABELS, labelMeta } from '../../../shared/canvass-labels';
import { api } from '../lib/api';
import { useCompany } from '../lib/company';
import { assessLead } from '../../../shared/canvass-intelligence';
import {
  STATUS_META, STATUS_ORDER, DOT_COLOR, isFollowUpDue,
  type HousePatch, type Measurements, type Property, type Rep, type Storm, type Weather,
} from '../lib/canvass';

/**
 * Where the map opens when nothing is pinned and the company's city could not
 * be found: the middle of the contiguous US, zoomed out to show the country.
 */
const US_CENTER = { lat: 39.8283, lng: -98.5795 };
const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const MAP_LIBRARIES: ('drawing')[] = ['drawing']; // stable reference — the loader re-inits on a new array
const NO_KNOCK = 'do not knock';

interface CanvassList { properties: Property[]; truncated?: boolean; canManage?: boolean; reps?: Rep[] }

export default function Canvass() {
  const company = useCompany();
  const [items, setItems] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [reps, setReps] = useState<Rep[]>([]);
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('priority');
  const [labelFilter, setLabelFilter] = useState('');
  const [repFilter, setRepFilter] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  // Measure/storm/convert hit paid third-party APIs; a double-tap must not fire twice.
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const withBusy = (id: number, fn: () => Promise<void>) => async () => {
    if (busyIds.has(id)) return;
    setBusyIds((s) => new Set(s).add(id));
    try { await fn(); } finally { setBusyIds((s) => { const n = new Set(s); n.delete(id); return n; }); }
  };
  const [view, setView] = useState<'list' | 'map'>('list');
  const [pinId, setPinId] = useState<number | null>(null);
  // Set once, from the first load. Recomputing it on every render re-centred
  // the map each time a pin changed — yanking it away from wherever the rep
  // had panned to.
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const { isLoaded: mapsLoaded } = useJsApiLoader({ googleMapsApiKey: MAPS_KEY || '', id: 'archie-canvass-map', libraries: MAP_LIBRARIES });
  // With nothing pinned yet, open on the company's own city (from its profile),
  // looked up once through the Maps geocoder.
  const [cityCenter, setCityCenter] = useState<{ lat: number; lng: number } | null>(null);
  const cityQuery = [company.city, company.state].filter(Boolean).join(', ');
  useEffect(() => {
    if (!mapsLoaded || !cityQuery || cityCenter || mapCenter) return;
    let cancelled = false;
    try {
      new google.maps.Geocoder().geocode({ address: cityQuery, componentRestrictions: { country: 'US' } }, (results, status) => {
        const loc = status === 'OK' ? results?.[0]?.geometry?.location : null;
        if (!cancelled && loc) setCityCenter({ lat: loc.lat(), lng: loc.lng() });
      });
    } catch { /* the geocoder is not enabled on this key — the US view stands */ }
    return () => { cancelled = true; };
  }, [mapsLoaded, cityQuery, cityCenter, mapCenter]);
  // Tracerfy: owner/roof facts per home, drawn areas, and the drawing in progress.
  const [enrich, setEnrich] = useState<Record<number, Enrichment>>({});
  const [areas, setAreas] = useState<AreaRow[]>([]);
  const [areaFilter, setAreaFilter] = useState<number | 'all'>('all');
  const [tf, setTf] = useState<TracerfyStatus | null>(null);
  const [shape, setShape] = useState<AreaShape | null>(null);
  const [previewPins, setPreviewPins] = useState<Array<{ lat: number; lng: number; inside: boolean }>>([]);
  const tracerfyOn = tf?.configured !== false;
  const loadEnrichment = () => api.get<{ enrichment: Enrichment[] }>('/api/canvass/enrichment')
    .then((r) => setEnrich(Object.fromEntries((r.enrichment || []).map((e) => [e.canvassPropertyId, e]))))
    .catch(() => {});
  const loadAreas = () => api.get<{ areas: AreaRow[] }>('/api/canvass/areas').then((r) => setAreas(r.areas || [])).catch(() => {});
  useEffect(() => { loadEnrichment(); loadAreas(); api.get<TracerfyStatus>('/api/canvass/tracerfy/status').then(setTf).catch(() => setTf({ configured: false })); }, []);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 5000); };

  const load = () => api.get<CanvassList>('/api/canvass')
    .then((r) => {
      const props = r.properties || [];
      setItems(props);
      setTruncated(!!r.truncated);
      setCanManage(!!r.canManage);
      setReps(r.reps || []);
      setLoadError(null);
      setMapCenter((c) => {
        if (c) return c;
        const pinned = props.filter((p) => p.lat != null && p.lng != null);
        if (!pinned.length) return null;
        return { lat: pinned.reduce((s, p) => s + p.lat!, 0) / pinned.length, lng: pinned.reduce((s, p) => s + p.lng!, 0) / pinned.length };
      });
    })
    .catch((e: any) => setLoadError(e?.message || "Couldn't load your canvassing list."))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const replace = (next: Property) => setItems((xs) => xs.map((x) => (x.id === next.id ? next : x)));
  const update = (id: number, fn: (p: Property) => Property) => setItems((xs) => xs.map((x) => (x.id === id ? fn(x) : x)));

  const addDoor = async (extra: { lat?: number; lng?: number } = {}, addressOverride?: string) => {
    const address = (addressOverride ?? addr).trim();
    if (!address || busy) return;
    setBusy(true);
    try {
      const r = await api.post<{ existed?: boolean; property: Property }>('/api/canvass', { address, ...extra });
      setAddr('');
      if (r.existed) {
        flash('That house is already on your list.');
        setOpenId(r.property.id);
      } else {
        setItems((xs) => [r.property, ...xs]);
        setOpenId(r.property.id);
        flash('House added ✅ — checking its storm history…');
        // Storm history comes from free NOAA records, so every new door gets
        // it straight away; measurements and owner contact cost money and wait
        // for the rep to ask.
        pullStorm(r.property, { quiet: true }).catch(() => flash('House added ✅ — storm history can be pulled from its details.'));
      }
    } catch (e: any) { flash(`Couldn't add it: ${e?.message || 'failed'}`); }
    finally { setBusy(false); }
  };

  // Best-effort reverse geocode so "Use my location" works even with no address typed yet.
  const reverseGeocode = (lat: number, lng: number): Promise<string> =>
    new Promise((resolve, reject) => {
      if (!mapsLoaded || typeof google === 'undefined') { reject(new Error('Maps not loaded')); return; }
      new google.maps.Geocoder().geocode({ location: { lat, lng } }, (results, status) => {
        if (status === 'OK' && results && results[0]) resolve(results[0].formatted_address);
        else reject(new Error(String(status)));
      });
    });

  // Drop a pin where the rep is standing.
  const addHere = () => {
    if (!navigator.geolocation) { flash('Location is not available on this device.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        let address = addr.trim();
        if (!address) {
          try { address = await reverseGeocode(latitude, longitude); }
          catch { address = `Pinned location (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`; }
        }
        setLocating(false);
        addDoor({ lat: latitude, lng: longitude }, address);
      },
      () => { setLocating(false); flash('Could not get your location — type the address instead.'); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  // Per-house sequence for patches. Two quick taps (Not home, then Talked)
  // can answer out of order; the older reply then replaced the house and put
  // the first status back over the one the rep actually chose last.
  const patchSeq = useRef(new Map<number, number>());

  /** Status, notes, labels, follow-up, rep — optimistic, reverted by a reload on failure. */
  const patchHouse = async (p: Property, patch: HousePatch) => {
    const seq = (patchSeq.current.get(p.id) ?? 0) + 1;
    patchSeq.current.set(p.id, seq);
    const latest = () => patchSeq.current.get(p.id) === seq;
    update(p.id, (x) => ({ ...x, ...patch, followUpAt: patch.followUpAt !== undefined ? patch.followUpAt : x.followUpAt }));
    try {
      const r = await api.patch<{ property: Property }>(`/api/canvass/${p.id}`, patch);
      if (latest()) replace(r.property);
      if (patch.ownerEmail) flash(`Moved to ${r.property.ownerRepName || patch.ownerEmail}.`);
    } catch (e: any) {
      flash(`Couldn't save that — ${e?.message || 'reverted'}.`);
      // A newer patch is still on its way and will set the house; reloading
      // now could paint over that newer optimistic change.
      if (latest()) load();
    }
  };

  /**
   * Measure on demand rather than for every pin: Solar bills per lookup and
   * most doors never become jobs, so the rep asks when it is worth it. A second
   * tap re-measures — it used to send no refresh flag and hand back the cache.
   */
  const measureRoof = async (p: Property, opts: { quiet?: boolean } = {}): Promise<string | null> => {
    if (!opts.quiet) flash('Measuring the roof from satellite…');
    try {
      const r = await api.post<{ measurements: Measurements; cached?: boolean }>(`/api/canvass/${p.id}/measure`, { refresh: !!p.measurements });
      update(p.id, (x) => ({ ...x, measurements: r.measurements }));
      const m = r.measurements;
      const msg = `${m.measuredSquares} squares · ${m.averagePitch} pitch`;
      if (!opts.quiet) flash(msg);
      return msg;
    } catch (e: any) {
      if (!opts.quiet) flash(e?.message || "Couldn't measure that roof.");
      throw e;
    }
  };

  const pullStorm = async (p: Property, opts: { quiet?: boolean } = {}): Promise<string | null> => {
    if (!opts.quiet) flash('Checking NOAA storm history…');
    try {
      const r = await api.post<{ storm: Storm; weather?: Weather | null }>(`/api/canvass/${p.id}/storm`, { refresh: !!p.stormSummary });
      update(p.id, (x) => ({ ...x, stormSummary: { ...r.storm, weather: r.weather ?? null } }));
      const s = r.storm;
      const msg = s.totalEvents ? `${s.totalEvents} storms — ${s.hailEvents} hail, ${s.windEvents} wind` : 'no storms on record';
      if (!opts.quiet) flash(s.totalEvents ? msg : 'No storm events on record for this address.');
      else if (s.hailEvents) flash(`⛈ ${p.address.split(',')[0]}: ${msg}`);
      return msg;
    } catch (e: any) {
      if (!opts.quiet) flash(`Couldn't pull storm history: ${e?.message || 'failed'}`);
      throw e;
    }
  };

  const enrichOne = async (p: Property, opts: { quiet?: boolean } = {}): Promise<string | null> => {
    if (!opts.quiet) flash('Asking Tracerfy about that address…');
    try {
      const r = await api.post<{ enrichment: Enrichment; cached?: boolean }>(`/api/canvass/${p.id}/enrich`, {});
      setEnrich((m) => ({ ...m, [p.id]: r.enrichment }));
      const e = r.enrichment;
      update(p.id, (x) => ({ ...x, ownerName: x.ownerName || e.ownerName, phone: x.phone || (e.phones.find((ph) => !ph.dnc && !ph.tcpa)?.number ?? null), email: x.email || (e.emails[0]?.email ?? null) }));
      const msg = r.cached ? 'owner already on file' : `${e.ownerName || 'owner'} · ${e.phones.length} phone${e.phones.length === 1 ? '' : 's'}`;
      if (!opts.quiet) flash(r.cached ? 'Already on file — no credits used.' : `${msg}${e.roofScore != null ? ` · roof score ${e.roofScore}` : ''}`);
      return msg;
    } catch (e: any) {
      if (!opts.quiet) flash(e?.message || "Couldn't look that address up.");
      throw e;
    }
  };

  /** Everything a door is missing, at once: storm history, roof size, owner contact. */
  const pullAll = async (p: Property) => {
    const jobs: Array<[string, () => Promise<string | null>]> = [];
    if (!p.stormSummary) jobs.push(['storms', () => pullStorm(p, { quiet: true })]);
    if (!p.measurements) jobs.push(['roof', () => measureRoof(p, { quiet: true })]);
    if (tracerfyOn && !enrich[p.id]) jobs.push(['owner', () => enrichOne(p, { quiet: true })]);
    if (!jobs.length) { flash('Everything is already pulled for this house.'); return; }
    flash(`Pulling ${jobs.map(([k]) => k).join(', ')}…`);
    const results = await Promise.allSettled(jobs.map(([, run]) => run()));
    flash(results.map((r, i) => (r.status === 'fulfilled'
      ? `✅ ${r.value}`
      : `⚠️ ${jobs[i][0]}: ${(r.reason as Error)?.message || 'failed'}`)).join(' · '));
  };

  const convert = async (p: Property) => {
    if (!window.confirm(`Create a JobTread lead for ${p.address}?`)) return;
    try {
      await api.post(`/api/canvass/${p.id}/convert`, {});
      flash('Lead created in JobTread ✅');
      await load();
    } catch (e: any) { flash(`Couldn't create the lead: ${e?.message || 'failed'}`); }
  };

  const onDrawn = (next: AreaShape, overlay: { setMap: (m: null) => void }) => { overlay.setMap(null); setShape(next); };
  const pathOf = (poly: google.maps.Polygon) => poly.getPath().getArray().map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));

  const assessments = useMemo(() => Object.fromEntries(items.map(p => [p.id, assessLead(p, enrich[p.id] || null)])), [items, enrich]);
  const shown = useMemo(() => {
    const matches = items.filter((i) =>
      (filter === 'all' || i.status === filter)
      && (!labelFilter || i.labels.includes(labelFilter))
      && (!repFilter || i.ownerEmail === repFilter)
      && (!dueOnly || isFollowUpDue(i.followUpAt))
      && (areaFilter === 'all' || enrich[i.id]?.areaId === areaFilter));
    const rank = (id: number) => assessments[id].priority === 'Not a prospecting target' ? -2 : assessments[id].score ?? -1;
    return sortBy === 'priority' ? matches.slice().sort((a, b) => rank(b.id) - rank(a.id) || a.address.localeCompare(b.address)) : matches;
  }, [items, filter, labelFilter, repFilter, dueOnly, areaFilter, enrich, sortBy, assessments]);
  const counts = (s: string) => items.filter((i) => i.status === s).length;
  const dueCount = items.filter((i) => isFollowUpDue(i.followUpAt)).length;
  const usedLabels = useMemo(() => {
    const seen = new Set(items.flatMap((i) => i.labels));
    return [...SUGGESTED_LABELS.map((l) => l.value).filter((v) => seen.has(v)), ...[...seen].filter((v) => !SUGGESTED_LABELS.some((l) => l.value === v)).sort()];
  }, [items]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Canvassing</h1>
        <p className="text-sm text-gray-500 mt-1">
          Pin houses as you work a street, tag and label what happened, pull storm history, roof size and the owner's contact in one tap, or draw a neighbourhood on the map and pull every owner in it.
          {items.length ? ` · ${items.length} on ${canManage ? 'the list' : 'your list'}` : ''}
        </p>
      </div>

      {toast && <div role="status" className="rounded-lg bg-gray-900 text-white text-sm px-4 py-2 shadow">{toast}</div>}

      {/* Add a door — big tap targets for one-handed use in the field */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-col sm:flex-row gap-2">
        <input
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addDoor(); }}
          placeholder={`123 Main St${company.cityState ? `, ${company.cityState}` : ', City, ST'}`}
          aria-label="Address"
          className="flex-1 text-base border border-gray-200 rounded-lg px-3 py-3 focus:ring-1 focus:ring-blue-400"
        />
        <button onClick={() => addDoor()} disabled={busy || !addr.trim()} className="px-4 py-3 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark disabled:opacity-50">
          {busy ? 'Adding…' : '＋ Add house'}
        </button>
        <button onClick={addHere} disabled={locating || busy} title="Save with your current GPS location" className="px-4 py-3 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 disabled:opacity-50">
          {locating ? 'Locating…' : '📍 Use my location'}
        </button>
      </div>

      {/* Status filters + List/Map toggle */}
      <label className="flex items-center gap-2 text-sm text-gray-600">Sort properties
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 bg-white">
          <option value="priority">Lead priority</option><option value="recent">Recently updated</option>
        </select>
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setFilter('all')} aria-pressed={filter === 'all'} className={`px-3 py-1 text-sm rounded-full ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            All ({items.length})
          </button>
          {STATUS_ORDER.map((s) => (
            <button key={s} onClick={() => setFilter(s)} aria-pressed={filter === s} className={`px-3 py-1 text-sm rounded-full ${filter === s ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
              {STATUS_META[s].label} ({counts(s)})
            </button>
          ))}
          {dueCount > 0 && (
            <button onClick={() => setDueOnly((d) => !d)} aria-pressed={dueOnly} className={`px-3 py-1 text-sm rounded-full ${dueOnly ? 'bg-red-600 text-white' : 'bg-white border border-red-200 text-red-700'}`}>
              🔁 Follow-ups due ({dueCount})
            </button>
          )}
        </div>
        <div className="flex gap-1 bg-white border border-gray-200 rounded-full p-0.5">
          <button onClick={() => setView('list')} aria-pressed={view === 'list'} className={`px-3 py-1 text-sm rounded-full ${view === 'list' ? 'bg-ink text-white' : 'text-gray-600'}`}>☰ List</button>
          <button onClick={() => setView('map')} aria-pressed={view === 'map'} className={`px-3 py-1 text-sm rounded-full ${view === 'map' ? 'bg-ink text-white' : 'text-gray-600'}`}>🗺️ Map</button>
        </div>
      </div>

      {(usedLabels.length > 0 || canManage || areas.some((a) => a.status === 'complete')) && (
        <div className="flex flex-wrap items-center gap-2">
          {usedLabels.length > 0 && (
            <select aria-label="Label" value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)} className="text-sm border border-gray-200 rounded-full px-3 py-1 bg-white">
              <option value="">🏷 Any label</option>
              {usedLabels.map((l) => <option key={l} value={l}>{labelMeta(l).label}</option>)}
            </select>
          )}
          {canManage && reps.length > 0 && (
            <select aria-label="Rep" value={repFilter} onChange={(e) => setRepFilter(e.target.value)} className="text-sm border border-gray-200 rounded-full px-3 py-1 bg-white">
              <option value="">👥 Every rep</option>
              {reps.map((r) => <option key={r.email} value={r.email}>{r.name}</option>)}
            </select>
          )}
          {areas.some((a) => a.status === 'complete') && (
            <select aria-label="Area" value={String(areaFilter)} onChange={(e) => setAreaFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="text-sm border border-gray-200 rounded-full px-3 py-1 bg-white">
              <option value="all">All homes</option>
              {areas.filter((a) => a.status === 'complete').map((a) => <option key={a.id} value={a.id}>🎯 {a.name} ({a.inAreaCount ?? a.deliveredCount ?? 0})</option>)}
            </select>
          )}
        </div>
      )}

      {truncated && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Showing the 2,000 most recently updated houses. Pick a rep or a label to narrow it down.
        </p>
      )}

      {view === 'map' ? (
        !MAPS_KEY ? (
          <div className="px-6 py-12 text-center text-sm text-gray-400 bg-white rounded-xl border border-gray-200 space-y-1">
            <p>The live map isn't configured yet.</p>
            <p className="text-xs text-gray-400">
              An admin needs to set <code className="bg-gray-100 rounded px-1 py-0.5">VITE_GOOGLE_MAPS_API_KEY</code> in the deployment's environment variables and redeploy — the List view above still works without it.
            </p>
          </div>
        ) : !mapsLoaded ? (
          <div className="h-[28rem] bg-gray-100 rounded-xl border border-gray-200 animate-pulse" />
        ) : (
          <div className="space-y-3">
          <CanvassAreaPull shape={shape} onClearShape={() => { setShape(null); setPreviewPins([]); }} status={tf} onPreview={setPreviewPins} onPulled={() => { load(); loadEnrichment(); loadAreas(); }} flash={flash} />
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <GoogleMap
              mapContainerStyle={{ width: '100%', height: '32rem' }}
              center={mapCenter ?? cityCenter ?? US_CENTER}
              zoom={items.some((p) => p.lat != null) ? 13 : cityCenter ? 11 : 4}
              onClick={() => setPinId(null)}
            >
              {tracerfyOn && (
                <DrawingManagerF
                  options={{
                    drawingControl: true,
                    drawingControlOptions: { position: google.maps.ControlPosition.TOP_CENTER, drawingModes: [google.maps.drawing.OverlayType.POLYGON, google.maps.drawing.OverlayType.RECTANGLE, google.maps.drawing.OverlayType.CIRCLE] },
                    polygonOptions: { fillColor: '#2563eb', fillOpacity: 0.12, strokeColor: '#2563eb', strokeWeight: 2 },
                    rectangleOptions: { fillColor: '#2563eb', fillOpacity: 0.12, strokeColor: '#2563eb', strokeWeight: 2 },
                    circleOptions: { fillColor: '#2563eb', fillOpacity: 0.12, strokeColor: '#2563eb', strokeWeight: 2 },
                  }}
                  onPolygonComplete={(poly) => onDrawn({ type: 'polygon', path: pathOf(poly) }, poly)}
                  onRectangleComplete={(rect) => { const b = rect.getBounds()!; onDrawn({ type: 'rectangle', north: b.getNorthEast().lat(), east: b.getNorthEast().lng(), south: b.getSouthWest().lat(), west: b.getSouthWest().lng() }, rect); }}
                  onCircleComplete={(c) => onDrawn({ type: 'circle', center: { lat: c.getCenter()!.lat(), lng: c.getCenter()!.lng() }, radiusMeters: c.getRadius() }, c)}
                />
              )}
              {shape?.type === 'polygon' && <PolygonF path={shape.path} options={{ fillColor: '#2563eb', fillOpacity: 0.12, strokeColor: '#2563eb', strokeWeight: 2, clickable: false }} />}
              {shape?.type === 'rectangle' && <RectangleF bounds={{ north: shape.north, south: shape.south, east: shape.east, west: shape.west }} options={{ fillColor: '#2563eb', fillOpacity: 0.12, strokeColor: '#2563eb', strokeWeight: 2, clickable: false }} />}
              {shape?.type === 'circle' && <CircleF center={shape.center} radius={shape.radiusMeters} options={{ fillColor: '#2563eb', fillOpacity: 0.12, strokeColor: '#2563eb', strokeWeight: 2, clickable: false }} />}
              {previewPins.map((pin, i) => (
                <MarkerF key={`pv-${i}`} position={pin} clickable={false} icon={{ path: google.maps.SymbolPath.CIRCLE, fillColor: pin.inside ? '#2563eb' : '#9ca3af', fillOpacity: 0.7, strokeColor: '#ffffff', strokeWeight: 1, scale: 4 }} />
              ))}
              {shown.filter((p) => p.lat != null && p.lng != null).map((p) => {
                // A red ring says "don't knock"; an amber one, "go back today".
                const ring = p.labels.includes(NO_KNOCK) ? '#dc2626' : isFollowUpDue(p.followUpAt) ? '#f59e0b' : '#ffffff';
                return (
                <MarkerF
                  key={p.id}
                  position={{ lat: p.lat!, lng: p.lng! }}
                  onClick={() => setPinId(p.id)}
                  icon={{
                    path: google.maps.SymbolPath.CIRCLE,
                    fillColor: DOT_COLOR[p.status] || DOT_COLOR.not_knocked,
                    fillOpacity: 1,
                    strokeColor: ring,
                    strokeWeight: ring === '#ffffff' ? 2 : 3,
                    scale: 8,
                  }}
                >
                  {pinId === p.id && (
                    <InfoWindowF onCloseClick={() => setPinId(null)}>
                      <div className="text-sm space-y-1.5 min-w-[10rem]">
                        <p className="font-medium text-gray-900">{p.address}</p>
                        <p className="text-xs font-medium text-blue-800">Lead priority {assessments[p.id].score ?? '—'}/100 · {assessments[p.id].priority}</p>
                        <p className="text-xs text-gray-500">
                          {STATUS_META[p.status]?.label || p.status}
                          {p.stormSummary?.hailEvents ? ` · ⛈ ${p.stormSummary.hailEvents} hail` : ''}
                          {p.measurements ? ` · 📐 ${p.measurements.measuredSquares} sq` : ''}
                          {canManage && p.ownerRepName ? ` · ${p.ownerRepName}` : ''}
                        </p>
                        <LabelChips labels={p.labels} />
                        <div className="flex flex-wrap gap-1">
                          {STATUS_ORDER.map((s) => (
                            <button key={s} onClick={() => patchHouse(p, { status: s })} className={`text-xs px-2.5 py-1.5 rounded-full border ${p.status === s ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600'}`}>
                              {STATUS_META[s].label}
                            </button>
                          ))}
                        </div>
                        <button onClick={() => { setView('list'); setOpenId(p.id); }} className="text-xs text-blue-600 hover:underline">Open full details →</button>
                      </div>
                    </InfoWindowF>
                  )}
                </MarkerF>
                );
              })}
            </GoogleMap>
          </div>
          </div>
        )
      ) : loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-xl border border-gray-200 animate-pulse" />)}</div>
      ) : loadError ? (
        <p className="px-6 py-12 text-center text-sm text-red-500 bg-white rounded-xl border border-gray-200">
          Couldn't load — {loadError}{' '}
          <button onClick={load} className="text-red-600 font-medium underline hover:no-underline">Retry</button>
        </p>
      ) : shown.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-gray-400 bg-white rounded-xl border border-gray-200">
          {items.length === 0 ? 'No houses yet — add the first one above as you start the street.' : 'Nothing matches those filters.'}
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map((p) => {
            const meta = STATUS_META[p.status] || STATUS_META.not_knocked;
            const open = openId === p.id;
            const due = isFollowUpDue(p.followUpAt);
            return (
              <div key={p.id} className={`bg-white rounded-xl border overflow-hidden ${due ? 'border-amber-300' : 'border-gray-200'}`}>
                <button onClick={() => setOpenId(open ? null : p.id)} aria-expanded={open} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${meta.dot}`} />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-medium text-gray-900 truncate">{p.address}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {[p.ownerName, p.city].filter(Boolean).join(' · ') || 'No contact yet'}
                      {p.stormSummary?.totalEvents ? ` · ⛈ ${p.stormSummary.totalEvents} storms` : ''}
                      {p.measurements ? ` · 📐 ${p.measurements.measuredSquares} sq` : ''}
                      {p.leadExternalId ? ' · ✅ in JobTread' : ''}
                      {due ? ' · 🔁 follow up today' : ''}
                      {canManage && p.ownerRepName ? ` · 👤 ${p.ownerRepName}` : ''}
                    </p>
                    <LabelChips labels={p.labels} />
                  </div>
                  {enrich[p.id]?.roofScore != null && <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${roofScoreTone(enrich[p.id].roofScore)}`} title="Roof-replacement score">🏠 {enrich[p.id].roofScore}</span>}
                  <span className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-800 whitespace-nowrap" title={`${assessments[p.id].priority}; ${assessments[p.id].coverage}% evidence coverage`}>Lead {assessments[p.id].score ?? '—'}/100</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${meta.chip}`}>{meta.label}</span>
                </button>

                {open && (
                  <CanvassHouseDetails
                    p={p}
                    enrichment={enrich[p.id] ?? null}
                    tracerfyOn={tracerfyOn}
                    busy={busyIds.has(p.id)}
                    canManage={canManage}
                    reps={reps}
                    onPatch={(patch) => patchHouse(p, patch)}
                    onPullAll={withBusy(p.id, () => pullAll(p))}
                    onMeasure={withBusy(p.id, async () => { await measureRoof(p).catch(() => null); })}
                    onStorm={withBusy(p.id, async () => { await pullStorm(p).catch(() => null); })}
                    onEnrich={withBusy(p.id, async () => { await enrichOne(p).catch(() => null); })}
                    onConvert={withBusy(p.id, () => convert(p))}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
