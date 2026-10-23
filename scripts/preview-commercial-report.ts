/**
 * Render a sample commercial Proposal, Presentation and Inspection to disk, so the layout
 * (the pinned layer diagram especially) can be looked at in a browser without
 * a job, a database or a vision call.
 *
 *   npx tsx scripts/preview-commercial-report.ts <out-dir>
 *
 * The data is a fixture: a ballasted EPDM warehouse roof with a scan already
 * applied. Nothing here talks to JobTread, the database or a model.
 */
import fs from 'fs';
import path from 'path';
import { renderCommercialProposalHtml } from '../server/lib/reports/render-commercial-proposal';
import { renderCommercialPresentationHtml } from '../server/lib/reports/render-commercial-presentation';
import { renderCommercialInspectionHtml } from '../server/lib/reports/render-commercial-inspection-html';
import { applyReplacementPricing } from '../server/lib/reports/estimate-replacement';
import { commercialSnapshot } from '../server/lib/reports/commercial-context';
import { applyPhotoScan, type PhotoScanResult } from '../server/lib/reports/commercial-photo-scan';

const outDir = process.argv[2] || '.';

const answers: Record<string, any> = {
  'Inspection Date': '2026-09-14', 'Inspector Name': 'Sam Rep', 'Inspection Type': 'Condition Assessment', 'How was the roof accessed?': 'Walked the roof',
  'Building type / use': 'Warehouse / Industrial', 'Building occupied during work?': 'Yes', 'Number of stories': 1, 'Roof height (ft)': 24,
  'Roof area (sq ft)': 24000, 'Number of roof sections / levels': 2, 'Roof slope': '1/4:12', 'Parapet walls': 'Full perimeter, under 42 in', 'Rooftop access': 'Interior roof hatch',
  'Deck type': 'Steel (metal deck)', 'Deck condition': 'Good', 'Vapor retarder': 'None seen',
  'Insulation type': 'Polyiso', 'Insulation thickness (in)': 2, 'Insulation attachment': 'Mechanically fastened', 'Cover board': 'Wood fiber',
  'Membrane type': 'EPDM', 'Membrane thickness / plies': '60 mil', 'Membrane attachment': 'Ballasted', 'Surfacing': 'Gravel / ballast',
  'Number of roof systems in place': '1', 'Estimated age of current roof (years)': 22, 'Core cut taken': 'Yes',
  'Core cut findings': 'Ballast, 60 mil EPDM, half-inch wood fiber board, 2 in polyiso, steel deck. Dry at the cut.',
  'Roof history': 'Original to the 2004 building. Patched around RTU-3 in 2019.',
  'Membrane field condition': 'Poor', 'Seams and laps': 'Failed', 'Base flashings (walls and curbs)': 'Fair', 'Counterflashing and termination bar': 'Fair',
  'Parapet coping and wall caps': 'Good', 'Perimeter edge metal (fascia, gravel stop, drip edge)': 'Poor', 'Penetrations (pipes, pitch pockets, conduits)': 'Failed',
  'HVAC curbs and rooftop equipment': 'Fair', 'Drains and strainers': 'Fair', 'Walkway pads and traffic protection': 'Poor',
  'Condition notes by area': 'North half: seams open along every field lap. Pitch pockets at the two gas lines have sunk and cracked. South half is in better shape but the ballast has scoured thin along the west parapet.',
  'Ponding observed': 'Moderate — 1/4 to 1 in, or slow to drain', 'Ponding locations and approximate area': 'NE corner near RTU-3, about 300 sq ft',
  'Number of roof drains': 6, 'Overflow / secondary drainage present': 'Yes', 'Drains clear with strainers in place': 'Partially',
  'Moisture survey performed': 'Infrared (IR) scan', 'Estimated wet insulation (% of roof area)': 8, 'Active leaks reported by the owner': 'Yes',
  'Interior evidence': 'Two ceiling stains under RTU-3.',
  'Overall condition summary': 'A 22-year-old ballasted EPDM roof. The seams have opened across the north half and the pitch pockets at the gas lines have failed; about 8% of the insulation is wet. The deck is sound and there is one roof system in place.',
  'Fall protection present': 'None', 'Rooftop hazards': 'Two unguarded skylights on the south section.', 'Access and staging notes': 'Crane in the east lot. No work before 7am; the loading dock stays open.',
  'Full photo package complete': 'Yes', 'Inspector Signature': 'Sam Rep',
};

const ctx: any = {
  submissionId: 1, formKind: 'commercial', commercial: true, inspectionType: 'Condition Assessment', jobType: 'retail',
  recommendation: 'Recover (layover) over the existing roof', damageSummary: answers['Overall condition summary'], approxSquares: 240,
  inspectorName: 'Sam Rep', signedAt: '2026-09-14T15:00:00.000Z', answers,
};

const img = (seed: string) => `https://picsum.photos/seed/${seed}/640/480`;
const shots: Array<[string, string | undefined, PhotoScanResult]> = [
  ['seam1', 'North field lap', { usable: true, component: 'seams', caption: 'Open seam along a field lap', observation: 'The lap has opened for about two feet and the upper sheet is lifted clear of the lower one.', condition: 'failed', issues: [{ label: 'Open seam', detail: 'The lap is open across the centre of the frame.', severity: 'high' }] }],
  ['seam2', undefined, { usable: true, component: 'seams', caption: 'Seam tape lifting at a T-joint', observation: 'The seam tape has released at the T-joint and the edge is curled.', condition: 'poor', issues: [{ label: 'Lifting seam tape', detail: 'The tape edge is curled at the joint on the left.', severity: 'medium' }] }],
  ['pitch', 'Gas line pitch pocket', { usable: true, component: 'penetrations', caption: 'Pitch pocket at a gas line', observation: 'The sealant in the pitch pocket has sunk below the rim and cracked around the pipe.', condition: 'failed', issues: [{ label: 'Sunken, cracked pitch pocket', detail: 'The filler has dropped and split around the pipe.', severity: 'critical' }] }],
  ['drain', undefined, { usable: true, component: 'drains', caption: 'Roof drain with strainer in place', observation: 'The strainer is in place and the bowl is clear of debris.', condition: 'good', issues: [] }],
  ['pond', undefined, { usable: true, component: 'ponding', caption: 'Standing water near a rooftop unit', observation: 'Water is standing against the curb with a silt ring around it.', condition: 'poor', issues: [{ label: 'Standing water', detail: 'Water is held against the curb in the foreground.', severity: 'medium' }] }],
  ['edge', undefined, { usable: true, component: 'edge_metal', caption: 'Edge metal along the west parapet', observation: 'The edge metal is rusted at the joints and one section has lifted.', condition: 'poor', issues: [{ label: 'Lifted edge metal', detail: 'One section has pulled up at the right of the frame.', severity: 'medium' }] }],
  ['core', 'Core cut', { usable: true, component: 'core_cut', caption: 'Core cut showing the layers', observation: 'The cut shows the membrane, a thin board, insulation and the steel deck.', condition: 'not_assessable', issues: [] }],
  ['over', undefined, { usable: true, component: 'overview', caption: 'Overview of the north roof section', observation: 'A ballasted roof with the stone scoured thin along the far parapet.', condition: 'fair', issues: [] }],
];

const photos = shots.map(([seed, caption], i) => ({ id: `photo-${i}`, url: img(seed), caption, damages: [], overallSeverity: 'none', aiSummary: 'Not analysed — inspection record.', analyzedAt: '2026-09-14T12:00:00.000Z' }));

const base: any = {
  id: 'preview', generatedAt: '2026-09-14T12:00:00.000Z', version: '2.0', customerName: 'Warehouse LLC',
  property: { address: '400 Warehouse Way', city: 'Springfield', state: 'IL', latitude: 39.8, longitude: -89.6 },
  stormHistory: { yearsAnalyzed: 3, searchRadiusMiles: 5, totalEvents: 0, hailEvents: 0, windEvents: 0, tornadoEvents: 0, largestHailInches: 0, highestWindMph: 0, riskLevel: 'low', riskScore: 5, claimPotential: 'low', eventsByYear: {}, recommendedDateOfLoss: null },
  damageAnalysis: { totalPhotosAnalyzed: 0, photosWithDamage: 0, overallSeverity: 'none', roofAge: null, damageTypes: [], aiSummary: '', analysisSkipped: true, photos },
  repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] },
  inspectorNotes: '', dataQuality: 'verified', dataSources: [],
  commercial: commercialSnapshot(ctx),
};

const scanned = applyPhotoScan(base, photos, { results: shots.map((s) => s[2]), requested: shots.length, scanned: shots.length, timedOut: false });
const report: any = {
  ...applyReplacementPricing(scanned, { tierSelection: { good: 'dura_last_layover', better: 'dura_last_tpo', best: 'gaf_commercial_tpo' }, squares: 240, selectedTier: 'better', isoTier: 'r25' }),
  appendixPhotos: ['a', 'b', 'c', 'd', 'e'].map((s) => ({ url: img(`extra-${s}`) })),
  assemblyEdits: { note: 'Confirmed by core cut on the day of the inspection, not from record drawings.', photoUrl: img('core'), photoCaption: 'The core cut.' },
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'proposal.html'), renderCommercialProposalHtml(report, { customer: 'Warehouse LLC', inspection: ctx }));
fs.writeFileSync(path.join(outDir, 'presentation.html'), renderCommercialPresentationHtml(report, { customer: 'Warehouse LLC', rep: 'Sam Rep', inspection: ctx }));
// The Inspection three ways: the bare record, with the photo scan, and with the scan and pricing.
fs.writeFileSync(path.join(outDir, 'inspection.html'), renderCommercialInspectionHtml(base, { jobType: 'retail', inspection: ctx }));
fs.writeFileSync(path.join(outDir, 'inspection-scanned.html'), renderCommercialInspectionHtml(scanned, { jobType: 'retail', inspection: ctx }));
fs.writeFileSync(path.join(outDir, 'inspection-priced.html'), renderCommercialInspectionHtml(report, { jobType: 'retail', inspection: ctx }));
console.info(`Wrote proposal.html, presentation.html and inspection.html to ${path.resolve(outDir)}`);
