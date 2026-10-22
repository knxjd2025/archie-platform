import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import ReportEditor from '../pages/report-editor';
import { fmtDate } from '../lib/format';
import ReportRefineChat from './ReportRefineChat';
import { tuneUpLineItem, cleaningLineItem, permaBootLineItems, waterDiverterLineItem, PERMA_BOOT_FIRST_RATE, PERMA_BOOT_RATE, WATER_DIVERTER_RATE, TUNE_UP_RATES, CLEANING_RATES, SERVICE_TIER_LABELS, SERVICE_TIER_RATE_MIN, SERVICE_TIER_RATE_MAX, serviceTierRateOk, type TuneUpTier, type CleaningTier, type ServiceTierKey } from '../../../shared/addon-pricing';
import { SCOPE_CATALOG, SCOPE_CATEGORY_LABELS } from '../../../shared/scope-catalog';
import { atLeast } from '../../../shared/rbac';
import { useAuth } from '../lib/auth';

/** Sentinel for "type in a product instead of picking from the catalog" in the tier pickers. */
const CUSTOM_PRODUCT = '__custom__';
/** A tune-up or cleaning in a Good/Better/Best slot, at a rate the rep sets ($29–$99/sq). */
const SERVICE_PREFIX = '__svc_';
const serviceOf = (v: string): ServiceTierKey | null => (v === `${SERVICE_PREFIX}tune_up` ? 'tune_up' : v === `${SERVICE_PREFIX}cleaning` ? 'cleaning' : null);
const CUSTOM_SCOPE = '__custom_scope__';

interface ScopeRow { catalogId: string | null; name: string; quantity: string; unit: string; unitPrice: string }

interface Report {
  id: number;
  reportId: string;
  reportType: string | null;
  title: string | null;
  status: string;
  reportUrl: string | null;
  pdfUrl: string | null;
  error: string | null;
  createdAt: string | null;
  presentedAt: string | null;
  /** Whether JobTread still matches this report. */
  jobtread?: {
    pushed: boolean;
    stale: boolean;
    /** The proposal has been sent or signed — it can't just be overwritten. */
    locked: boolean;
    documentId: string | null;
    status: string | null;
    message: string | null;
    pushedAt: string | null;
  } | null;
}

const TYPES = [
  { key: 'inspection', label: 'Inspection', hint: 'Written from the checklist and notes, with the photos as taken — never from what a model sees in a photo.' },
  { key: 'estimate', label: 'Estimate', hint: 'Itemized repair pricing the customer can sign off on.' },
  { key: 'proposal', label: 'Proposal', hint: 'The full story: what we found, who we are, and a live Good/Better/Best the customer can play with themselves.' },
  { key: 'presentation', label: 'Presentation', hint: 'The most detailed walkthrough — every damage photo, the full Integrity System, and a live Good/Better/Best a rep taps through on a tablet.' },
  { key: 'combined', label: 'Combined', hint: 'Inspection and proposal in one document.' },
];

// These restate an existing inspection's findings, so they reuse it when one
// exists — seconds instead of minutes, and the numbers match what was shown.
const DERIVED = new Set(['estimate', 'presentation', 'proposal']);

// Types with the Good/Better/Best customization step. Estimate only needs it
// when the rep switches it to replacement mode; Proposal and Presentation
// are always the three-way comparison.
const TIER_TYPES = new Set(['estimate', 'proposal', 'presentation']);
const ALWAYS_TIER_TYPES = new Set(['proposal', 'presentation']);

interface RoofingProduct {
  key: string; name: string; category: string; ratePerSquare: number; tagline: string;
  /** Commercial systems only: a tear-off is the one that takes an ISO R-value. */
  system?: 'tear_off' | 'layover' | 'coating';
}
type IsoTier = 'r25' | 'r30';
interface Measurement {
  documentName: string;
  squares: number | null;
  roofAreaSqFt: number | null;
  facets: number | null;
  predominantPitch: string | null;
}

interface EstimateDefaults {
  squaresSource?: string | null; mode: 'repair' | 'replacement'; squares: number | null; jobType: 'retail' | 'insurance'; recommendation: string | null;
  /** 'commercial' when the latest field inspection is the low-slope checklist — the tiers default to the commercial systems. */
  formKind?: 'residential' | 'commercial' }

const statusChip = (s: string) =>
  s === 'succeeded' ? 'bg-emerald-100 text-emerald-700'
  : s === 'failed' ? 'bg-red-100 text-red-700'
  : 'bg-amber-100 text-amber-700';

// Roof reports for a client — generated in-process and served from /r/<token>.
export default function RoofReports({ externalId }: { externalId: string; defaultEmail?: string | null }) {
  const [cfg, setCfg] = useState<{ configured: boolean; missing?: string[] }>({ configured: true });
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('inspection');
  const [photos, setPhotos] = useState('');
  const [busy, setBusy] = useState(false);
  const [useJobFiles, setUseJobFiles] = useState(true);
  const [ctx, setCtx] = useState<{ photos: number; files: number; messages: number; documents: number; dailyLogs: number } | null>(null);
  const [ctxLoading, setCtxLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [refining, setRefining] = useState<string | null>(null);
  // The full-page doc builder — one place to change anything on the report.
  const [building, setBuilding] = useState<string | null>(null);

  // Estimate customization — repair (default, itemized damage pricing) or a
  // Good/Better/Best replacement quote, requested by the rep before generating.
  const [products, setProducts] = useState<RoofingProduct[]>([]);
  // Commercial low-slope systems, offered in their own group of the same
  // Good/Better/Best picker. A tear-off tier also needs an ISO R-value.
  const [commercial, setCommercial] = useState<RoofingProduct[]>([]);
  const [isoTier, setIsoTier] = useState<IsoTier | ''>('r25');
  const [estimateDefaults, setEstimateDefaults] = useState<EstimateDefaults | null>(null);
  const [estimateMode, setEstimateMode] = useState<'repair' | 'replacement' | 'both'>('repair');
  // Lines the rep types in — added to the repair scope, priced as entered.
  const [customLines, setCustomLines] = useState<Array<{ name: string; quantity: string; unit: string; unitPrice: string }>>([]);
  // Which job photos to analyse. Empty = let the server take the first batch.
  const [jobPhotos, setJobPhotos] = useState<Array<{ url: string; caption?: string }>>([]);
  const [analyzeLimit, setAnalyzeLimit] = useState(40);
  // A commercial job's Proposal and Presentation have the picked photos read
  // by AI before the document is written; the server says when that is on.
  const [photoScan, setPhotoScan] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  const [modeApplied, setModeApplied] = useState(false);
  // A commercial Inspection can carry Good/Better/Best options and pricing
  // when the rep wants them on it; off by default, so the record stays a
  // record unless they ask.
  const [inspectionPricing, setInspectionPricing] = useState(false);
  // Default Good/Better/Best to Landmark / Landmark PRO / Landmark Premium —
  // the rep can still change any of the three from the dropdowns below.
  const [tierGood, setTierGood] = useState('landmark');
  const [tierBetter, setTierBetter] = useState('landmark_pro');
  const [tierBest, setTierBest] = useState('landmark_premium');
  // Only filled in when the matching tier above is set to CUSTOM_PRODUCT —
  // a rep-typed product name and $/SQ rate instead of a catalog pick.
  const [customProduct, setCustomProduct] = useState<Record<'good' | 'better' | 'best', { name: string; ratePerSquare: string }>>({
    good: { name: '', ratePerSquare: '' },
    better: { name: '', ratePerSquare: '' },
    best: { name: '', ratePerSquare: '' },
  });
  // The rep's $/sq for a tier set to a tune-up or cleaning — anywhere from $29 to $99.
  const [serviceRate, setServiceRate] = useState<Record<'good' | 'better' | 'best', string>>({ good: '', better: '', best: '' });
  const [selectedTier, setSelectedTier] = useState<'good' | 'better' | 'best'>('better');
  const [squares, setSquares] = useState('');
  // Tune-Up, Perma-Boot and water-diverter quick-adds — compute a correctly-priced line and
  // drop it straight into customLines rather than making the rep type a
  // price they'd have to remember from a rate card.
  const [tuneUpTier, setTuneUpTier] = useState<TuneUpTier>('basic');
  const [tuneUpSteep, setTuneUpSteep] = useState(false);
  const [tuneUpSquares, setTuneUpSquares] = useState('');
  const [cleaningTier, setCleaningTier] = useState<CleaningTier>('basic');
  const [cleaningSteep, setCleaningSteep] = useState(false);
  const [cleaningSquares, setCleaningSquares] = useState('');
  const [bootCount, setBootCount] = useState('');
  const [diverterCount, setDiverterCount] = useState('');
  // Specialty scope on a replacement quote (Proposal / Presentation / a
  // replacement Estimate), picked from the priced catalog. A rep sees catalog
  // prices only; a Sales Leader can override a price or add an item the
  // catalog doesn't have. The server enforces both — this only shapes the form.
  const { user } = useAuth();
  const canPriceScope = !!user && atLeast(user.role, 'manager');
  const [scopeItems, setScopeItems] = useState<ScopeRow[]>([]);
  const [scopePick, setScopePick] = useState('');
  const [scopeQty, setScopeQty] = useState('1');
  const addScopeItem = () => {
    if (!scopePick) return;
    const quantity = String(Math.max(1, Number(scopeQty) || 1));
    if (scopePick === CUSTOM_SCOPE) {
      setScopeItems((s) => [...s, { catalogId: null, name: '', quantity, unit: 'ea', unitPrice: '' }]);
    } else {
      const item = SCOPE_CATALOG.find((i) => i.id === scopePick);
      if (!item) return;
      setScopeItems((s) => [...s, { catalogId: item.id, name: item.name, quantity, unit: item.unit, unitPrice: item.unitPrice != null ? String(item.unitPrice) : '' }]);
    }
    setScopePick('');
    setScopeQty('1');
  };
  // A Sales Leader's price box starts at the catalog price; only a changed number is an override.
  const scopeOverride = (s: ScopeRow): number | null => {
    if (!canPriceScope || !s.unitPrice.trim()) return null;
    const price = Number(s.unitPrice);
    const item = s.catalogId ? SCOPE_CATALOG.find((i) => i.id === s.catalogId) : null;
    return item && item.unitPrice === price ? null : price;
  };
  // Mirrors the server (scope-items.ts): a first unit priced above the rest, unless overridden.
  const scopeRowTotal = (s: ScopeRow): number => {
    const quantity = s.quantity.trim() ? Number(s.quantity) || 0 : 1;
    const item = s.catalogId ? SCOPE_CATALOG.find((i) => i.id === s.catalogId) : null;
    if (item?.firstUnitPrice != null && item.unitPrice != null && scopeOverride(s) == null) {
      return item.firstUnitPrice + Math.max(0, quantity - 1) * item.unitPrice;
    }
    return (Number(s.unitPrice) || 0) * quantity;
  };
  const scopeSubtotal = scopeItems.reduce((sum, s) => sum + scopeRowTotal(s), 0);
  // An unpriced catalog item or a custom item can't go on a quote until a
  // Sales Leader has typed the price — the server would refuse it anyway.
  // A quantity of 0 is refused by the server (scope-items.ts); blank means one.
  const scopeQtyOk = (s: ScopeRow): boolean => !s.quantity.trim() || Number(s.quantity) > 0;
  const scopeQtyBad = scopeItems.some((s) => !scopeQtyOk(s));
  const scopeReady = !scopeQtyBad && scopeItems.every((s) => s.catalogId
    ? (SCOPE_CATALOG.find((i) => i.id === s.catalogId)?.unitPrice != null || Number(s.unitPrice) > 0)
    : (!!s.name.trim() && Number(s.unitPrice) > 0));
  const timers = useRef<number[]>([]);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 6000); };

  // Whether this type will reuse an existing report instead of re-analysing.
  const reusesPrior = DERIVED.has(type) && reports.some((r) => r.status === 'succeeded');
  const commercialJob = estimateDefaults?.formKind === 'commercial';
  const pricedInspection = type === 'inspection' && commercialJob && inspectionPricing;
  // Every commercial document scans the picked photos; a residential one never does.
  const scansPhotos = photoScan && (ALWAYS_TIER_TYPES.has(type) || type === 'inspection');

  const load = () => {
    setLoadError(null);
    return api
      .get<{ configured: boolean; missing?: string[]; reports: Report[] }>(`/api/clients/${externalId}/reports`)
      .then((r) => { setCfg({ configured: r.configured, missing: r.missing }); setReports(r.reports || []); })
      .catch(() => setLoadError('Couldn\'t load reports.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); return () => { timers.current.forEach(clearTimeout); timers.current = []; }; }, [externalId]);

  // Poll a queued/running job every 5s. Give-up window matches the server's
  // own STALE_AFTER_MS (8 min, server/reports/routes.ts) — it used to give up
  // at 5 min while the server didn't mark a report failed until 8, so in that
  // 3-minute gap the UI went silent with the chip stuck on "Generating…"
  // until a manual reload.
  const POLL_GIVEUP_MS = 8 * 60 * 1000;
  const poll = (reportId: string, started = Date.now()) => {
    const t = window.setTimeout(async () => {
      timers.current = timers.current.filter((id) => id !== t);
      try {
        const j = await api.get<{ status: string }>(`/api/reports/${reportId}`);
        await load();
        if (j.status === 'queued' || j.status === 'running') {
          if (Date.now() - started < POLL_GIVEUP_MS) poll(reportId, started);
          else flash('Still working — check back in a bit, or reload this page.');
        }
        else if (j.status === 'succeeded') flash('Report ready ✅');
        else if (j.status === 'failed') flash('That report failed to generate.');
      } catch { /* stop polling on error; the list still refreshes on reload */ }
    }, 5000);
    timers.current.push(t);
  };

  // Peek at what's on the job in JobTread when the form opens, plus Estimate
  // defaults from the job's latest submitted field inspection.
  useEffect(() => {
    if (!open || ctx || ctxLoading) return;
    setCtxLoading(true);
    api.get<{ counts: typeof ctx; estimateDefaults: EstimateDefaults | null; photos?: Array<{ url: string; caption?: string }>; analyzeLimit?: number; photoScan?: boolean }>(`/api/clients/${externalId}/report-context`)
      .then((r) => {
        setCtx(r.counts);
        setEstimateDefaults(r.estimateDefaults);
        setJobPhotos(r.photos || []);
        if (r.analyzeLimit) setAnalyzeLimit(r.analyzeLimit);
        setPhotoScan(!!r.photoScan);
      })
      .catch(() => {})
      .finally(() => setCtxLoading(false));
  }, [open, externalId]);

  useEffect(() => {
    if (!open || products.length) return;
    api.get<{ products: RoofingProduct[]; commercial?: RoofingProduct[] }>('/api/reports/roofing-products')
      .then((r) => { setProducts(r.products || []); setCommercial(r.commercial || []); })
      .catch(() => {});
  }, [open]);

  // Prefill the customization step from the field inspection ONCE it loads,
  // the first time the rep switches to a tier-picker type — never overwrites
  // a choice they've already started making.
  useEffect(() => {
    if (!(TIER_TYPES.has(type) || pricedInspection) || !estimateDefaults || defaultsApplied) return;
    if (estimateDefaults.squares) setSquares(String(estimateDefaults.squares));
    if (estimateDefaults.formKind === 'commercial') { setTierGood('dura_last_layover'); setTierBetter('dura_last_tpo'); setTierBest('gaf_commercial_tpo'); }
    setDefaultsApplied(true);
  }, [type, estimateDefaults, defaultsApplied, pricedInspection]);
  // The repair-or-replace default belongs to the Estimate alone, so it waits
  // for the rep to actually open one rather than being spent on another type.
  useEffect(() => {
    if (type !== 'estimate' || !estimateDefaults || modeApplied) return;
    setEstimateMode(estimateDefaults.mode);
    setModeApplied(true);
  }, [type, estimateDefaults, modeApplied]);

  // Push a finished report's estimate into JobTread as real records (all drafts).
  const [pushing, setPushing] = useState<string | null>(null);
  const toJobTread = async (reportId: string) => {
    if (pushing) return;
    setPushing(reportId);
    try {
      const r = await api.post<{
        proposal?: { ok: boolean }; budget?: { ok: boolean; created: number }; materialOrder?: { ok: boolean };
        updated?: boolean; upToDate?: boolean; lineCount?: number; message?: string;
      }>(
        `/api/clients/${externalId}/reports/${reportId}/to-jobtread`,
        { proposal: true, budget: true, materialOrder: true },
      );
      if (r.upToDate) {
        flash('JobTread already matches this report — nothing to change.');
      } else if (r.updated) {
        // The draft was rewritten rather than duplicated, which is the whole
        // point: one job, one proposal, one price.
        flash(`Updated the existing JobTread proposal — ${r.lineCount} line${r.lineCount === 1 ? '' : 's'}, still a draft.`);
      } else {
        const made = [
          r.proposal?.ok ? 'proposal' : null,
          r.budget?.ok ? `budget (${r.budget.created} items)` : null,
          r.materialOrder?.ok ? 'material order' : null,
        ].filter(Boolean).join(', ');
        flash(made ? `Created in JobTread as drafts: ${made}. Review there, then send for signature.` : "Nothing created — that report has no pricing yet.");
      }
      await load();
    } catch (e: any) {
      // A 409 is a deliberate refusal (the proposal is already with the
      // customer), not a failure — say what it is, and what to do instead.
      flash(e?.message || "Couldn't create in JobTread.");
    } finally { setPushing(null); }
  };

  const [presenting, setPresenting] = useState<string | null>(null);
  const present = async (reportId: string) => {
    if (presenting) return;
    setPresenting(reportId);
    try {
      await api.post(`/api/clients/${externalId}/reports/${reportId}/present`, {});
      await load();
    } catch (e: any) {
      flash(`Couldn't mark it presented: ${e?.message || 'failed'}`);
    } finally { setPresenting(null); }
  };

  const [deleting, setDeleting] = useState<string | null>(null);
  const remove = async (r: Report) => {
    if (deleting) return;
    const name = r.title || 'this report';
    const warning = r.status === 'succeeded'
      ? `Delete "${name}"? Its link stops working for anyone you sent it to. This can't be undone.`
      : `Delete "${name}"? This can't be undone.`;
    if (!window.confirm(warning)) return;
    setDeleting(r.reportId);
    try {
      await api.delete(`/api/clients/${externalId}/reports/${r.reportId}`);
      if (building === r.reportId) setBuilding(null);
      if (refining === r.reportId) setRefining(null);
      await load();
    } catch (e: any) {
      flash(`Couldn't delete it: ${e?.message || 'failed'}`);
    } finally { setDeleting(null); }
  };

  // Proposal is always the Good/Better/Best comparison; Estimate only needs
  // tiers when the rep explicitly switches it to replacement mode.
  const isReplacement = (type === 'estimate' && (estimateMode === 'replacement' || estimateMode === 'both')) || ALWAYS_TIER_TYPES.has(type) || pricedInspection;

  // A tier is either a catalog key, or (when set to CUSTOM_PRODUCT) a
  // rep-typed product name + $/SQ rate — same shape the server accepts.
  const tierFilled = (key: string, tierKey: 'good' | 'better' | 'best') =>
    serviceOf(key) ? serviceTierRateOk(serviceRate[tierKey])
    : key === CUSTOM_PRODUCT
      ? !!customProduct[tierKey].name.trim() && Number(customProduct[tierKey].ratePerSquare) > 0
      : !!key;
  const tierPayload = (key: string, tierKey: 'good' | 'better' | 'best') =>
    serviceOf(key) ? { service: serviceOf(key)!, ratePerSquare: Number(serviceRate[tierKey]) }
    : key === CUSTOM_PRODUCT
      ? { name: customProduct[tierKey].name.trim(), ratePerSquare: Number(customProduct[tierKey].ratePerSquare) }
      : key;

  // Only a commercial tear-off strips to the deck, so only it carries ISO —
  // the server prices the R-value into that tier alone (roofing-products.ts).
  const hasTearOff = [tierGood, tierBetter, tierBest].some((k) => commercial.find((c) => c.key === k)?.system === 'tear_off');

  const replacementReady = !isReplacement || (
    tierFilled(tierGood, 'good') && tierFilled(tierBetter, 'better') && tierFilled(tierBest, 'best') && Number(squares) > 0 && scopeReady
  );

  const generate = async () => {
    if (busy || !replacementReady) return;
    setBusy(true);
    try {
      setOpen(false);
      flash('Generating… this takes 1–3 minutes. You can leave this page.');
      const r = await api.post<{ id: string; status: string; usedPhotos?: number; analyzedPhotos?: number; warning?: string }>(`/api/clients/${externalId}/reports/generate`, {
        reportType: type,
        photos: photos.split(/\s+/).map((s) => s.trim()).filter(Boolean),
        includeJobFiles: useJobFiles,
        ...(picked.length ? { analyzePhotoUrls: picked } : {}),
        // Only send lines that have a name and a price — the server drops the
        // rest anyway, but sending them would misreport what was added.
        ...(customLines.some((l) => l.name.trim() && l.unitPrice.trim())
          ? {
              customLines: customLines
                .filter((l) => l.name.trim() && l.unitPrice.trim())
                .map((l) => ({
                  name: l.name.trim(),
                  // Blank means one. A typed 0 or "abc" goes as typed so the
                  // server can say so, rather than quietly pricing one unit.
                  ...(l.quantity.trim() ? { quantity: Number(l.quantity) } : {}),
                  unit: l.unit.trim() || 'ea',
                  unitPrice: Number(l.unitPrice) || 0,
                })),
            }
          : {}),
        ...(isReplacement ? {
          ...(type === 'estimate' ? { estimateMode } : {}),
          ...(pricedInspection ? { includePricing: true } : {}),
          tierSelection: {
            good: tierPayload(tierGood, 'good'),
            better: tierPayload(tierBetter, 'better'),
            best: tierPayload(tierBest, 'best'),
          },
          selectedTier,
          squares: Number(squares),
          ...(hasTearOff && isoTier ? { isoTier } : {}),
          // A rep's row carries no price (the server prices it from the
          // catalog); a Sales Leader's typed price is sent as an override.
          ...(scopeItems.length ? {
            scopeItems: scopeItems.map((s) => ({
              ...(s.catalogId ? { catalogId: s.catalogId } : { name: s.name.trim(), unit: s.unit.trim() || 'ea' }),
              ...(s.quantity.trim() ? { quantity: Number(s.quantity) } : {}),
              ...(scopeOverride(s) != null ? { unitPrice: scopeOverride(s) } : {}),
            })),
          } : {}),
        } : {}),
      }, { timeoutMs: 9 * 60 * 1000 }); // generation runs synchronously server-side, up to ~8 min
      setPhotos('');
      const n = r.analyzedPhotos ?? 0;
      flash(r.warning ? `⚠️ ${r.warning}` : r.status === 'succeeded' ? `Report ready ✅${n ? ` — analysed ${n} photo${n > 1 ? 's' : ''}` : ''}` : 'Report started.');
      await load();
      if (r.id && r.status !== 'succeeded') poll(r.id);
    } catch (e: any) {
      // The panel was already closed above so the rep could leave the page —
      // on failure there was no way back to it short of "+ New report" again,
      // even though every field they'd picked (type, tiers, squares) was
      // still sitting in state untouched.
      setOpen(true);
      flash(`Couldn't start it: ${e?.message || 'failed'}`);
    }
    finally { setBusy(false); }
  };

  return (
    building ? (
      <ReportEditor externalId={externalId} reportId={building} onBack={() => { setBuilding(null); load(); }} />
    ) : (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">🏠 Roof reports</h3>
        {cfg.configured && <button onClick={() => setOpen((v) => !v)} className="text-xs px-2.5 py-1 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark">＋ New report</button>}
      </div>

      {toast && <div className="px-4 py-2 text-sm bg-gray-900 text-white">{toast}</div>}

      {!cfg.configured ? (
        <p className="px-4 py-6 text-center text-sm text-gray-400">
          Roof reports aren't connected yet{cfg.missing?.length ? ` (missing ${cfg.missing.join(', ')})` : ''}.
        </p>
      ) : (
        <>
          {open && (
            <div className="p-4 border-b border-gray-100 space-y-3">
              <div className="flex flex-wrap gap-2">
                {TYPES.map((t) => (
                  <button key={t.key} onClick={() => setType(t.key)} aria-pressed={type === t.key} className={`text-xs px-2.5 py-1 rounded-full border ${type === t.key ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-500'}`}>{t.label}</button>
                ))}
              </div>
              {/* What we'll pull from this job in JobTread */}
              <label className="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 rounded-lg p-2.5 cursor-pointer">
                <input type="checkbox" checked={useJobFiles} onChange={(e) => setUseJobFiles(e.target.checked)} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="font-medium">Use this job's JobTread file</span>
                  <span className="block text-xs text-gray-500">
                    {ctxLoading ? 'Checking what\'s on the job…'
                      : ctx ? [
                          ctx.photos ? `${ctx.photos} photo${ctx.photos > 1 ? 's' : ''}` : null,
                          ctx.messages ? `${ctx.messages} message${ctx.messages > 1 ? 's' : ''}` : null,
                          ctx.documents ? `${ctx.documents} document${ctx.documents > 1 ? 's' : ''}` : null,
                          ctx.dailyLogs ? `${ctx.dailyLogs} daily log${ctx.dailyLogs > 1 ? 's' : ''}` : null,
                        ].filter(Boolean).join(' · ') || 'Nothing attached to this job yet'
                      : 'Photos, messages, documents and daily logs'}
                  </span>
                </span>
              </label>
              <p className="text-xs text-gray-500 -mt-1">
                {type === 'inspection' && commercialJob
                  ? 'The commercial condition report: the building, the roof layer by layer, every rated component, and a live diagram of what a coating, a recover or a new roof would do. The photos you pick are read and described; the ratings always come from the checklist.'
                  : TYPES.find((t) => t.key === type)?.hint}
              </p>

              {/* Pick which photos get analysed. Six photos show the damage;
                  ninety show a driveway. Everything not picked still appears
                  in the report's appendix — nothing is dropped. */}
              {useJobFiles && jobPhotos.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-600">
                      {scansPhotos && <span className="font-semibold text-gray-800">AI photo scan · </span>}
                      {picked.length
                        ? <><span className="font-semibold text-gray-800">{picked.length}</span> of {jobPhotos.length} photos will be {scansPhotos ? 'read before the report is written' : 'analysed'}</>
                        : <>First {Math.min(analyzeLimit, jobPhotos.length)} of {jobPhotos.length} photos will be {scansPhotos ? 'read before the report is written' : 'analysed'}</>}
                      {jobPhotos.length > analyzeLimit && <span className="text-gray-400"> · rest go in the appendix</span>}
                      {scansPhotos && <span className="block text-gray-400">Pick up to {analyzeLimit}. Each one is sorted by the part of the roof it shows and described; you can edit every word afterwards.</span>}
                    </span>
                    <button onClick={() => setShowPicker((v) => !v)} className="text-xs px-2 py-1 rounded-lg bg-white border border-gray-200 text-gray-600 hover:border-gray-300 whitespace-nowrap">
                      {showPicker ? 'Done' : 'Choose photos'}
                    </button>
                  </div>

                  {showPicker && (
                    <>
                      <div className="flex gap-2">
                        <button onClick={() => setPicked(jobPhotos.slice(0, analyzeLimit).map((p) => p.url))}
                          className="text-[11px] px-2 py-1 rounded bg-white border border-gray-200 text-gray-600">Select first {analyzeLimit}</button>
                        <button onClick={() => setPicked([])} className="text-[11px] px-2 py-1 rounded bg-white border border-gray-200 text-gray-600">Clear</button>
                      </div>
                      <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 max-h-64 overflow-y-auto">
                        {jobPhotos.map((p) => {
                          const on = picked.includes(p.url);
                          const full = !on && picked.length >= analyzeLimit;
                          return (
                            <button
                              key={p.url}
                              disabled={full}
                              onClick={() => setPicked((ps) => ps.includes(p.url) ? ps.filter((u) => u !== p.url) : [...ps, p.url])}
                              title={full ? `That's the ${analyzeLimit}-photo limit — unpick one first` : p.caption || 'Job photo'}
                              className={`relative aspect-square rounded-lg overflow-hidden border-2 ${on ? 'border-brand' : 'border-transparent'} ${full ? 'opacity-40 cursor-not-allowed' : ''}`}
                            >
                              <img src={p.url} alt={p.caption || 'Job photo'} loading="lazy" className="w-full h-full object-cover" />
                              {on && <span className="absolute top-0.5 right-0.5 bg-brand text-on-brand text-[10px] w-4 h-4 rounded-full flex items-center justify-center">✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {(TIER_TYPES.has(type) || (type === 'inspection' && commercialJob)) && (
                <div className="bg-gray-50 rounded-lg p-3 space-y-3">
                  {type === 'inspection' && (
                    <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                      <input type="checkbox" checked={inspectionPricing} onChange={(e) => setInspectionPricing(e.target.checked)} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="font-medium">Include options and pricing</span>
                        <span className="block text-xs text-gray-500">Adds Good / Better / Best with prices, and draws the layer diagram for those three systems. Leave it off for a condition report with no price on it.</span>
                      </span>
                    </label>
                  )}
                  {type === 'estimate' && (
                    <div className="flex gap-2">
                      {(['repair', 'replacement', 'both'] as const).map((m) => (
                        <button key={m} onClick={() => setEstimateMode(m)} aria-pressed={estimateMode === m} className={`flex-1 text-xs px-2.5 py-1.5 rounded-lg border font-medium ${estimateMode === m ? 'bg-brand text-on-brand border-brand' : 'bg-white border-gray-200 text-gray-600'}`}
                          title={m === 'both' ? 'Show the repair price and the new-roof price side by side, with a recommendation' : undefined}>
                          {m === 'repair' ? 'Repair' : m === 'replacement' ? 'Replacement' : 'Both — let them choose'}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Type in what the roof needs. Added to the repair scope and
                      priced exactly as entered — no markup is re-applied to a
                      number the rep wrote down themselves. */}
                  {type === 'estimate' && estimateMode !== 'replacement' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-600">Add your own line items</span>
                        <button
                          onClick={() => setCustomLines((ls) => [...ls, { name: '', quantity: '1', unit: 'ea', unitPrice: '' }])}
                          className="text-xs px-2 py-1 rounded-lg bg-white border border-gray-200 text-gray-600 hover:border-gray-300">
                          ＋ Add line
                        </button>
                      </div>
                      {customLines.map((l, i) => (
                        <div key={i} className="flex gap-1.5 items-center">
                          <input value={l.name} placeholder="What's needed"
                            onChange={(e) => setCustomLines((ls) => ls.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                            className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
                          <input value={l.quantity} inputMode="decimal" placeholder="Qty" aria-label="Quantity"
                            onChange={(e) => setCustomLines((ls) => ls.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))}
                            className="w-14 text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
                          <input value={l.unit} placeholder="unit" aria-label="Unit"
                            onChange={(e) => setCustomLines((ls) => ls.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))}
                            className="w-14 text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
                          <input value={l.unitPrice} inputMode="decimal" placeholder="$ each" aria-label="Price each"
                            onChange={(e) => setCustomLines((ls) => ls.map((x, j) => j === i ? { ...x, unitPrice: e.target.value } : x))}
                            className="w-20 text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
                          <button onClick={() => setCustomLines((ls) => ls.filter((_, j) => j !== i))}
                            aria-label="Remove line" className="text-xs text-gray-400 hover:text-red-600 px-1">✕</button>
                        </div>
                      ))}
                      {customLines.some((l) => l.name.trim() && l.quantity.trim() && !(Number(l.quantity) > 0)) && (
                        <p className="text-[11px] text-red-600">Each line needs a quantity above 0 (leave it blank for 1).</p>
                      )}
                      {customLines.length > 0 && (
                        <p className="text-[11px] text-gray-500">
                          Adds {customLines.filter((l) => l.name.trim() && l.unitPrice.trim()).length} line
                          {customLines.filter((l) => l.name.trim() && l.unitPrice.trim()).length === 1 ? '' : 's'} · $
                          {customLines
                            .filter((l) => l.name.trim() && l.unitPrice.trim())
                            .reduce((sum, l) => sum + (Number(l.unitPrice) || 0) * (l.quantity.trim() ? Number(l.quantity) || 0 : 1), 0)
                            .toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      )}

                      {/* Priced quick-adds for the two standing add-ons, so a rep
                          never has to remember or type these rates by hand. */}
                      <div className="border-t border-gray-100 pt-2 mt-1 space-y-2">
                        <div className="flex flex-wrap items-end gap-1.5">
                          <div>
                            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Tune-Up</label>
                            <select value={tuneUpTier} onChange={(e) => setTuneUpTier(e.target.value as TuneUpTier)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5">
                              <option value="basic">Basic — ${TUNE_UP_RATES.basic}/sq</option>
                              <option value="advanced">Advanced — ${TUNE_UP_RATES.advanced}/sq</option>
                            </select>
                          </div>
                          <input type="number" inputMode="numeric" min="1" value={tuneUpSquares} onChange={(e) => setTuneUpSquares(e.target.value)}
                            placeholder="Squares" aria-label="Tune-up squares" className="w-20 text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
                          <label className="flex items-center gap-1 text-[11px] text-gray-600 pb-1.5">
                            <input type="checkbox" checked={tuneUpSteep} onChange={(e) => setTuneUpSteep(e.target.checked)} />
                            Steep (+$20/sq)
                          </label>
                          <button
                            onClick={() => {
                              const sq = Number(tuneUpSquares);
                              if (!(sq > 0)) return;
                              const line = tuneUpLineItem(tuneUpTier, sq, tuneUpSteep);
                              setCustomLines((ls) => [...ls, { name: line.name, quantity: String(line.quantity), unit: line.unit, unitPrice: String(line.unitPrice) }]);
                              setTuneUpSquares('');
                            }}
                            disabled={!(Number(tuneUpSquares) > 0)}
                            className="text-xs px-2 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-50">
                            ＋ Add
                          </button>
                        </div>
                        <div className="flex flex-wrap items-end gap-1.5">
                          <div>
                            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Cleaning</label>
                            <select value={cleaningTier} onChange={(e) => setCleaningTier(e.target.value as CleaningTier)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5">
                              <option value="basic">Basic — ${CLEANING_RATES.basic}/sq</option>
                              <option value="advanced">Advanced — ${CLEANING_RATES.advanced}/sq</option>
                            </select>
                          </div>
                          <input type="number" inputMode="numeric" min="1" value={cleaningSquares} onChange={(e) => setCleaningSquares(e.target.value)}
                            placeholder="Squares" aria-label="Cleaning squares" className="w-20 text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
                          <label className="flex items-center gap-1 text-[11px] text-gray-600 pb-1.5">
                            <input type="checkbox" checked={cleaningSteep} onChange={(e) => setCleaningSteep(e.target.checked)} />
                            Steep (+$20/sq)
                          </label>
                          <button
                            onClick={() => {
                              const sq = Number(cleaningSquares);
                              if (!(sq > 0)) return;
                              const line = cleaningLineItem(cleaningTier, sq, cleaningSteep);
                              setCustomLines((ls) => [...ls, { name: line.name, quantity: String(line.quantity), unit: line.unit, unitPrice: String(line.unitPrice) }]);
                              setCleaningSquares('');
                            }}
                            disabled={!(Number(cleaningSquares) > 0)}
                            className="text-xs px-2 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-50">
                            ＋ Add
                          </button>
                        </div>
                        <div className="flex flex-wrap items-end gap-1.5">
                          <div>
                            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Perma-Boot</label>
                            <input type="number" inputMode="numeric" min="1" value={bootCount} onChange={(e) => setBootCount(e.target.value)}
                              placeholder="Count" aria-label="Perma-boot count" className="w-20 text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
                          </div>
                          <button
                            onClick={() => {
                              const count = Number(bootCount);
                              if (!(count > 0)) return;
                              const lines = permaBootLineItems(count);
                              setCustomLines((ls) => [...ls, ...lines.map((l) => ({ name: l.name, quantity: String(l.quantity), unit: l.unit, unitPrice: String(l.unitPrice) }))]);
                              setBootCount('');
                            }}
                            disabled={!(Number(bootCount) > 0)}
                            className="text-xs px-2 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-50">
                            ＋ Add
                          </button>
                          <div className="ml-2">
                            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Water Diverter</label>
                            <input type="number" inputMode="numeric" min="1" value={diverterCount} onChange={(e) => setDiverterCount(e.target.value)}
                              placeholder="Count" aria-label="Water diverter count" className="w-20 text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
                          </div>
                          <button
                            onClick={() => {
                              const line = waterDiverterLineItem(Number(diverterCount));
                              if (!line) return;
                              setCustomLines((ls) => [...ls, { name: line.name, quantity: String(line.quantity), unit: line.unit, unitPrice: String(line.unitPrice) }]);
                              setDiverterCount('');
                            }}
                            disabled={!(Number(diverterCount) > 0)}
                            className="text-xs px-2 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-50">
                            ＋ Add
                          </button>
                        </div>
                        <p className="text-[11px] text-gray-400">Perma-Boots: ${PERMA_BOOT_FIRST_RATE} for the first, ${PERMA_BOOT_RATE} each after. Water diverters: ${WATER_DIVERTER_RATE} each.</p>
                      </div>
                    </div>
                  )}

                  {type === 'estimate' && estimateDefaults?.recommendation === 'Full replacement' && estimateMode === 'repair' && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">The field inspection recommended a full replacement — consider switching to Replacement.</p>
                  )}
                  {isReplacement && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          ['Good', 'good', tierGood, setTierGood],
                          ['Better', 'better', tierBetter, setTierBetter],
                          ['Best', 'best', tierBest, setTierBest],
                        ] as const).map(([label, tierKey, val, set]) => (
                          <div key={label}>
                            <label className="block text-[11px] font-semibold text-gray-500 mb-1">{label}</label>
                            <select value={val} onChange={(e) => set(e.target.value)} className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5">
                              <option value="">Select…</option>
                              <optgroup label="Residential">
                                {products.map((p) => <option key={p.key} value={p.key}>{p.name} — ${p.ratePerSquare}/sq</option>)}
                              </optgroup>
                              {commercial.length > 0 && (
                                <optgroup label="Commercial low-slope">
                                  {commercial.map((p) => <option key={p.key} value={p.key}>{p.name} — ${p.ratePerSquare}/sq</option>)}
                                </optgroup>
                              )}
                              <optgroup label={`Service on the existing roof — you set $${SERVICE_TIER_RATE_MIN}–$${SERVICE_TIER_RATE_MAX}/sq`}>
                                {(['tune_up', 'cleaning'] as ServiceTierKey[]).map((k) => <option key={k} value={`${SERVICE_PREFIX}${k}`}>{SERVICE_TIER_LABELS[k]}</option>)}
                              </optgroup>
                              <option value={CUSTOM_PRODUCT}>＋ Custom product…</option>
                            </select>
                            {serviceOf(val) && (
                              <div className="mt-1">
                                <input
                                  type="number" min={SERVICE_TIER_RATE_MIN} max={SERVICE_TIER_RATE_MAX} step="0.01" inputMode="decimal"
                                  value={serviceRate[tierKey]}
                                  onChange={(e) => setServiceRate((r) => ({ ...r, [tierKey]: e.target.value }))}
                                  placeholder={`$${SERVICE_TIER_RATE_MIN}–$${SERVICE_TIER_RATE_MAX} per square`}
                                  aria-label={`${label} ${SERVICE_TIER_LABELS[serviceOf(val)!]} rate per square`}
                                  className={`w-full text-xs border rounded-lg px-2 py-1.5 ${serviceRate[tierKey] && !serviceTierRateOk(serviceRate[tierKey]) ? 'border-red-400' : 'border-gray-200'}`}
                                />
                                {serviceRate[tierKey] && !serviceTierRateOk(serviceRate[tierKey]) && (
                                  <p className="text-[11px] text-red-600 mt-0.5">Pick ${SERVICE_TIER_RATE_MIN} to ${SERVICE_TIER_RATE_MAX} a square, in whole cents.</p>
                                )}
                              </div>
                            )}
                            {val === CUSTOM_PRODUCT && (
                              <div className="mt-1 space-y-1">
                                <input
                                  value={customProduct[tierKey].name}
                                  onChange={(e) => setCustomProduct((c) => ({ ...c, [tierKey]: { ...c[tierKey], name: e.target.value } }))}
                                  placeholder="Product name"
                                  className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5"
                                />
                                <input
                                  value={customProduct[tierKey].ratePerSquare}
                                  onChange={(e) => setCustomProduct((c) => ({ ...c, [tierKey]: { ...c[tierKey], ratePerSquare: e.target.value } }))}
                                  inputMode="decimal"
                                  placeholder="$ per square"
                                  className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5"
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      {hasTearOff && (
                        <div className="flex items-end gap-2">
                          <div className="flex-1">
                            <label className="block text-[11px] font-semibold text-gray-500 mb-1">ISO insulation (tear-off tiers)</label>
                            <select value={isoTier} onChange={(e) => setIsoTier(e.target.value as IsoTier | '')} className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5">
                              <option value="r25">R-25 ISO (4.2")</option>
                              <option value="r30">R-30 ISO (5.2")</option>
                              <option value="">None — insulation quoted separately</option>
                            </select>
                            <p className="text-[11px] text-gray-400 mt-0.5">Priced into the tear-off tier's rate only; a layover or coating keeps the existing insulation.</p>
                          </div>
                        </div>
                      )}
                      <div className="flex items-end gap-2">
                        <div className="flex-1">
                          <label className="block text-[11px] font-semibold text-gray-500 mb-1">Roof size (squares)</label>
                          <input type="number" inputMode="numeric" min="1" value={squares} onChange={(e) => setSquares(e.target.value)} placeholder="e.g. 32" className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
                          {/* Where the number came from decides whether a rep
                              should trust it or go measure. A measured report
                              and a satellite guess are not the same claim. */}
                          {estimateDefaults?.squaresSource && (
                            <p className={`text-[11px] mt-0.5 ${/measured/.test(estimateDefaults.squaresSource) ? 'text-emerald-700' : 'text-gray-400'}`}>
                              {/measured/.test(estimateDefaults.squaresSource) ? '📐 ' : ''}From {estimateDefaults.squaresSource}
                            </p>
                          )}
                        </div>
                        <div className="flex-1">
                          <label className="block text-[11px] font-semibold text-gray-500 mb-1">Quoting which tier?</label>
                          <select value={selectedTier} onChange={(e) => setSelectedTier(e.target.value as any)} className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5">
                            <option value="good">Good</option>
                            <option value="better">Better</option>
                            <option value="best">Best</option>
                          </select>
                        </div>
                      </div>
                      <p className="text-[11px] text-gray-500">All three show on the document as a comparison; the tier you pick here is the one priced and pushed to JobTread.</p>

                      {/* Specialty scope on top of the roof system — skylights,
                          chimney work, decking, ventilation, gutters, a low-slope
                          membrane section. Itemised on the document and pushed to
                          JobTread with the tier line. */}
                      <div className="border-t border-gray-100 pt-2 space-y-1.5">
                        <span className="text-xs font-medium text-gray-600">Additional scope</span>
                        <div className="flex flex-wrap items-end gap-1.5">
                          <select value={scopePick} onChange={(e) => setScopePick(e.target.value)} aria-label="Scope item" className="flex-1 min-w-[200px] text-xs border border-gray-200 rounded-lg px-2 py-1.5">
                            <option value="">Add an item…</option>
                            {(Object.keys(SCOPE_CATEGORY_LABELS) as Array<keyof typeof SCOPE_CATEGORY_LABELS>).map((cat) => {
                              const items = SCOPE_CATALOG.filter((i) => i.category === cat && (i.unitPrice != null || canPriceScope));
                              return items.length ? (
                                <optgroup key={cat} label={SCOPE_CATEGORY_LABELS[cat]}>
                                  {items.map((i) => <option key={i.id} value={i.id}>{i.name} — {i.unitPrice == null ? 'price needed' : i.firstUnitPrice != null ? `$${i.firstUnitPrice} first, $${i.unitPrice}/${i.unit} after` : `$${i.unitPrice}/${i.unit}`}</option>)}
                                </optgroup>
                              ) : null;
                            })}
                            {canPriceScope && <option value={CUSTOM_SCOPE}>＋ Custom item…</option>}
                          </select>
                          <input type="number" inputMode="numeric" min="1" value={scopeQty} onChange={(e) => setScopeQty(e.target.value)} placeholder="Qty" aria-label="Scope quantity" className="w-16 text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
                          <button onClick={addScopeItem} disabled={!scopePick} className="text-xs px-2 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-50">＋ Add</button>
                        </div>
                        {scopeItems.map((s, i) => (
                          <div key={i} className="flex gap-1.5 items-center">
                            {s.catalogId ? (
                              <span className="flex-1 min-w-0 text-xs text-gray-800 truncate">{s.name}</span>
                            ) : (
                              <input value={s.name} placeholder="Custom item" aria-label="Custom scope item"
                                onChange={(e) => setScopeItems((ls) => ls.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                                className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
                            )}
                            <input value={s.quantity} inputMode="decimal" aria-label="Quantity"
                              onChange={(e) => setScopeItems((ls) => ls.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))}
                              className="w-14 text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
                            {s.catalogId ? (
                              <span className="w-12 text-xs text-gray-500">{s.unit}</span>
                            ) : (
                              <input value={s.unit} placeholder="unit" aria-label="Unit"
                                onChange={(e) => setScopeItems((ls) => ls.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))}
                                className="w-14 text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
                            )}
                            {canPriceScope ? (
                              <input value={s.unitPrice} inputMode="decimal" placeholder="$ each" aria-label="Price each"
                                onChange={(e) => setScopeItems((ls) => ls.map((x, j) => j === i ? { ...x, unitPrice: e.target.value } : x))}
                                className={`w-20 text-xs border rounded-lg px-2 py-1.5 ${Number(s.unitPrice) > 0 ? 'border-gray-200' : 'border-amber-400'}`} />
                            ) : (
                              <span className="w-20 text-xs text-gray-700 text-right">
                                {(() => {
                                  const item = s.catalogId ? SCOPE_CATALOG.find((x) => x.id === s.catalogId) : null;
                                  return item?.firstUnitPrice != null
                                    ? `$${item.firstUnitPrice} / $${item.unitPrice}`
                                    : `$${Number(s.unitPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                                })()}
                              </span>
                            )}
                            <button onClick={() => setScopeItems((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove scope item" className="text-xs text-gray-400 hover:text-red-600 px-1">✕</button>
                          </div>
                        ))}
                        {scopeItems.length > 0 && (
                          <p className="text-[11px] text-gray-500">
                            {scopeItems.length} item{scopeItems.length === 1 ? '' : 's'} · ${scopeSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} on top of the roof system
                            {!scopeReady && <span className="text-amber-700"> — {scopeQtyBad ? 'an item needs a quantity above 0' : 'an item still needs a price'}</span>}
                          </p>
                        )}
                        <p className="text-[11px] text-gray-400">
                          {canPriceScope
                            ? 'Catalog prices are filled in; you can adjust any price or add a custom item.'
                            : 'Priced from the company catalog. Ask a Sales Leader to adjust a price or add something not listed.'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <textarea value={photos} onChange={(e) => setPhotos(e.target.value)} rows={2} placeholder="Extra photo URLs (optional, one per line)" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-400" />
              <div className="flex gap-2">
                <button onClick={generate} disabled={busy || !replacementReady} title={!replacementReady ? 'Pick all three tiers and enter the roof size first' : undefined} className="text-sm px-3 py-1.5 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark disabled:opacity-50">{busy ? (reusesPrior ? 'Building…' : 'Generating… (2–5 min)') : 'Generate report'}</button>
                <button onClick={() => setOpen(false)} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600">Cancel</button>
              </div>
              <p className="text-xs text-gray-400">{reusesPrior
                ? 'Builds from this job\u2019s most recent report, so the findings and pricing match what the customer has already seen. Ready in a few seconds.'
                : 'Pulls the job\u2019s photos, notes and documents from JobTread, analyses the photos for damage, and builds the report here. Takes 2\u20135 minutes \u2014 you can leave this page and come back.'}</p>
            </div>
          )}

          {loading ? (
            <div className="p-3 space-y-2">{[0, 1].map((i) => <div key={i} className="h-12 bg-gray-50 rounded animate-pulse" />)}</div>
          ) : loadError ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">
              <p>Couldn't load reports.</p>
              <button onClick={load} className="mt-2 text-sm text-blue-600 hover:underline">Retry</button>
            </div>
          ) : reports.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">No roof reports yet for this client.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {reports.map((r) => (
                <div key={r.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="text-lg mt-0.5">🏠</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{r.title || (r.reportType ? r.reportType[0].toUpperCase() + r.reportType.slice(1) : 'Report')}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {r.createdAt ? fmtDate(r.createdAt) : ''}
                      {r.error ? ` · ⚠️ ${r.error}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 whitespace-nowrap">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded capitalize ${statusChip(r.status)}`}>
                      {r.status === 'running' || r.status === 'queued' ? 'Generating…' : r.status}
                    </span>
                    {r.status === 'succeeded' && r.jobtread?.stale && r.jobtread?.locked && (
                      <p className="w-full text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 mt-1">
                        ⚠ {r.jobtread.message}
                      </p>
                    )}
                    {r.status === 'succeeded' && (
                      <span className="flex items-center gap-2">
                        {r.reportUrl && <a href={r.reportUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">View</a>}
                        {r.pdfUrl && <a href={r.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">PDF</a>}
                        <button
                          onClick={() => toJobTread(r.reportId)}
                          disabled={pushing === r.reportId || r.jobtread?.locked}
                          title={
                            r.jobtread?.locked
                              ? r.jobtread.message || 'That proposal is already with the customer.'
                              : r.jobtread?.stale
                                ? 'Update the JobTread proposal to match this report'
                                : r.jobtread?.pushed
                                  ? 'JobTread already has this report'
                                  : 'Create a signature-ready proposal, the job budget, and a material/work order in JobTread (all drafts)'
                          }
                          className={`text-xs disabled:opacity-50 ${
                            r.jobtread?.stale && !r.jobtread?.locked
                              ? 'text-amber-700 font-medium hover:underline'
                              : 'text-blue-600 hover:underline'
                          }`}
                        >
                          {pushing === r.reportId
                            ? 'Sending…'
                            : r.jobtread?.stale && !r.jobtread?.locked
                              ? '↻ Update JobTread'
                              : r.jobtread?.pushed
                                ? '✓ In JobTread'
                                : '→ JobTread'}
                        </button>
                        <button
                          onClick={() => setBuilding(r.reportId)}
                          title="Edit anything — layout, photos, findings, pricing, text — with a live preview"
                          // The primary action in this row, and it was the
                          // smallest thing in it — ~20px is not a thumb target.
                          className="text-xs px-2.5 py-1.5 rounded bg-brand text-on-brand font-medium hover:bg-brand-dark"
                        >
                          ✎ Edit
                        </button>
                        <button
                          onClick={() => setRefining((v) => (v === r.reportId ? null : r.reportId))}
                          title="Ask for wording changes in plain English"
                          className="text-xs text-blue-600 hover:underline"
                        >
                          {refining === r.reportId ? 'Close' : '✏️ Refine'}
                        </button>
                        {r.presentedAt ? (
                          <span className="text-xs text-emerald-600" title={fmtDate(r.presentedAt) ?? undefined}>✅ Presented</span>
                        ) : (
                          <button
                            onClick={() => present(r.reportId)}
                            disabled={presenting === r.reportId}
                            title="Mark this report as shown to the customer"
                            className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                          >
                            {presenting === r.reportId ? 'Marking…' : '✅ Mark presented'}
                          </button>
                        )}
                      </span>
                    )}
                    {r.status !== 'running' && r.status !== 'queued' && (
                      <button
                        onClick={() => remove(r)}
                        disabled={deleting === r.reportId}
                        title="Delete this report"
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        {deleting === r.reportId ? 'Deleting…' : '🗑 Delete'}
                      </button>
                    )}
                  </div>
                </div>
                {refining === r.reportId && r.status === 'succeeded' && (
                  <ReportRefineChat externalId={externalId} reportId={r.reportId} onChanged={load} />
                )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
    )
  );
}
