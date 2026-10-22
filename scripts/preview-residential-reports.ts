/**
 * Render a sample of every residential report — Inspection, Estimate,
 * Presentation, Proposal and Combined — to disk, so the layout can be looked
 * at in a browser (on a phone especially) without a job, a database or a model.
 *
 *   npx tsx scripts/preview-residential-reports.ts <out-dir>
 *
 * The commercial documents have their own: scripts/preview-commercial-report.ts.
 */
import fs from 'fs';
import path from 'path';
import { renderInspectionHtml } from '../server/lib/reports/render-inspection-html';
import { renderEstimateHtml } from '../server/lib/reports/render-estimate-html';
import { renderPresentationScrollcraftHtml } from '../server/lib/reports/render-presentation-scrollcraft';
import { renderProposalScrollcraftHtml } from '../server/lib/reports/render-proposal-scrollcraft';
import { renderCombinedHtml } from '../server/lib/reports/render-combined-html';
import { applyReplacementPricing } from '../server/lib/reports/estimate-replacement';
import { generateEstimateFromDamageAnalysis } from '../server/lib/reports/roof-repair-pricing';

const outDir = process.argv[2] || '.';
const img = (seed: string) => `https://picsum.photos/seed/${seed}/640/480`;

const estimate = generateEstimateFromDamageAnalysis([
  { type: 'missing_shingles', count: 2 },
  { type: 'hail_damage', count: 1 },
  { type: 'gutter_damage', count: 1 },
  { type: 'flashing_damage', count: 1 },
]);

const damage = (id: string, type: string, label: string, severity: string, location: string, description: string) =>
  ({ id, type, label, severity, confidence: 0.9, description, location });

const report: any = {
  id: 'preview', generatedAt: '2026-09-14T12:00:00.000Z', version: '2.0',
  property: { address: '7421 Mallard Creek Road', city: 'Charlotte', state: 'NC', zip: '28262', latitude: 35.2, longitude: -80.8 },
  stormHistory: {
    yearsAnalyzed: 3, searchRadiusMiles: 5, totalEvents: 14, hailEvents: 5, windEvents: 9, tornadoEvents: 0, largestHailInches: 1.75, highestWindMph: 66,
    riskLevel: 'high', riskScore: 72, claimPotential: 'high',
    eventsByYear: { 2024: { hail: 2, wind: 4, total: 6 }, 2025: { hail: 3, wind: 5, total: 8 } },
    recommendedDateOfLoss: { date: '2025-05-20', eventType: 'Hail', magnitude: '1.75" hail', reason: 'largest' },
  },
  damageAnalysis: {
    totalPhotosAnalyzed: 6, photosWithDamage: 4, overallSeverity: 'high',
    roofAge: { estimatedAgeYears: 16, expectedLifespanYears: 25, remainingLifeYears: 9, confidence: 'medium', indicators: ['granule loss', 'curling at edges'], roofMaterial: 'asphalt_architectural', materialCondition: 'fair' },
    damageTypes: [], aiSummary: 'We reviewed 6 photos and found hail bruising on the south and west slopes, two missing tabs at the ridge and a dented gutter run on the north side.',
    photos: [
      { id: 'p1', url: img('hail1'), caption: 'South slope', overallSeverity: 'high', aiSummary: 'x', analyzedAt: 'now', damages: [damage('d1', 'hail_damage', 'Hail Damage', 'high', 'south slope', 'Bruises with granule loss, about 12 per test square.')] },
      { id: 'p2', url: img('ridge'), caption: 'Ridge', overallSeverity: 'critical', aiSummary: 'x', analyzedAt: 'now', damages: [damage('d2', 'missing_shingles', 'Missing Shingles', 'critical', 'ridge', 'Two tabs are gone and the mat is exposed.')] },
      { id: 'p3', url: img('gutter'), caption: 'North gutter', overallSeverity: 'medium', aiSummary: 'x', analyzedAt: 'now', damages: [damage('d3', 'gutter_damage', 'Gutter Damage', 'medium', 'north elevation', 'The run is dented in three places.')] },
      { id: 'p4', url: img('flash'), caption: 'Chimney', overallSeverity: 'medium', aiSummary: 'x', analyzedAt: 'now', damages: [damage('d4', 'flashing_damage', 'Flashing Damage', 'medium', 'chimney', 'The counterflashing has pulled out of the reglet.')] },
      { id: 'p5', url: img('clean1'), caption: 'East slope', overallSeverity: 'none', aiSummary: 'x', analyzedAt: 'now', damages: [] },
      { id: 'p6', url: img('clean2'), caption: 'Front elevation', overallSeverity: 'none', aiSummary: 'x', analyzedAt: 'now', damages: [] },
    ],
  },
  repairEstimate: { lineItems: estimate.lineItems, subtotal: estimate.subtotalFinal, multiplierApplied: 1, total: estimate.subtotalFinal, notes: ['Includes overhead and profit.'] },
  inspectorNotes: 'Homeowner reports a drip in the upstairs closet after heavy rain.', dataQuality: 'verified', dataSources: [],
};

const inspection: any = {
  inspectionType: 'Insurance Claim', recommendation: 'File a claim', damageSummary: 'Hail on all slopes, 12 hits per square, two tabs off at the ridge.', approxSquares: 30,
  jobType: 'insurance', inspectorName: 'Thomas B.', signedAt: '2026-09-10T15:00:00.000Z',
  answers: {
    'Inspector Name': 'Thomas B.', 'Inspection Date': '2026-09-10', 'Inspection Type': 'Insurance Claim',
    'How was the roof accessed?': 'Ladder and walked the roof', 'Number of Stories': '2 Story', 'Roof Covering Type': 'Asphalt Shingle - Architectural',
    'Average pitch across ALL slopes': '6/12', 'Number of existing layers': '1',
    'Drip edge': 'No', 'Felt or underlayment type': '#15', 'Ice and water shield': 'Yes - eaves only', 'Valley type': 'Closed cut', 'Starter course present': 'Yes - eaves and rakes',
    'Chimney': '24 x 36, no cricket', 'Skylights': 'None',
    'Ventilation types, counts, and plan': '4 box vents, no soffit intake. Recommend ridge vent plus soffit vents.',
    'Hail hits per test square by slope': 'N 12, S 14, E 9, W 11 (10x10)', 'Wind damage found': 'Yes', 'Soft metal hits found': 'Yes',
    'Granule loss or accumulation in gutters and downspouts': 'Yes', 'Is shingle matching possible?': 'No, discontinued or unavailable',
    'Storm Date': '2025-05-20', 'Storm Type': 'Hail',
    'Leaks or water damage in the attic or interior': 'Yes', 'Decking type and condition': 'OSB, solid', 'Gutters and downspouts': '5 inch K-style, hits on north run', 'Siding damage': 'Yes',
  },
};

const priced: any = applyReplacementPricing(report, {
  tierSelection: { good: 'tamko_titan_basic', better: 'landmark_pro', best: 'landmark_presidential' }, squares: 30, selectedTier: 'better',
});

const proposal: any = {
  customer: 'Linda McMillan', address: '7421 Mallard Creek Road', cityStateZip: 'Charlotte, NC 28262', jobNumber: '1042',
  date: 'September 14, 2026', rep: 'Sam Rep', satelliteDataUri: null,
  measuredSquares: 28.4, billableSquares: 32, roofAreaSqFt: 2840, averagePitch: '6/12', wastePct: 12, imageryDate: '2025-04-02',
  segments: [
    { name: 'South', areaSqFt: 920, pitch: '6/12', azimuth: 180 },
    { name: 'North', areaSqFt: 900, pitch: '6/12', azimuth: 0 },
    { name: 'East', areaSqFt: 510, pitch: '8/12', azimuth: 90 },
    { name: 'West', areaSqFt: 510, pitch: '8/12', azimuth: 270 },
  ],
};

const write = (name: string, html: string) => fs.writeFileSync(path.join(outDir, name), html);
fs.mkdirSync(outDir, { recursive: true });
write('res-inspection.html', renderInspectionHtml(report, { jobType: 'insurance', inspection }));
write('res-estimate.html', renderEstimateHtml(report, { customer: 'Linda McMillan', jobType: 'insurance', recommendation: inspection.recommendation, inspection }));
write('res-presentation.html', renderPresentationScrollcraftHtml(priced, { customer: 'Linda McMillan', rep: 'Sam Rep', jobType: 'insurance', inspection }));
write('res-proposal.html', renderProposalScrollcraftHtml(priced, { customer: 'Linda McMillan', jobType: 'insurance', damageSummary: inspection.damageSummary }));
write('res-combined.html', renderCombinedHtml({ report, proposal }));
console.info(`Wrote five residential reports to ${path.resolve(outDir)}`);
