/**
 * Helpers for the "nothing a person can type reaches the page raw" test.
 *
 * `injectDeep` walks any value and replaces EVERY string in it (at any depth,
 * inside arrays, in photo captions, in pack chapters) with a payload that would
 * run if it were ever written into a page unescaped. `scanHtml` then reads the
 * rendered page the way a browser would (tags, attributes, script and style
 * blocks) and reports every place a payload got through.
 *
 * Three payloads, chosen by what the original value looked like:
 *   html    `"><img src=x onerror=MARKnX></script><script>MARKnX</script>`
 *           breaks out of a text node, a quoted attribute, a script block.
 *   colour  `red;}</style><script>MARKnX</script>`  breaks out of CSS.
 *   url     `javascript:MARKnX`                      runs when a link is clicked.
 *
 * The same original string always gets the same payload, so ids that point at
 * each other (a photo id and the key its labels are filed under) still match.
 */
import type { AnalyzedPhoto, ComprehensiveRoofReport } from '../../comprehensive-roof-report';
import type { ChapterPack } from '../../presentation-chapters';
import type { ReportData } from '../../measurement-report-html';
import type { RoofAnalysisRecord } from '../../old-types';
import { makeReport as baseReport } from './report';

export type PayloadKind = 'html' | 'colour' | 'url';

export interface Injected<T> {
  value: T;
  /** marker number -> what kind of payload it is */
  markers: Map<number, PayloadKind>;
}

const HEX = /^#[0-9a-f]{3,8}$/i;
const URLISH_KEY = /(^|_)(url|href|src|image|logo|website|link)$|url$|image$|logo$|website$/i;
const COLOUR_KEY = /colou?r$/i;

export function htmlPayload(n: number): string {
  return `"><img src=x onerror=MARK${n}X></script><script>MARK${n}X</script>`;
}
export function colourPayload(n: number): string {
  return `red;}</style><script>MARK${n}X</script>`;
}
export function urlPayload(n: number): string {
  return `javascript:MARK${n}X`;
}

/** Keep these exactly as they are: they pick which sections and branches exist. */
const STRUCTURAL_KEYS = new Set(['reportTypes', 'reportTemplate', 'reportVisualStyle']);

export interface InjectOptions {
  /** Also turn every number into a payload string (a JSONB column can hold anything). */
  numbers?: boolean;
  /** Keys whose values are left exactly as they are (structural ids, enums). */
  keep?: string[];
}

/** One counter for the whole run, so a marker number never means two things. */
let nextMarker = 1;

export function injectDeep<T>(input: T, options: InjectOptions = {}): Injected<T> {
  const markers = new Map<number, PayloadKind>();
  const keep = new Set(options.keep ?? []);
  const byOriginal = new Map<string, string>();

  const payloadFor = (original: string, keyHint: string): string => {
    const known = byOriginal.get(original);
    if (known !== undefined) return known;
    const kind: PayloadKind =
      HEX.test(original) || COLOUR_KEY.test(keyHint)
        ? 'colour'
        : /^https?:\/\//i.test(original) || URLISH_KEY.test(keyHint)
          ? 'url'
          : 'html';
    const n = nextMarker++;
    markers.set(n, kind);
    const p = kind === 'colour' ? colourPayload(n) : kind === 'url' ? urlPayload(n) : htmlPayload(n);
    byOriginal.set(original, p);
    return p;
  };

  // First pass: find every string so keys that name one (photoLabels is filed
  // under photo ids) can be renamed in step with it.
  const seen = new Set<string>();
  const collect = (v: unknown): void => {
    if (typeof v === 'string') seen.add(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') Object.values(v as object).forEach(collect);
  };
  collect(input);

  const walk = (v: unknown, keyHint: string): unknown => {
    if (typeof v === 'string') return payloadFor(v, keyHint);
    if (typeof v === 'number' && options.numbers) {
      const n = nextMarker++;
      markers.set(n, 'html');
      return htmlPayload(n);
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, keyHint));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const newKey = seen.has(k) && !STRUCTURAL_KEYS.has(k) ? payloadFor(k, '') : k;
        out[newKey] = STRUCTURAL_KEYS.has(k) || keep.has(k) ? val : walk(val, k);
      }
      return out;
    }
    return v;
  };

  return { value: walk(input, '') as T, markers };
}

/**
 * One variant per numeric leaf: the same value with exactly that one number
 * replaced by a payload string. Replacing them all at once makes most
 * renderers throw on the first `.toFixed`, which says nothing; one at a time
 * shows which numbers reach the page without being formatted as numbers.
 */
export function numberVariants<T>(input: T): Array<Injected<T> & { path: string }> {
  const paths: Array<Array<string | number>> = [];
  const find = (v: unknown, path: Array<string | number>): void => {
    if (typeof v === 'number') paths.push(path);
    else if (Array.isArray(v)) v.forEach((x, i) => find(x, [...path, i]));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as object)) find(x, [...path, k]);
  };
  find(input, []);
  return paths.map((path) => {
    const n = nextMarker++;
    const clone = structuredClone(input) as unknown as Record<string | number, unknown>;
    let cur: Record<string | number, unknown> = clone;
    for (const key of path.slice(0, -1)) cur = cur[key] as Record<string | number, unknown>;
    cur[path[path.length - 1]] = htmlPayload(n);
    return { value: clone as unknown as T, markers: new Map<number, PayloadKind>([[n, 'html']]), path: path.join('.') };
  });
}

// ─── Reading a page like a browser ──────────────────────────────────────────

export interface ScannedTag {
  name: string;
  attrs: Array<{ name: string; value: string }>;
}
export interface ScannedPage {
  tags: ScannedTag[];
  /** the text inside every <script> and <style>, with its element name */
  rawBlocks: Array<{ name: 'script' | 'style'; text: string }>;
}

const NAME_START = /[a-zA-Z]/;

/** A small, forgiving tokenizer: enough of the HTML spec to find tags, attributes and raw-text blocks. */
export function scanHtml(html: string): ScannedPage {
  const tags: ScannedTag[] = [];
  const rawBlocks: ScannedPage['rawBlocks'] = [];
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (!NAME_START.test(html[lt + 1] ?? '')) {
      i = lt + 1;
      continue;
    }
    let j = lt + 1;
    while (j < n && !/[\s/>]/.test(html[j])) j++;
    const name = html.slice(lt + 1, j).toLowerCase();
    const attrs: ScannedTag['attrs'] = [];
    for (;;) {
      while (j < n && /[\s/]/.test(html[j])) j++;
      if (j >= n || html[j] === '>') break;
      let k = j;
      while (k < n && !/[\s=/>]/.test(html[k])) k++;
      const attrName = html.slice(j, k).toLowerCase();
      j = k;
      while (j < n && /\s/.test(html[j])) j++;
      let value = '';
      if (html[j] === '=') {
        j++;
        while (j < n && /\s/.test(html[j])) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, j + 1);
          value = html.slice(j + 1, end === -1 ? n : end);
          j = end === -1 ? n : end + 1;
        } else {
          let e = j;
          while (e < n && !/[\s>]/.test(html[e])) e++;
          value = html.slice(j, e);
          j = e;
        }
      }
      if (attrName) attrs.push({ name: attrName, value });
    }
    i = j < n ? j + 1 : n;
    tags.push({ name, attrs });
    if (name === 'script' || name === 'style') {
      const closeRe = new RegExp(`</${name}[\\s/>]`, 'i');
      const rest = html.slice(i);
      const m = closeRe.exec(rest);
      const text = m ? rest.slice(0, m.index) : rest;
      rawBlocks.push({ name, text });
      i = m ? i + m.index : n;
    }
  }
  return { tags, rawBlocks };
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n' };
/** Decode the character references a browser decodes in an attribute value. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITY[body.toLowerCase()] ?? m;
  });
}

const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'data', 'srcset', 'background']);
/** What a browser sees at the start of a URL: control characters and spaces are dropped. */
function urlHead(value: string): string {
  // eslint-disable-next-line no-control-regex
  return decodeEntities(value).replace(/[\u0000-\u0020]/g, '').toLowerCase();
}

export interface Leak {
  marker: number | null;
  why: string;
}

/**
 * Everything wrong with a page. Empty means every payload was neutralised.
 * `baselineTags` is the set of element names the same report produces with
 * ordinary data; a payload must not add one.
 */
export function findLeaks(html: string, markers: Map<number, PayloadKind>, baseline: Baseline): Leak[] {
  const baselineTags = baseline.tags;
  const leaks: Leak[] = [];
  const markerOf = (s: string): number | null => {
    const m = /MARK(\d+)X/.exec(s);
    return m ? Number(m[1]) : null;
  };

  // 1. A payload written verbatim is a payload that was never escaped.
  for (const [n, kind] of markers) {
    const raw = kind === 'colour' ? colourPayload(n) : kind === 'url' ? urlPayload(n) : htmlPayload(n);
    if (kind === 'url') continue; // visible text is harmless; the attribute check below is the real test
    if (html.includes(raw)) leaks.push({ marker: n, why: `payload written verbatim (${kind})` });
  }

  const page = scanHtml(html);

  // 2. Injected elements, attributes and handlers.
  for (const tag of page.tags) {
    if (!baselineTags.has(tag.name)) leaks.push({ marker: markerOf(tag.name), why: `new element <${tag.name}>` });
    for (const a of tag.attrs) {
      if (a.name.startsWith('on') && !baseline.handlers.has(`${tag.name}:${a.name}=${a.value}`)) leaks.push({ marker: markerOf(a.value) ?? markerOf(a.name), why: `event attribute ${a.name}` });
      if (/MARK\d+X/.test(a.name)) leaks.push({ marker: markerOf(a.name), why: `marker in attribute name ${a.name}` });
      if (URL_ATTRS.has(a.name)) {
        const head = urlHead(a.value);
        if (/^(javascript|vbscript):/.test(head)) leaks.push({ marker: markerOf(a.value), why: `${a.name} is a javascript: URL` });
      }
      if (a.name === 'style' && /javascript:|expression\(/i.test(decodeEntities(a.value))) {
        leaks.push({ marker: markerOf(a.value), why: 'script URL inside a style attribute' });
      }
      if (a.name === 'style' && /MARK\d+X/.test(decodeEntities(a.value)) && /[<>{}]/.test(decodeEntities(a.value))) {
        leaks.push({ marker: markerOf(a.value), why: 'unvetted value inside a style attribute' });
      }
    }
  }

  // 3. Raw-text blocks: a style block must hold no marker at all, and a script
  // block may hold one only as inert text inside a JSON string (no raw < or >).
  for (const block of page.rawBlocks) {
    const m = markerOf(block.text);
    if (m === null) continue;
    if (block.name === 'style') {
      leaks.push({ marker: m, why: 'marker inside a style block' });
      continue;
    }
    // The payload's own script is `MARKnX` alone; anything that is a bare marker is an injected script.
    if (/^\s*MARK\d+X\s*$/.test(block.text)) leaks.push({ marker: m, why: 'injected script ran' });
    else if (/MARK\d+X[^"\\]*[<>]|[<>][^"\\]*MARK\d+X/.test(block.text)) {
      leaks.push({ marker: m, why: 'raw < or > beside a marker inside a script block' });
    }
  }

  // De-duplicate by (marker, why).
  const seen = new Set<string>();
  return leaks.filter((l) => {
    const key = `${l.marker}:${l.why}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What the renderer's own markup looks like for ordinary data: element names and the handlers it writes itself. */
export interface Baseline {
  tags: Set<string>;
  handlers: Set<string>;
}
export function baselineOf(html: string): Baseline {
  const page = scanHtml(html);
  const handlers = new Set<string>();
  for (const t of page.tags) for (const a of t.attrs) if (a.name.startsWith('on')) handlers.add(`${t.name}:${a.name}=${a.value}`);
  return { tags: new Set(page.tags.map((t) => t.name)), handlers };
}

// ─── A fixture with every optional branch switched on ───────────────────────

function photo(id: string, category: AnalyzedPhoto['photoCategory'], sev: AnalyzedPhoto['overallSeverity']): AnalyzedPhoto {
  return {
    id,
    url: `https://cdn.example.com/${id}.jpg`,
    thumbnailUrl: `https://cdn.example.com/${id}-t.jpg`,
    caption: `Caption for ${id}`,
    takenAt: '2026-03-14T10:00:00Z',
    damages: [
      {
        id: `${id}-d1`,
        type: 'hail_impact',
        label: 'Hail impact',
        severity: 'high',
        confidence: 0.92,
        description: 'Bruised mat with granule loss',
        location: 'Rear slope',
        boundingBox: { x: 10, y: 12, width: 30, height: 20 },
      },
    ],
    overallSeverity: sev,
    aiSummary: `Summary for ${id}`,
    analyzedAt: '2026-03-14T11:00:00Z',
    photoCategory: category,
    providersUsed: ['groq'],
  };
}

export function richReport(template: 'insurance' | 'homeowner' | 'full' | 'quick' = 'full'): ComprehensiveRoofReport {
  const base = baseReport();
  const photos = [
    photo('ph-1', 'overview', 'low'),
    photo('ph-2', 'roof_surface', 'medium'),
    photo('ph-3', 'vent', 'high'),
    photo('ph-4', 'flashing', 'critical'),
    photo('ph-5', 'closeup', 'medium'),
  ];
  return {
    ...base,
    customerName: 'Dana Whitfield',
    customerEmail: 'dana@example.com',
    inspectionDate: '2026-03-14',
    crmLink: { leadId: 'lead-1', jobId: 'job-1', projectId: 'proj-1' },
    reportTypes: ['inspection', 'measurement', 'storm'],
    reportTemplate: template,
    reportVisualStyle: 'formal',
    inspectorNotes: 'Notes from the inspector.\nSecond line.',
    executiveSummary: 'The roof is in fair shape with localised hail damage.',
    narrativeFindings: 'Narrative findings text.',
    dataQuality: 'verified',
    dataSources: ['Groq Vision', 'NOAA SWDI', 'Iowa Environmental Mesonet'],
    roofDetails: { type: 'gable', squares: 27.6, pitch: '6/12', stories: 2, material: 'architectural_asphalt', age_years: 14 },
    damageCounts: { windDamaged: 2, hailDamaged: 4, generalDamaged: 1 },
    measurements: { ridgeLength: 62, hipLength: 10, valleyLength: 34, eaveLength: 140, rakeLength: 88, perimeterLength: 300, facetCount: 8, roof3DImage: 'https://cdn.example.com/3d.png' },
    replacementOptions: [
      {
        tier: 'good',
        name: 'Standard replacement',
        tagline: 'A sound, economical roof',
        total: 14200,
        warranty_years: 25,
        warranty_description: 'Limited lifetime',
        features: ['Architectural shingles', 'Ice and water shield'],
        recommended: false,
        materials: [{ description: 'Architectural shingle', details: 'Weathered wood', brand: 'CertainTeed', quantity: 27.6, unit: 'SQ', unit_price: 320, total: 8832 }],
        labor: [{ description: 'Tear off and install', quantity: 27.6, unit: 'SQ', unit_price: 140, total: 3864 }],
        other_costs: [{ item: 'Dumpster', description: 'Haul away', amount: 450 }],
        subtotal: 13146,
        tax: 0,
      },
      {
        tier: 'better',
        name: 'Enhanced replacement',
        tagline: 'More protection',
        total: 17800,
        warranty_years: 50,
        warranty_description: 'Full system',
        features: ['Impact resistant shingles'],
        recommended: true,
        materials: [{ description: 'Impact shingle', brand: 'CertainTeed', quantity: 27.6, unit: 'SQ', unit_price: 410, total: 11316 }],
        labor: [],
        other_costs: [],
        subtotal: 17000,
        tax: 0,
      },
      {
        tier: 'best',
        name: 'Premium replacement',
        tagline: 'The best we offer',
        total: 24100,
        warranty_years: 50,
        warranty_description: 'Lifetime',
        features: ['Designer shingles'],
        materials: [],
        labor: [],
        other_costs: [],
        subtotal: 23000,
        tax: 0,
      },
    ],
    stormHistory: {
      ...base.stormHistory,
      mostRecentHailStorm: {
        date: '2025-06-02',
        type: 'hail',
        magnitude: '1.50 inch hail',
        distanceMiles: 1.2,
        description: 'Hail reported near the property',
        event: {} as never,
      },
      mostRecentWindStorm: {
        date: '2025-07-19',
        type: 'wind',
        magnitude: '65 mph',
        distanceMiles: 2.4,
        description: 'Straight line wind',
        event: {} as never,
      },
      recommendedDateOfLoss: { date: '2025-06-02', eventType: 'hail', magnitude: '1.50 inch', reason: 'Closest and largest hail event' },
      claimPotential: 'high',
      riskLevel: 'high',
    },
    stormEnhanced: {
      noaaEventPageUrls: [{ eventId: 'ev-1', url: 'https://www.ncei.noaa.gov/event/1', date: '2025-06-02', type: 'hail' }],
      nexradRadarImageUrls: [{ date: '2025-06-02', url: 'https://radar.example.gov/1.png', caption: 'Radar at 4pm' }],
      countyStormDatabaseUrl: 'https://www.ncei.noaa.gov/county/1',
      narratives: [{ eventId: 'ev-1', narrative: 'A narrative of the storm.', date: '2025-06-02', type: 'hail' }],
      propertyProfile: { total_hail_events: 4, total_wind_events: 3, avg_events_per_year: 1.4, worst_year: { year: 2025, event_count: 6, largest_hail: 1.5 }, storm_free_years: [2023], repeat_storm_months: [5, 6], estimated_cumulative_exposure: 'high' },
      hailSizeDistribution: { 1: 2, 2: 3 },
    },
    damageAnalysis: {
      ...base.damageAnalysis,
      totalPhotosAnalyzed: 5,
      photosWithDamage: 4,
      overallSeverity: 'high',
      aiSummary: 'Hail damage on the rear slope.',
      photos,
      roofAge: { ...base.damageAnalysis.roofAge!, confidence: 'medium', materialCondition: 'fair' },
      damageTypes: [
        { type: 'hail_impact', count: 4, severity: 'high' },
        { type: 'wind_lift', count: 2, severity: 'medium' },
        { type: 'flashing_failure', count: 1, severity: 'critical' },
      ],
    },
    repairEstimate: {
      ...base.repairEstimate,
      lineItems: [
        { repairTypeId: 'hail_repair', repairName: 'Hail Damage Repair', quantity: 4, unit: 'each', baseCostPerUnit: 85, finalCostPerUnit: 85, totalBaseCost: 340, totalFinalCost: 340 },
        { repairTypeId: 'flash', repairName: 'Flashing repair', quantity: 12, unit: 'lf', baseCostPerUnit: 18, finalCostPerUnit: 18, totalBaseCost: 216, totalFinalCost: 216 },
      ],
      subtotal: 556,
      total: 4250,
      notes: ['Pricing is an estimate.', 'Final price after tear-off.'],
    },
    measurementReport: {
      segments: [
        { name: 'North slope', footprintSqFt: 1200, pitch: '6/12', adjustedSqFt: 1342 },
        { name: 'South slope', footprintSqFt: 1200, pitch: '6/12', adjustedSqFt: 1342 },
      ],
      totalFootprintSqFt: 2400,
      totalAdjustedSqFt: 2684,
      totalSquares: 26.8,
      averagePitch: '6/12',
      wastePercentage: 15,
      edgeLengths: { ridge: 62, hip: 10, valley: 34, eave: 140, rake: 88, dripEdge: 228, flashing: 40 },
      materialTakeoff: { shingle_squares: 31, starter_strip: 228, ridge_cap: 72 },
      dataSource: 'google-solar-api',
      pitchTable: [{ pitch: '6/12', area: 2400, percentage: 100 }],
      gutterMeasurements: { frontGutterLength: 40, backGutterLength: 40, leftGutterLength: 30, rightGutterLength: 30, totalGutterLength: 140 },
      structureComplexity: 'moderate',
    },
    roofConditionIndex: {
      overallScore: 62,
      grade: 'C',
      components: [
        { name: 'Covering', weight: 0.4, score: 55, condition: 'fair', notes: 'Hail bruising' },
        { name: 'Flashing', weight: 0.15, score: 40, condition: 'poor', notes: 'Corroded' },
      ],
    },
    structuredFindings: [
      { id: 'f1', title: 'Hail bruising', severity: 'high', narrative: 'The rear slope shows hail bruising.', relatedPhotoIds: ['ph-2', 'ph-3'], repairAction: 'Replace the slope', insuranceRelevant: true, sourceDamageTypes: ['hail_impact'] },
      { id: 'f2', title: 'Flashing', severity: 'critical', narrative: 'Flashing has failed.', relatedPhotoIds: ['ph-4'], repairAction: 'Replace flashing', insuranceRelevant: false },
      { id: 'f3', title: 'Aging', severity: 'minor', narrative: 'Normal aging.', relatedPhotoIds: [], repairAction: 'Monitor', insuranceRelevant: false },
    ],
    photoLabels: {
      'ph-2': [{ id: 'l1', text: 'Bruised shingles', position: 'top-left', severity: 'high', damageId: 'ph-2-d1' }],
      'ph-3': [{ id: 'l2', text: 'Cracked boot', position: 'center', severity: 'critical', damageId: 'ph-3-d1' }],
    },
  } as ComprehensiveRoofReport;
}

export function richBrand(): Record<string, unknown> {
  return {
    brandPrimaryColor: '#ea580c',
    brandSecondaryColor: '#1e40af',
    companyName: 'Summit Ridge Roofing',
    companyPhone: '319-555-0142',
    companyEmail: 'office@summitridge.example',
    companyLogo: 'https://cdn.example.com/logo.png',
    companyWebsite: 'https://summitridge.example',
    companyAddress: '1 Main Street, Cedar Falls IA',
    companyLicenseNumber: 'IA-12345',
    certifications: [{ name: 'Master Elite', issuer: 'Manufacturer' }],
    warranties: [{ type: 'Workmanship', years: 10, description: 'Labour and materials' }],
    insurance: [{ type: 'General liability', provider: 'Example Mutual' }],
    tagline: 'Done right the first time',
    brandFontFamily: 'Inter',
    coverHeroImage: 'https://cdn.example.com/hero.jpg',
    customDisclaimer: 'Estimates are not a contract.',
    internalView: true,
  };
}

export function richMeasurementData(): ReportData {
  return {
    address: '12 Elm Street, Cedar Falls IA',
    date: '2026-06-06',
    segments: [
      { label: 'North Slope', areaSqFt: 1200, pitch: '6/12' },
      { label: 'South Slope', areaSqFt: 1200, pitch: '6/12' },
    ] as ReportData['segments'],
    totalFootprintSqFt: 2400,
    totalAdjustedSqFt: 2684,
    averagePitch: '6/12',
    wastePercentage: 15,
    edgeLengths: { ridgeLengthFt: 62, hipLengthFt: 10, valleyLengthFt: 34, eaveLengthFt: 140, rakeLengthFt: 88, dripEdgeLengthFt: 228, flashingLengthFt: 40 } as ReportData['edgeLengths'],
    materials: {
      shingleSquares: 31, shingleBundles: 93, underlaymentRolls: 4, starterStripLF: 228, starterStripBoxes: 3,
      ridgeCapLF: 72, ridgeCapBundles: 4, dripEdgeLF: 228, dripEdgePieces: 23, iceShieldLF: 80, iceShieldRolls: 2,
      flashingLF: 40, flashingPieces: 4, nailPounds: 30, ventSquareInches: 1500,
    } as ReportData['materials'],
    costs: [{ label: 'Shingles', qty: 31, unit: 'sq', unitPrice: 120 }],
    dataSource: 'Satellite imagery',
    companyName: 'Summit Ridge Roofing',
    companyLogo: 'https://cdn.example.com/logo.png',
    companyPhone: '319-555-0142',
    companyEmail: 'office@summitridge.example',
    companyAddress: '1 Main Street, Cedar Falls IA',
    companyLicenseNumber: 'IA-12345',
    inspectorName: 'Pat Inspector',
    brandPrimaryColor: '#ea580c',
    brandSecondaryColor: '#1e40af',
  };
}

export function richAnalysisRecord(): RoofAnalysisRecord {
  return {
    id: 'an-1',
    user_id: 'u-1',
    analysis_type: 'satellite',
    address: '12 Elm Street, Cedar Falls IA',
    latitude: 42.5,
    longitude: -92.4,
    satellite_image_url: 'https://maps.example.com/sat.png',
    source_photo_urls: ['https://cdn.example.com/a.jpg'],
    detected_features: [
      { type: 'solar_panel', label: 'Solar array', color: '#F59E0B', area_sqft: 300, confidence: 0.9, status: 'detected' },
      { type: 'damage_region', label: 'Damage', color: '#EF4444', area_sqft: 80, confidence: 0.8 },
    ],
    feature_summary: { solar_panels: 1, green_roof: 0, primary_material: 'asphalt', damage_zones: 1, total_area_sqft: 2400 },
    raw_model_output: {},
    model_provider: 'groq',
    model_version: 'llama-4-scout',
    processing_time_ms: 4200,
    status: 'completed',
    created_at: '2026-03-14T10:00:00Z',
    updated_at: '2026-03-14T10:00:00Z',
  } as RoofAnalysisRecord;
}

export function richPack(): ChapterPack {
  return {
    chapters: [
      {
        id: 'ventilation',
        label: 'Ventilation',
        minutes: 2,
        after: 'condition',
        onlyWithWork: false,
        heading: 'How the roof breathes',
        ledes: ['A roof needs air.', 'Second line.'],
        steps: [{ title: 'Step one', text: 'Do the first thing.' }],
        questions: [{ q: 'Why?', a: 'Because.' }],
        note: 'A closing note for {company} on {phone}.',
      },
      {
        id: 'warranty',
        label: 'Warranty',
        minutes: 3,
        after: 'estimate',
        onlyWithWork: true,
        heading: 'What is covered',
        ledes: ['Everything in writing.'],
      },
    ],
    mustSay: [],
    mustNotSay: [],
  };
}

export function richHeaderOptions(): import('../../company-header-html').CompanyHeaderOptions {
  return {
    name: 'Summit Ridge Roofing',
    logoData: 'iVBORw0KGgo=',
    logoMimeType: 'image/png',
    phone: '319-555-0142',
    email: 'office@summitridge.example',
    website: 'https://summitridge.example',
    address: '1 Main Street, Cedar Falls IA',
    licenseNumber: 'IA-12345',
    certifications: [{ name: 'Master Elite', issuingBody: 'Manufacturer' }],
    brandPrimaryColor: '#ea580c',
    tagline: 'Done right the first time',
  };
}
