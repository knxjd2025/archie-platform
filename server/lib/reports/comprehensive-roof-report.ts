/**
 * Comprehensive Roof Report Generator
 * Combines storm data, damage analysis, and repair pricing into a unified report.
 */

import type { StormReport, StormEvent } from './storm-history-service.js';
import type { RepairEstimateSummary, RepairEstimate } from './roof-repair-pricing.js';

export interface DamageDetection {
  id: string;
  type: string;
  label: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  description: string;
  location?: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface AnalyzedPhoto {
  id: string;
  url: string;
  thumbnailUrl?: string;
  caption?: string;
  takenAt?: string;
  damages: DamageDetection[];
  overallSeverity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  aiSummary: string;
  analyzedAt: string;
}

export interface MostRecentStorm {
  date: string;
  type: 'hail' | 'wind';
  magnitude: string;
  distanceMiles: number;
  description: string;
  event: StormEvent;
}

export interface StormSummarySection {
  yearsAnalyzed: number;
  searchRadiusMiles: number;
  totalEvents: number;
  hailEvents: number;
  windEvents: number;
  tornadoEvents: number;
  largestHailInches?: number;
  highestWindMph?: number;
  mostRecentHailStorm?: MostRecentStorm;
  mostRecentWindStorm?: MostRecentStorm;
  riskLevel: 'low' | 'medium' | 'high';
  riskScore: number;
  claimPotential: 'none' | 'low' | 'medium' | 'high';
  recommendedDateOfLoss?: {
    date: string;
    eventType: string;
    magnitude: string;
    reason: string;
  };
  eventsByYear: Record<number, { hail: number; wind: number; total: number }>;
}

export interface RoofAgeEstimation {
  estimatedAgeYears: number | null;
  expectedLifespanYears: number | null;
  remainingLifeYears: number | null;
  confidence: 'low' | 'medium' | 'high';
  indicators: string[];
  roofMaterial: string | null;
  materialCondition: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
}

export interface DamageAnalysisSection {
  totalPhotosAnalyzed: number;
  photosWithDamage: number;
  overallSeverity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  roofAge: RoofAgeEstimation | null;
  damageTypes: {
    type: string;
    count: number;
    severity: string;
  }[];
  photos: AnalyzedPhoto[];
  aiSummary: string;
}

export interface RepairEstimateSection {
  lineItems: RepairEstimate[];
  subtotal: number;
  multiplierApplied: number;
  total: number;
  notes: string[];
}

export interface ComprehensiveRoofReport {
  id: string;
  generatedAt: string;
  version: string;

  // Property Info
  property: {
    address: string;
    city: string;
    state: string;
    zip?: string;
    latitude: number;
    longitude: number;
  };

  // CRM linking (optional)
  crmLink?: {
    leadId?: string;
    jobId?: string;
    projectId?: string;
  };

  // Report sections
  stormHistory: StormSummarySection;
  damageAnalysis: DamageAnalysisSection;
  repairEstimate: RepairEstimateSection;

  /**
   * The storm date + type the sales rep explicitly selected on the field
   * inspection ("Storm Date" / "Storm Type") — never inferred automatically
   * from the NOAA lookup in `stormHistory`. Absent/null when the rep left it
   * blank, which is expected for retail jobs with no specific storm claim;
   * the proposal's top storm timeline only renders when this is set.
   */
  repConfirmedStorm?: { date: string; type: string } | null;

  // Enhanced v2 fields
  roofDetails?: {
    type?: string;
    squares?: number;
    pitch?: string;
    stories?: number;
    material?: string;
    age_years?: number;
  };
  damageCounts?: {
    windDamaged: number;
    hailDamaged: number;
    generalDamaged: number;
  };
  replacementOptions?: any[]; // TierPricing[] (roofing-products.ts) — stored as JSONB
  /** Which of replacementOptions is the one actually being quoted/pushed, when a replacement Estimate was generated. */
  selectedTier?: 'good' | 'better' | 'best';
  measurements?: Record<string, any>;

  // Inspector notes (editable by user)
  inspectorNotes: string;

  // Metadata
  dataQuality: 'verified' | 'partial' | 'degraded';
  dataSources: string[];
}

/**
 * Find the most recent storm event of a given type
 */
function findMostRecentStorm(
  events: StormEvent[],
  type: 'hail' | 'wind'
): MostRecentStorm | undefined {
  const filtered = events.filter(e => {
    if (type === 'hail') return e.event_type === 'Hail';
    return e.event_type.includes('Wind') || e.event_type === 'Tornado';
  });

  if (filtered.length === 0) return undefined;

  // Already sorted by date descending
  const mostRecent = filtered[0];

  let magnitude = '';
  if (type === 'hail' && mostRecent.hail_size_inches) {
    magnitude = `${mostRecent.hail_size_inches}" hail`;
  } else if (type === 'wind' && mostRecent.wind_speed_mph) {
    magnitude = `${mostRecent.wind_speed_mph} mph winds`;
  } else {
    magnitude = mostRecent.event_type;
  }

  return {
    date: mostRecent.date,
    type,
    magnitude,
    distanceMiles: mostRecent.distance_miles || 0,
    description: `${mostRecent.event_type} event ${mostRecent.distance_miles?.toFixed(1) || '?'} miles from property`,
    event: mostRecent,
  };
}

/**
 * Build storm summary section from full storm report
 */
export function buildStormSummarySection(stormReport: StormReport): StormSummarySection {
  const mostRecentHail = findMostRecentStorm(stormReport.events, 'hail');
  const mostRecentWind = findMostRecentStorm(stormReport.events, 'wind');

  // Build events by year summary
  const eventsByYear: Record<number, { hail: number; wind: number; total: number }> = {};
  for (const [yearStr, events] of Object.entries(stormReport.events_by_year)) {
    const year = parseInt(yearStr);
    const hail = events.filter(e => e.event_type === 'Hail').length;
    const wind = events.filter(e => e.event_type.includes('Wind') || e.event_type === 'Tornado').length;
    eventsByYear[year] = { hail, wind, total: events.length };
  }

  return {
    yearsAnalyzed: stormReport.years_covered,
    searchRadiusMiles: stormReport.search_radius_miles,
    totalEvents: stormReport.summary.total_events,
    hailEvents: stormReport.summary.hail_events,
    windEvents: stormReport.summary.wind_events,
    tornadoEvents: stormReport.summary.tornado_events,
    largestHailInches: stormReport.summary.largest_hail_inches,
    highestWindMph: stormReport.summary.highest_wind_mph,
    mostRecentHailStorm: mostRecentHail,
    mostRecentWindStorm: mostRecentWind,
    riskLevel: stormReport.risk_assessment.overall_risk,
    riskScore: stormReport.risk_score?.overall_score || 0,
    claimPotential: stormReport.summary.insurance_claim_potential,
    recommendedDateOfLoss: stormReport.recommended_date_of_loss
      ? {
          date: stormReport.recommended_date_of_loss.date,
          eventType: stormReport.recommended_date_of_loss.event_type,
          magnitude: stormReport.recommended_date_of_loss.magnitude,
          reason: stormReport.recommended_date_of_loss.reason,
        }
      : undefined,
    eventsByYear,
  };
}

/**
 * Build damage analysis section from AI analysis results
 */
export function buildDamageAnalysisSection(
  photos: AnalyzedPhoto[],
  roofAge: RoofAgeEstimation | null = null
): DamageAnalysisSection {
  const photosWithDamage = photos.filter(
    p => p.damages.length > 0 || p.overallSeverity !== 'none'
  );

  // Aggregate damage types
  const damageTypeMap = new Map<string, { count: number; severities: string[] }>();
  for (const photo of photos) {
    for (const damage of photo.damages) {
      const existing = damageTypeMap.get(damage.type);
      if (existing) {
        existing.count++;
        existing.severities.push(damage.severity);
      } else {
        damageTypeMap.set(damage.type, {
          count: 1,
          severities: [damage.severity],
        });
      }
    }
  }

  const damageTypes = Array.from(damageTypeMap.entries()).map(([type, data]) => {
    // Determine overall severity for this damage type
    const severityOrder = ['critical', 'high', 'medium', 'low'];
    const worstSeverity = severityOrder.find(s => data.severities.includes(s)) || 'low';
    return {
      type,
      count: data.count,
      severity: worstSeverity,
    };
  });

  // Determine overall severity
  const severityScores: Record<string, number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  const maxSeverity = Math.max(
    ...photos.map(p => severityScores[p.overallSeverity] || 0),
    0
  );
  const overallSeverity = (
    Object.entries(severityScores).find(([, v]) => v === maxSeverity)?.[0] || 'none'
  ) as DamageAnalysisSection['overallSeverity'];

  // Generate a plain-language summary — this report is read by the homeowner
  // and the insurance adjuster, at a 5th-grade reading level, so no jargon or
  // report-speak here.
  // A failed analysis must never read as a clean roof — "no damage detected" is
  // a claim that can end up in front of a customer.
  const unreadable = photos.filter((p) => /unable to analyze/i.test(p.aiSummary || '')).length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  let aiSummary = '';
  if (photos.length === 0) {
    aiSummary = 'We did not receive any photos to look at yet.';
  } else if (unreadable === photos.length) {
    aiSummary = `We could not clearly read ${plural(photos.length, 'photo')}, so we are not able to say what shape the roof is in from these. This does NOT mean the roof is fine — it means we need better photos or a closer look.`;
  } else if (photosWithDamage.length === 0) {
    const caveat = unreadable ? ` (${plural(unreadable, 'photo')} were too unclear to check)` : '';
    aiSummary = `We went over the roof and did not see any real damage${caveat}.`;
  } else {
    const damageList = damageTypes
      .slice(0, 3)
      .map(d => d.type.replace(/_/g, ' '))
      .join(', ');
    const howBad = overallSeverity === 'critical' || overallSeverity === 'high' ? 'should be fixed soon' : 'is worth keeping an eye on';
    // Lead with what was FOUND, not how many photos were looked at. The count
    // is already a stat at the top of the report, and repeating it here made
    // the summary about our process rather than their roof — while
    // contradicting the findings prompt, which forbids photo counts outright.
    // "12 kinds of damage" also disagreed with the "40 problems" stat beside
    // it; areas is what the reader can act on.
    const where = plural(photosWithDamage.length, 'area');
    aiSummary = `We found damage in ${where} of the roof, including ${damageList}. Based on what we saw, this roof ${howBad}.`;
  }

  return {
    totalPhotosAnalyzed: photos.length,
    photosWithDamage: photosWithDamage.length,
    overallSeverity,
    roofAge,
    damageTypes,
    photos,
    aiSummary,
  };
}

/**
 * Build repair estimate section from pricing summary
 */
export function buildRepairEstimateSection(
  pricingSummary: RepairEstimateSummary,
  additionalNotes: string[] = []
): RepairEstimateSection {
  const notes = [...additionalNotes];

  if (pricingSummary.lineItems.length === 0) {
    notes.push('No repairs recommended based on current analysis.');
  } else {
    notes.push(`Pricing includes ${pricingSummary.multiplier}x markup for overhead and profit.`);
    notes.push('Estimates are based on 2024-2025 industry averages.');
    notes.push('Final pricing may vary based on material availability and site conditions.');
  }

  return {
    lineItems: pricingSummary.lineItems,
    subtotal: pricingSummary.subtotalBase,
    multiplierApplied: pricingSummary.multiplier,
    total: pricingSummary.subtotalFinal,
    notes,
  };
}

/**
 * Generate a unique report ID
 */
function generateReportId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `rr-${timestamp}-${random}`;
}

/**
 * Create a comprehensive roof report from all components
 */
export function createComprehensiveReport(params: {
  property: {
    address: string;
    city: string;
    state: string;
    zip?: string;
    latitude: number;
    longitude: number;
  };
  stormReport: StormReport;
  analyzedPhotos: AnalyzedPhoto[];
  repairEstimate: RepairEstimateSummary;
  roofAge?: RoofAgeEstimation | null;
  crmLink?: {
    leadId?: string;
    jobId?: string;
    projectId?: string;
  };
  // Enhanced v2 fields
  roofDetails?: ComprehensiveRoofReport['roofDetails'];
  damageCounts?: ComprehensiveRoofReport['damageCounts'];
  replacementOptions?: any[];
  measurements?: Record<string, any>;
  inspectorNotes?: string;
}): ComprehensiveRoofReport {
  const { property, stormReport, analyzedPhotos, repairEstimate, roofAge, crmLink } = params;

  return {
    id: generateReportId(),
    generatedAt: new Date().toISOString(),
    version: '2.0',

    property,
    crmLink,

    stormHistory: buildStormSummarySection(stormReport),
    damageAnalysis: buildDamageAnalysisSection(analyzedPhotos, roofAge),
    repairEstimate: buildRepairEstimateSection(repairEstimate),

    // Enhanced v2 fields
    roofDetails: params.roofDetails,
    damageCounts: params.damageCounts,
    replacementOptions: params.replacementOptions,
    measurements: params.measurements,

    inspectorNotes: params.inspectorNotes || '',

    dataQuality: stormReport.data_quality === 'verified' ? 'verified' :
      stormReport.data_quality === 'partial' ? 'partial' : 'degraded',
    dataSources: stormReport.data_sources,
  };
}

/**
 * Severity color mapping for UI
 */
export function getSeverityColor(severity: string): string {
  const colors: Record<string, string> = {
    none: '#22c55e',    // green
    low: '#84cc16',     // lime
    medium: '#eab308',  // yellow
    high: '#f97316',    // orange
    critical: '#ef4444', // red
  };
  return colors[severity] || colors.medium;
}

/**
 * Risk level color mapping for UI
 */
export function getRiskColor(risk: string): string {
  const colors: Record<string, string> = {
    low: '#22c55e',
    medium: '#eab308',
    high: '#ef4444',
  };
  return colors[risk] || colors.medium;
}
