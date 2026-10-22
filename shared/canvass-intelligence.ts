/** Versioned, explainable prioritization. Points are a heuristic, not a damage probability. */
export interface StormEvidence {
  date: string; type: string; distanceMiles: number | null;
  hailInches: number | null; windMph: number | null; source: string;
}
export interface IntelligenceInput {
  status: string; labels?: string[];
  stormSummary: {
    totalEvents: number; dataQuality?: string; fetchedAt?: string;
    events?: StormEvidence[];
  } | null;
  measurements: { confidence: string; imageryDate: string; roofAreaSqFt: number } | null;
}
export interface ScoreEnrichment { roofScore: number | null; roofMaterial?: string | null }
export interface LeadAssessment {
  version: '1.0'; score: number | null; coverage: number;
  priority: string; factors: { label: string; points: number; max: number; detail: string }[];
  gaps: string[]; nextAction: string;
}
const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function assessLead(p: IntelligenceInput, enrichment: ScoreEnrichment | null, now = new Date()): LeadAssessment {
  const gaps: string[] = [];
  const storm = p.stormSummary;
  const fetched = storm?.fetchedAt ? Date.parse(storm.fetchedAt) : NaN;
  const age = (now.getTime() - fetched) / 86400000;
  const fresh = Number.isFinite(age) && age >= 0 && age <= 30;
  const usableStorm = !!storm && fresh && ['verified', 'no_data', 'partial'].includes(storm.dataQuality || '') && Array.isArray(storm.events);
  let strongest = 0;
  let reason = 'Storm evidence unavailable or stale; refresh storm history.';
  if (usableStorm) {
    reason = 'No qualifying hail or wind report in the available evidence. This does not rule out damage.';
    for (const e of storm!.events!) {
      const days = (now.getTime() - Date.parse(e.date)) / 86400000;
      if (!Number.isFinite(days) || days < 0 || !valid(e.distanceMiles) || e.distanceMiles > 10) continue;
      const hail = /hail/i.test(e.type) && valid(e.hailInches) ? (e.hailInches >= 2 ? 40 : e.hailInches >= 1 ? 30 : e.hailInches > 0 ? 15 : 0) : 0;
      const wind = /wind|thunder|hurricane|tropical/i.test(e.type) && valid(e.windMph) ? (e.windMph >= 75 ? 40 : e.windMph >= 58 ? 30 : e.windMph >= 40 ? 15 : 0) : 0;
      const proximity = e.distanceMiles <= 1 ? 1 : e.distanceMiles <= 3 ? 0.75 : e.distanceMiles <= 5 ? 0.5 : 0.25;
      const recency = days <= 90 ? 1 : days <= 365 ? 0.75 : days <= 1096 ? 0.4 : 0;
      const points = Math.round(Math.max(hail, wind) * proximity * recency * (storm!.dataQuality === 'partial' ? 0.75 : 1));
      if (points > strongest) {
        strongest = points;
        reason = `${e.type} reported ${e.distanceMiles.toFixed(1)} mi away on ${e.date} (${e.source}). Nearby exposure, not confirmed roof damage.`;
      }
    }
  } else gaps.push('Refresh storm history for dated, source-attributed event evidence.');
  if (storm?.dataQuality === 'partial') gaps.push('Some storm sources were unavailable.');
  if (usableStorm && storm!.events!.some(e => !valid(e.distanceMiles))) gaps.push('Reports with unknown distance are excluded from storm points.');
  const propensity = valid(enrichment?.roofScore) && enrichment!.roofScore! <= 100 ? enrichment!.roofScore! : null;
  if (propensity == null) gaps.push('Provider roof-replacement propensity is unknown.');
  if (!enrichment?.roofMaterial) gaps.push('Roof material is unknown.');
  gaps.push('Roof installation date and physical condition require verification; building age is not roof age.');
  const measured = !!p.measurements && valid(p.measurements.roofAreaSqFt) && p.measurements.roofAreaSqFt > 0;
  if (!measured) gaps.push('Pull Google Solar measurements before estimating roof size.');
  else if (p.measurements!.confidence !== 'high') gaps.push('Solar imagery confidence is limited; verify measurements on site.');
  const imageryYear = p.measurements?.imageryDate.match(/\b(19|20)\d{2}\b/);
  if (measured && (!imageryYear || now.getFullYear() - Number(imageryYear[0]) > 3)) gaps.push('Solar imagery date is unknown or over three years old.');
  const engagement = ({ interested: 20, appointment: 30, inspected: 25 } as Record<string, number>)[p.status] || 0;
  const excluded = p.labels?.some(l => l.trim().toLowerCase() === 'do not knock') || ['sold', 'not_interested'].includes(p.status);
  const hasSignal = usableStorm || propensity != null || engagement > 0;
  const score = excluded ? 0 : hasSignal ? strongest + Math.round((propensity ?? 0) * 0.3) + engagement : null;
  const coverage = Math.round(([usableStorm && storm?.dataQuality !== 'partial', propensity != null, measured, !!enrichment?.roofMaterial].filter(Boolean).length / 4) * 100);
  return {
    version: '1.0', score, coverage,
    priority: excluded ? 'Not a prospecting target' : score == null ? 'Needs data' : score >= 70 ? 'High priority' : score >= 40 ? 'Medium priority' : 'Lower priority',
    factors: [
      { label: 'Storm exposure', points: strongest, max: 40, detail: reason },
      { label: 'Provider propensity', points: Math.round((propensity ?? 0) * 0.3), max: 30, detail: propensity == null ? 'Unknown; no points assigned.' : `Tracerfy roof-replacement propensity ${propensity}/100. Provider estimate, not verified roof condition.` },
      { label: 'Homeowner engagement', points: engagement, max: 30, detail: `Recorded canvassing status: ${p.status.replace(/_/g, ' ')}.` },
    ], gaps,
    nextAction: excluded ? 'Respect the recorded status and do-not-knock labels; do not prospect this property.' : p.status === 'appointment' ? 'Prepare for the scheduled inspection and verify roof condition and measurements.' : p.status === 'inspected' ? 'Review the inspection findings and agree on the next step with the homeowner.' : !usableStorm ? 'Refresh storm evidence before prioritizing this door.' : p.status === 'interested' ? 'Follow up with the homeowner to arrange an inspection.' : 'Review the evidence and canvassing history before approaching the property.',
  };
}
