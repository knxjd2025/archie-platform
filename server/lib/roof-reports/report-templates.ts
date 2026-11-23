/**
 * Report Template System for Roof Reports
 *
 * Defines four report templates that control which sections are included,
 * tone of AI-generated summaries, and display limits for photos/damage types.
 */

export type ReportTemplate = 'insurance' | 'homeowner' | 'full' | 'quick';

/** Voice used for AI-generated narrative + summaries. */
export type ReportTone = 'formal' | 'friendly' | 'neutral';

/**
 * Overall visual presentation style applied to the rendered HTML.
 *
 * `formal` is the document: sections stacked down a page, and it prints.
 *
 * `presentation` is Archie's standard presentation, and it is not a document. It
 * renders the report as numbered chapters down a fixed rail with a running
 * clock, so it can be walked through, with the price deliberately held back
 * until late. Every chapter is earned by report data, and a report too thin to
 * fill a few of them falls back to the document.
 *
 * `flight` is not a document either. It renders the report as one continuous
 * scroll-driven descent through the job's own photographs, with the copy opening
 * over the imagery. It is for sending to a homeowner on a screen and it needs at
 * least a few photos to read.
 *
 * Neither scroll style prints. That costs nothing, because the PDF is built by
 * `@react-pdf/renderer` from the report data rather than from any of this HTML.
 */
export type ReportVisualStyle = 'formal' | 'presentation' | 'flight';

/** Whether a style renders as a scrolling experience rather than a document. */
export function isFlightStyle(style: ReportVisualStyle | null | undefined): boolean {
  return style === 'flight';
}

/**
 * Resolve the style to render at: an explicit per-report override wins over the
 * template's default, and anything unrecognised falls back to the template.
 */
export function resolveVisualStyle(
  template: ReportTemplate | null | undefined,
  override?: string | null,
): ReportVisualStyle {
  if (override === 'formal' || override === 'presentation' || override === 'flight') return override;
  return getTemplateConfig(template).visualStyle;
}

/** Cover-page layout: clean text vs full-bleed image. */
export type ReportCoverStyle = 'minimal' | 'hero';

/** Section-header style: bordered vs colored gradient banners. */
export type ReportSectionStyle = 'flat' | 'gradient';

/** Damage-type cap on the Quick template's executive-summary list. */
export const MAX_DAMAGE_TYPES_QUICK = 3;

/** Sentinel used in `maxPhotos` / `maxDamageTypes` to mean "no cap". */
export const UNCAPPED = 0;

export interface ReportTemplateConfig {
  id: ReportTemplate;
  name: string;
  description: string;
  tone: ReportTone;
  sections: {
    executiveSummary: boolean;
    propertyInfo: boolean;
    roofDetails: boolean;
    roofAge: boolean;
    rci: boolean;
    stormHistory: boolean;
    stormEnhanced: boolean;
    insuranceClaim: boolean;
    damageAnalysis: boolean;
    damageInventory: boolean;
    photoGallery: boolean;
    inspectorNotes: boolean;
    repairEstimate: boolean;
    replacementOptions: boolean;
    measurements: boolean;
    credentials: boolean;
    cta: boolean;
    scopeOfWork: boolean;
    materialSpecs: boolean;
    maintenanceSchedule: boolean;
    warrantyPage: boolean;
  };
  /** Max number of photos to show in gallery (0 = all) */
  maxPhotos: number;
  /** Max number of damage types to list (0 = all) */
  maxDamageTypes: number;
  /** Whether to show the "What This Means" explainer sections */
  showExplainers: boolean;
  /** Summary generation tone instruction for AI */
  summaryToneInstruction: string;
  /** Visual presentation style */
  visualStyle: ReportVisualStyle;
  /** Cover page style: minimal = clean text, hero = full-bleed image */
  coverStyle: ReportCoverStyle;
  /** Section header style: flat = bordered, gradient = colored banners */
  sectionStyle: ReportSectionStyle;
}

export const REPORT_TEMPLATES: Record<ReportTemplate, ReportTemplateConfig> = {
  insurance: {
    id: 'insurance',
    name: 'Insurance Claim Report',
    description:
      'Formal report emphasizing storm data, date of loss, HAAG references, damage evidence, claim potential, and NOAA citations. Designed for insurance adjusters and carriers.',
    tone: 'formal',
    sections: {
      executiveSummary: true,
      propertyInfo: true,
      roofDetails: true,
      roofAge: true,
      rci: true,
      stormHistory: true,
      stormEnhanced: true,
      insuranceClaim: true,
      damageAnalysis: true,
      damageInventory: true,
      photoGallery: true,
      inspectorNotes: true,
      repairEstimate: true,
      replacementOptions: true,
      measurements: true,
      credentials: true,
      cta: false,
      scopeOfWork: true,
      materialSpecs: false,
      maintenanceSchedule: false,
      warrantyPage: false,
    },
    maxPhotos: 0,
    maxDamageTypes: 0,
    showExplainers: false,
    summaryToneInstruction:
      'Write in formal insurance industry language suitable for adjusters and carriers. Reference HAAG Engineering standards, NOAA storm data, and date-of-loss correlation. Use precise technical terminology for damage types (e.g., granule displacement, creasing, fracturing). Maintain an objective, evidence-based tone throughout.',
    visualStyle: 'formal',
    coverStyle: 'minimal',
    sectionStyle: 'flat',
  },

  homeowner: {
    id: 'homeowner',
    name: 'Homeowner Summary',
    description:
      'Friendly, easy-to-understand report with visual condition gauges, "what this means for you" explainers, Good/Better/Best replacement options, and ROI data.',
    tone: 'friendly',
    sections: {
      executiveSummary: true,
      propertyInfo: true,
      roofDetails: true,
      roofAge: true,
      rci: true,
      stormHistory: true,
      stormEnhanced: false,
      insuranceClaim: true,
      damageAnalysis: true,
      damageInventory: true,
      photoGallery: true,
      inspectorNotes: true,
      repairEstimate: true,
      replacementOptions: true,
      measurements: true,
      credentials: true,
      cta: true,
      scopeOfWork: true,
      materialSpecs: true,
      maintenanceSchedule: true,
      warrantyPage: true,
    },
    maxPhotos: 0,
    maxDamageTypes: 0,
    showExplainers: true,
    summaryToneInstruction:
      'Write in plain, friendly language that a homeowner with no roofing experience would easily understand. Avoid jargon or define it when necessary. Focus on what the findings mean for the homeowner, how it affects their home value, and what their options are. Use an approachable, helpful tone.',
    visualStyle: 'presentation',
    coverStyle: 'hero',
    sectionStyle: 'gradient',
  },

  full: {
    id: 'full',
    name: 'Full Inspection Report',
    description:
      'Comprehensive report with all sections included. The complete inspection record with full photo gallery, storm data, measurements, and credentials.',
    tone: 'neutral',
    sections: {
      executiveSummary: true,
      propertyInfo: true,
      roofDetails: true,
      roofAge: true,
      rci: true,
      stormHistory: true,
      stormEnhanced: true,
      insuranceClaim: true,
      damageAnalysis: true,
      damageInventory: true,
      photoGallery: true,
      inspectorNotes: true,
      repairEstimate: true,
      replacementOptions: true,
      measurements: true,
      credentials: true,
      cta: true,
      scopeOfWork: true,
      materialSpecs: true,
      maintenanceSchedule: true,
      warrantyPage: true,
    },
    maxPhotos: 0,
    maxDamageTypes: 0,
    showExplainers: false,
    summaryToneInstruction:
      'Write in a clear, professional, and neutral tone. Present findings objectively with appropriate technical detail. Balance thoroughness with readability.',
    visualStyle: 'presentation',
    coverStyle: 'hero',
    sectionStyle: 'gradient',
  },

  quick: {
    id: 'quick',
    name: 'Quick Assessment',
    description:
      'One-page summary with RCI score, top 3 damage findings, estimated cost, and a repair/replace/monitor recommendation. No photo gallery.',
    tone: 'neutral',
    sections: {
      executiveSummary: true,
      propertyInfo: true,
      roofDetails: false,
      roofAge: false,
      rci: true,
      stormHistory: false,
      stormEnhanced: false,
      insuranceClaim: false,
      damageAnalysis: true,
      damageInventory: false,
      photoGallery: false,
      inspectorNotes: false,
      repairEstimate: true,
      replacementOptions: false,
      measurements: false,
      credentials: false,
      cta: false,
      scopeOfWork: false,
      materialSpecs: false,
      maintenanceSchedule: false,
      warrantyPage: false,
    },
    maxPhotos: UNCAPPED,
    maxDamageTypes: MAX_DAMAGE_TYPES_QUICK,
    showExplainers: false,
    summaryToneInstruction:
      'Be extremely concise. Limit the summary to 2-3 sentences covering the RCI score, the most critical damage finding, and a clear recommendation (repair, replace, or monitor). No filler language.',
    visualStyle: 'formal',
    coverStyle: 'minimal',
    sectionStyle: 'flat',
  },
};

/**
 * The template used when none is specified or an unknown ID is passed.
 * `as const` keeps the value type narrow ('full') so callers writing
 * `if (template === DEFAULT_REPORT_TEMPLATE)` compare against the literal,
 * not the wider `ReportTemplate` union.
 */
export const DEFAULT_REPORT_TEMPLATE = 'full' as const satisfies ReportTemplate;

/** Names of every section that can be toggled per template. */
export type ReportSectionKey = keyof ReportTemplateConfig['sections'];

/**
 * Single source of truth for the section ordering used in UIs.
 * Order matches the visual order in the rendered report.
 */
export const REPORT_SECTION_KEYS: readonly ReportSectionKey[] = [
  'executiveSummary',
  'propertyInfo',
  'roofDetails',
  'roofAge',
  'rci',
  'stormHistory',
  'stormEnhanced',
  'insuranceClaim',
  'damageAnalysis',
  'damageInventory',
  'photoGallery',
  'inspectorNotes',
  'repairEstimate',
  'replacementOptions',
  'measurements',
  'credentials',
  'cta',
  'scopeOfWork',
  'materialSpecs',
  'maintenanceSchedule',
  'warrantyPage',
];

/** Type guard that returns true if `s` is a valid `ReportTemplate` ID.
 *  Accepts unknown so consumers reading from JSONB / query params don't
 *  need to pre-narrow the type. */
export function isReportTemplate(s: unknown): s is ReportTemplate {
  return typeof s === 'string' && Object.prototype.hasOwnProperty.call(REPORT_TEMPLATES, s);
}

const REPORT_TONES: ReadonlySet<ReportTone> = new Set(['formal', 'friendly', 'neutral']);

/** Type guard that returns true if `s` is a valid `ReportTone`.
 *  Accepts unknown for the same reason as `isReportTemplate`. */
export function isReportTone(s: unknown): s is ReportTone {
  return typeof s === 'string' && REPORT_TONES.has(s as ReportTone);
}

const TEMPLATE_DISPLAY_ORDER: readonly ReportTemplate[] = ['insurance', 'homeowner', 'full', 'quick'];

/**
 * All templates in display order (insurance → homeowner → full → quick).
 * Useful for UI pickers that want to iterate without recomputing order.
 */
export function getAllTemplates(): readonly ReportTemplateConfig[] {
  return TEMPLATE_DISPLAY_ORDER.map((id) => REPORT_TEMPLATES[id]);
}

/** The default template config — equivalent to `getTemplateConfig()` with no argument. */
export function getDefaultTemplateConfig(): ReportTemplateConfig {
  return REPORT_TEMPLATES[DEFAULT_REPORT_TEMPLATE];
}

/**
 * Returns the template configuration for the given template ID.
 * Defaults to `DEFAULT_REPORT_TEMPLATE` if no template is specified
 * or if the ID is invalid (`null` / `undefined` / unknown string).
 */
export function getTemplateConfig(template?: ReportTemplate | null): ReportTemplateConfig {
  if (!isReportTemplate(template)) return getDefaultTemplateConfig();
  return REPORT_TEMPLATES[template];
}

/** Whether `template` enables the section identified by `key`. */
export function templateHasSection(template: ReportTemplate, key: ReportSectionKey): boolean {
  return REPORT_TEMPLATES[template].sections[key] === true;
}

/** Whether `template` disables the section identified by `key`.
 *  Inverse of `templateHasSection` — provided so callers can write
 *  `if (templateHidesSection(...))` without negating. */
export function templateHidesSection(template: ReportTemplate, key: ReportSectionKey): boolean {
  return !templateHasSection(template, key);
}

/** Section keys enabled by `template`, in `REPORT_SECTION_KEYS` order. */
export function getEnabledSections(template: ReportTemplate): ReportSectionKey[] {
  return REPORT_SECTION_KEYS.filter((k) => templateHasSection(template, k));
}

/** Section keys disabled by `template`, in `REPORT_SECTION_KEYS` order. */
export function getDisabledSections(template: ReportTemplate): ReportSectionKey[] {
  return REPORT_SECTION_KEYS.filter((k) => !templateHasSection(template, k));
}

/**
 * Returns true when `template` enables every section key in `keys`.
 * Convenient for "should I render this group?" checks where the caller
 * has more than one section to validate.
 */
export function templateHasAllSections(
  template: ReportTemplate,
  keys: readonly ReportSectionKey[],
): boolean {
  return keys.every((k) => templateHasSection(template, k));
}

/**
 * Returns true when `template` enables at least one of the given section keys.
 * Useful for header/group rendering decisions.
 */
export function templateHasAnySection(
  template: ReportTemplate,
  keys: readonly ReportSectionKey[],
): boolean {
  return keys.some((k) => templateHasSection(template, k));
}
