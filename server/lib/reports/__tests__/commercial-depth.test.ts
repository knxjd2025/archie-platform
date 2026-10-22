import { describe, it, expect } from 'vitest';
import { renderCommercialProposalHtml, commercialProposalSections } from '../render-commercial-proposal';
import { renderCommercialPresentationHtml, commercialPresentationSectionList } from '../render-commercial-presentation';
import { applyReplacementPricing } from '../estimate-replacement';
import { commercialSnapshot } from '../commercial-context';
import { buildAssemblyDiagram, assemblyDiagramHtml, assemblyForEditing, decodeEntities, buildPathDiagrams } from '../sections/assembly-diagram';
import { renderCommercialInspectionHtml, commercialInspectionSections } from '../render-commercial-inspection-html';
import {
  parseScanResponse, scanCommercialPhotos, applyPhotoScan, scanWarning, sameScanSelection, buildScanSystemPrompt,
  isPlaceholderCaption, scanDeadline, type VisionCall,
} from '../commercial-photo-scan';
import { BEFORE_START_COMMITMENTS, COMMERCIAL_MIN_CHAPTERS, customSections, withSectionNotes } from '../sections/commercial-chapters';
import { arrangeSections, describeSections, enforceMinimumSections, type ReportSection } from '../layout';
import { applyDraft, isEmptyDraft } from '../../../reports/draft';
import { digestStoredAnalysis } from '../report-narrative';
import { COMMERCIAL_INSPECTION_FIELDS } from '../../../../shared/commercial-inspection-form';
import { withProfile } from '../../../tenant/context';
import { TEST_PROFILE, FORMER_COMPANY } from './profiles';

const answers = (over: Record<string, any> = {}): Record<string, any> => ({
  'Inspection Date': '2026-09-14', 'Inspector Name': 'Sam Rep', 'Inspection Type': 'Condition Assessment', 'How was the roof accessed?': 'Walked the roof',
  'Building type / use': 'Warehouse / Industrial', 'Roof area (sq ft)': 24000, 'Roof slope': '1/4:12', 'Parapet walls': 'Full perimeter, under 42 in',
  'Deck type': 'Steel (metal deck)', 'Deck condition': 'Good', 'Vapor retarder': 'None seen',
  'Insulation type': 'Polyiso', 'Insulation thickness (in)': 2, 'Insulation attachment': 'Mechanically fastened', 'Cover board': 'None',
  'Membrane type': 'EPDM', 'Membrane thickness / plies': '60 mil', 'Membrane attachment': 'Ballasted', 'Surfacing': 'Gravel / ballast',
  'Number of roof systems in place': '1', 'Estimated age of current roof (years)': 22, 'Core cut taken': 'Yes',
  'Core cut findings': '60 mil EPDM over 2 in polyiso, dry at the cut, steel deck',
  'Membrane field condition': 'Poor', 'Seams and laps': 'Failed', 'Base flashings (walls and curbs)': 'Fair', 'Perimeter edge metal (fascia, gravel stop, drip edge)': 'Poor',
  'Penetrations (pipes, pitch pockets, conduits)': 'Failed', 'Drains and strainers': 'Fair',
  'Condition notes by area': 'North half: seams open along every field lap. Pitch pockets at the two gas lines have sunk and cracked.',
  'Ponding observed': 'Moderate — 1/4 to 1 in, or slow to drain', 'Ponding locations and approximate area': 'NE corner near RTU-3, about 300 sq ft',
  'Number of roof drains': 6, 'Moisture survey performed': 'Infrared (IR) scan', 'Estimated wet insulation (% of roof area)': 8, 'Active leaks reported by the owner': 'Yes',
  'Interior evidence': 'Two ceiling stains under RTU-3',
  'Overall condition summary': 'A 22-year-old ballasted EPDM roof with open seams and failed pitch pockets.',
  'Fall protection present': 'None', 'Access and staging notes': 'Crane in the east lot; no work before 7am.',
  'Full photo package complete': 'Yes', 'Inspector Signature': 'Sam Rep',
  ...over,
});

const ctx = (over: Record<string, any> = {}): any => ({
  submissionId: 1, formKind: 'commercial', commercial: true, inspectionType: 'Condition Assessment', jobType: 'retail',
  recommendation: null, damageSummary: answers(over)['Overall condition summary'], approxSquares: 240, inspectorName: 'Sam Rep', signedAt: '2026-09-14T15:00:00.000Z',
  answers: answers(over),
});

const photo = (i: number, caption?: string) => ({ id: `photo-${i}`, url: `https://cdn.example.com/p${i}.jpg`, caption, damages: [], overallSeverity: 'none', aiSummary: 'Not analysed — inspection record.', analyzedAt: '2026-09-14T12:00:00.000Z' });

const baseReport = (photos: any[] = []): any => ({
  id: 'r-com', generatedAt: '2026-09-14T12:00:00.000Z', version: '2.0',
  property: { address: '400 Warehouse Way', city: 'Springfield', state: 'IL', latitude: 35.2, longitude: -80.8 },
  stormHistory: { yearsAnalyzed: 3, searchRadiusMiles: 5, totalEvents: 0, hailEvents: 0, windEvents: 0, tornadoEvents: 0, largestHailInches: 0, highestWindMph: 0, riskLevel: 'low', riskScore: 5, claimPotential: 'low', eventsByYear: {}, recommendedDateOfLoss: null },
  damageAnalysis: { totalPhotosAnalyzed: 0, photosWithDamage: 0, overallSeverity: 'none', roofAge: null, damageTypes: [], aiSummary: '', analysisSkipped: true, photos },
  repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] },
  inspectorNotes: '', dataQuality: 'verified', dataSources: [],
});

const priced = (over: Record<string, any> = {}, photos: any[] = [], extra: Record<string, any> = {}) => {
  const c = ctx(over);
  const base = { ...baseReport(photos), commercial: commercialSnapshot(c), ...extra };
  const report: any = applyReplacementPricing(base, { tierSelection: { good: 'dura_last_layover', better: 'dura_last_tpo', best: 'restoration_coating' }, squares: 240, selectedTier: 'better', isoTier: 'r25' });
  return { report, ctx: c, tiers: { good: report.replacementOptions[0], better: report.replacementOptions[1], best: report.replacementOptions[2] } };
};

const scanJson = (over: Record<string, any> = {}) => JSON.stringify({
  usable: true, component: 'seams', caption: 'Open seam along a field lap', observation: 'The lap has opened for about two feet and the edge is lifted.',
  condition: 'failed', issues: [{ label: 'Open seam', detail: 'The lap is open at the centre of the frame.', severity: 'high' }], ...over,
});

/* ---------------------------------------------------------------- diagram --- */

describe('the layer diagram model', () => {
  it('a tear-off removes everything above the deck and builds the new system back up from it', () => {
    const { tiers } = priced();
    const d = buildAssemblyDiagram(answers(), tiers.better);
    expect(d.system).toBe('tear_off');
    // top to bottom: ballast, membrane, insulation, deck
    expect(d.today.map((l) => l.role)).toEqual(['surfacing', 'membrane', 'insulation', 'deck']);
    expect(d.today.filter((l) => l.role !== 'deck').every((l) => l.action === 'removed')).toBe(true);
    expect(d.today.find((l) => l.role === 'deck')!.action).toBe('stays');
    // the finished roof: new membrane on top, the kept deck at the bottom
    expect(d.after[0].role).toBe('membrane');
    expect(d.after[0].action).toBe('new');
    expect(d.after[d.after.length - 1].id).toBe('t-deck');
    // the ISO the rep priced is the insulation the diagram names
    expect(d.after.find((l) => l.role === 'insulation')!.label).toContain('R-25 ISO Insulation');
    expect(d.after.find((l) => l.role === 'vapor')!.tag).toBe('If needed');
  });

  it('a poor deck is repaired, not just kept', () => {
    const { tiers } = priced({ 'Deck condition': 'Poor' });
    const deck = buildAssemblyDiagram(answers({ 'Deck condition': 'Poor' }), tiers.better).today.find((l) => l.role === 'deck')!;
    expect(deck.action).toBe('repaired');
    expect(deck.explain).toContain('rated Poor');
  });

  it('a layover keeps the roof, takes the ballast off and replaces only the wet insulation', () => {
    const { tiers } = priced();
    const d = buildAssemblyDiagram(answers(), tiers.good);
    expect(d.system).toBe('layover');
    const by = Object.fromEntries(d.today.map((l) => [l.role, l]));
    expect(by.surfacing.action).toBe('removed');
    expect(by.membrane.action).toBe('stays');
    expect(by.insulation.action).toBe('repaired');
    expect(by.insulation.explain).toContain('8%');
    expect(by.deck.action).toBe('stays');
    // new: the membrane over a separation layer, over everything that stayed — and no new ISO
    const added = d.after.filter((l) => l.action === 'new').map((l) => l.role);
    expect(added).toEqual(['membrane', 'prep']);
    expect(d.after.map((l) => l.id)).toEqual(['n-layover-membrane', 'n-layover-prep', 't-membrane', 't-insulation', 't-deck']);
  });

  it('a coating restores the membrane in place and removes nothing', () => {
    const { tiers } = priced({ Surfacing: 'None (smooth)', 'Estimated wet insulation (% of roof area)': 0 });
    const d = buildAssemblyDiagram(answers({ Surfacing: 'None (smooth)', 'Estimated wet insulation (% of roof area)': 0 }), tiers.best);
    expect(d.system).toBe('coating');
    expect(d.today.some((l) => l.action === 'removed')).toBe(false);
    expect(d.today.find((l) => l.role === 'membrane')!.tag).toBe('Restored');
    expect(d.after[0].label).toContain('Restoration coating');
  });

  it('a custom product with nothing to go on claims no scope', () => {
    const custom: any = { tier: 'good', product: { key: 'custom_x', manufacturer: 'Other', name: 'Acme Roof', category: 'commercial', ratePerSquare: 500, tagline: '', body: '' }, squares: 240, ratePerSquare: 500, total: 120000 };
    const undetermined = answers({ 'Membrane field condition': undefined, 'Seams and laps': undefined });
    const d = buildAssemblyDiagram(undetermined, custom);
    expect(d.system).toBeNull();
    expect(d.after.some((l) => l.action === 'new')).toBe(false);
    expect(d.headline).toContain('after a core cut');
    // but a product whose name says what it is gets that scope, with one honest new layer
    const named = buildAssemblyDiagram(answers(), { ...custom, product: { ...custom.product, name: 'Acme TPO tear-off' } });
    expect(named.system).toBe('tear_off');
    expect(named.after[0].label).toBe('New roof system — Acme TPO tear-off');
  });

  it("a rep's wording and a changed fate both show, and a layer told to stay is still on the finished roof", () => {
    const { tiers } = priced();
    const edits = { layers: { 't-insulation': { label: '2 in polyiso, dry at the core' } }, actions: { tear_off: { 't-insulation': 'stays' as const } } };
    const d = buildAssemblyDiagram(answers(), tiers.better, edits);
    const ins = d.today.find((l) => l.id === 't-insulation')!;
    expect(ins.label).toBe('2 in polyiso, dry at the core');
    expect(ins.action).toBe('stays');
    expect(ins.tag).toBe('Stays');
    expect(d.after.map((l) => l.id)).toContain('t-insulation');
    // the override is for tear-off options only
    expect(buildAssemblyDiagram(answers(), tiers.good, edits).today.find((l) => l.id === 't-insulation')!.action).toBe('repaired');
    // the editor is shown the template wording and the standard fate, with the edits alongside
    const forEdit = assemblyForEditing(answers(), tiers.better, edits);
    expect(forEdit.layers.find((l) => l.id === 't-insulation')).toMatchObject({ side: 'today', action: 'removed' });
    expect(forEdit.edits).toBe(edits);
  });

  it('draws one diagram per tier, escapes what it prints, and drops out with no checklist', () => {
    const { tiers } = priced({ 'Membrane type': 'EPDM' });
    const html = assemblyDiagramHtml({ answers: answers(), pricing: tiers, startingTier: 'better', edits: { note: '<b>core</b> dry' } });
    for (const t of ['good', 'better', 'best']) expect(html).toContain(`data-asm-tier="${t}"`);
    expect(html.match(/data-asm-default/g)).toHaveLength(1);
    expect(html).toContain('data-asm-pick="better" aria-pressed="true"');
    expect(html).toContain('&lt;b&gt;core&lt;/b&gt; dry');
    expect(html).toContain('asm-tag--removed');
    expect(html).toContain('asm-sw--mem-black'); // EPDM reads black
    expect(decodeEntities('Duro-Last&reg; &frac12;&Prime;')).toBe('Duro-Last® ½″');
  });
});

describe("the inspection's layer diagram", () => {
  it('opens on what the findings call for and says which options they rule out', () => {
    // one dry-enough roof with poor seams: a recover
    const recover = buildPathDiagrams(answers());
    expect(recover.opening).toBe('better');
    expect(recover.diagrams.map((d) => d.chip)).toEqual(['Not an option here', 'What the inspection calls for', 'Also possible']);
    expect(recover.diagrams[0].headline).toContain('A coating only works on a roof that is still strong');
    // two roofs already in place: the code says tear-off, and the other two say why not
    const replace = buildPathDiagrams(answers({ 'Number of roof systems in place': '2' }));
    expect(replace.opening).toBe('best');
    expect(replace.diagrams.map((d) => d.chip)).toEqual(['Not an option here', 'Not an option here', 'What the inspection calls for']);
    expect(replace.diagrams[1].headline).toContain('already two roof systems');
    // a sound membrane: a coating is on the table, and so is everything more
    const restore = buildPathDiagrams(answers({ 'Membrane field condition': 'Good', 'Seams and laps': 'Good', 'Ponding observed': 'None', 'Estimated wet insulation (% of roof area)': 0 }));
    expect(restore.opening).toBe('good');
    expect(restore.diagrams.map((d) => d.chip)).toEqual(['What the inspection calls for', 'Also possible', 'Also possible']);
    // nothing rated: nothing is claimed
    const open = buildPathDiagrams(answers({ 'Membrane field condition': undefined, 'Seams and laps': undefined }));
    expect(open.diagrams.every((d) => d.chip === 'To be confirmed')).toBe(true);
  });

  it('names no product and draws each option from the layers the inspector found', () => {
    const { diagrams } = buildPathDiagrams(answers(), { layers: { 't-membrane': { label: '60 mil EPDM, ballasted' } }, actions: { tear_off: { 't-insulation': 'stays' } } });
    const [coating, layover, tearOff] = diagrams;
    expect(coating.after[0].label).toBe('Restoration coating');
    expect(layover.after.filter((l) => l.action === 'new').map((l) => l.label)).toEqual(['New roof membrane', 'Separation layer']);
    expect(tearOff.after.map((l) => l.label)).toEqual(['New roof membrane', 'New cover board', 'New insulation', 'Steel (metal deck)']);
    // a rep's wording carries over; a changed fate, which belongs to a priced scope, does not
    expect(tearOff.today.find((l) => l.id === 't-membrane')!.label).toBe('60 mil EPDM, ballasted');
    expect(tearOff.today.find((l) => l.id === 't-insulation')!.action).toBe('removed');
    expect(JSON.stringify(diagrams)).not.toMatch(/Duro-Last|GAF/);
  });

  it('is on the commercial condition report, interactive, in the document shell', () => {
    const c = ctx();
    const report = { ...baseReport(), commercial: commercialSnapshot(c) };
    const html = renderCommercialInspectionHtml(report, { jobType: 'retail', inspection: c });
    expect(html).toContain('What Happens to Each Layer');
    expect(html).toContain('class="asm-doc"');
    expect(html.match(/<div class="asm" data-asm /g)).toHaveLength(3);
    expect(html).toContain('data-asm-pick="better" aria-pressed="true"');
    expect(html).toContain('.asm-doc {'); // the shell's own values for the diagram
    expect(html).toContain("querySelectorAll('[data-asm-pick]')"); // and the script that drives it
    const keys = commercialInspectionSections(report, { inspection: c }).map((s) => s.key);
    expect(keys.indexOf('layers')).toBe(keys.indexOf('path') + 1);
    // it is still the inspector's record: no price, no product, no photo scan.
    // A maker's name appears only as the credit on a labelled example photo.
    const outsideExamples = html.replace(/<div class="anat-ex">[^]*?<\/div>\s*<\/div>/g, '');
    expect(outsideExamples).not.toMatch(/Duro-Last|Your Options|drafted with AI/);
  });
});

/* ------------------------------------------------------------------- scan --- */

describe('the commercial photo scan', () => {
  it('tells the model what the inspector recorded and what it may not say', () => {
    const p = buildScanSystemPrompt(answers());
    expect(p).toContain('- Membrane: EPDM');
    expect(p).toContain('Never state a cause');
    expect(p).toContain('Never mention insurance');
  });

  it('accepts only well-formed answers and drops what the prompt forbids', () => {
    expect(parseScanResponse('not json')).toBeNull();
    expect(parseScanResponse('```json\n' + scanJson() + '\n```')!.component).toBe('seams');
    const odd = parseScanResponse(scanJson({
      component: 'chimney', condition: 'terrible',
      issues: [
        { label: 'Hail strike', detail: 'A round bruise.', severity: 'high' },
        { label: 'Open seam', detail: 'x', severity: 'catastrophic' },
        { label: 'a', detail: 'b', severity: 'low' }, { label: 'c', detail: 'd', severity: 'low' }, { label: 'e', detail: 'f', severity: 'low' },
      ],
    }))!;
    expect(odd.component).toBe('other');
    expect(odd.condition).toBe('not_assessable');
    expect(odd.issues.map((i) => i.label)).toEqual(['Open seam', 'a', 'c']); // hail dropped, capped at three
    expect(odd.issues[0].severity).toBe('medium');
    expect(parseScanResponse(scanJson({ observation: 'Consistent with a storm.' }))!.observation).toBe('');
    // the caption can end up on the document, so it is held to the same rule
    expect(parseScanResponse(scanJson({ caption: 'Hail damage at a seam' }))!.caption).toBe('');
  });

  it('writes nothing about a photo that does not show the roof', () => {
    const photos = [photo(0)];
    const notRoof = parseScanResponse(scanJson({ usable: false, component: 'seams', caption: 'A parked truck', observation: 'A truck in a lot.', issues: [{ label: 'Dent', detail: 'A dent in the door.', severity: 'high' }] }));
    const out = applyPhotoScan(baseReport(photos), [{ url: photos[0].url }], { results: [notRoof], requested: 1, scanned: 1, timedOut: false });
    expect(out.damageAnalysis.photos[0]).toMatchObject({ damages: [], overallSeverity: 'none', component: 'other', condition: 'not_assessable', scanned: true });
    expect(out.photoScan.withIssues).toBe(0);
  });

  it('hands every call the deadline, so a photo in flight cannot run past it', async () => {
    const deadlines: Array<number | undefined> = [];
    const deadline = Date.now() + 60_000;
    await scanCommercialPhotos([{ url: 'https://cdn.example.com/a.jpg' }], answers(), { call: async (a) => { deadlines.push(a.deadline); return scanJson(); }, deadline });
    expect(deadlines).toEqual([deadline]);
  });

  it('reads every picked photo, skips a url that is not http, and survives a photo that fails', async () => {
    const seen: string[] = [];
    const call: VisionCall = async ({ imageUrl, user }) => {
      seen.push(imageUrl);
      if (imageUrl.endsWith('p2.jpg')) throw new Error('boom');
      return scanJson({ caption: user.includes('North lap') ? 'kept' : 'Open seam along a field lap' });
    };
    const photos = [{ url: 'https://cdn.example.com/p0.jpg', caption: 'North lap' }, { url: 'javascript:alert(1)' }, { url: 'https://cdn.example.com/p2.jpg' }, { url: 'https://cdn.example.com/p3.jpg' }];
    const run = await scanCommercialPhotos(photos, answers(), { call, concurrency: 2 });
    expect(seen.sort()).toEqual(['https://cdn.example.com/p0.jpg', 'https://cdn.example.com/p2.jpg', 'https://cdn.example.com/p3.jpg']);
    expect(run.results.map((r) => !!r)).toEqual([true, false, false, true]);
    expect(run).toMatchObject({ requested: 4, scanned: 2, timedOut: false });
    expect(scanWarning(run)).toContain('2 of 4');
  });

  it('stops starting photos at the deadline and says so', async () => {
    const run = await scanCommercialPhotos([{ url: 'https://cdn.example.com/a.jpg' }, { url: 'https://cdn.example.com/b.jpg' }], answers(), { call: async () => scanJson(), deadline: Date.now() - 1 });
    expect(run.scanned).toBe(0);
    expect(run.timedOut).toBe(true);
    expect(scanDeadline(1_000, 2_000)).toBe(172_000);
    expect(scanDeadline(1_000, 200_000)).toBe(216_000); // never past the function's own limit
  });

  it('writes the scan onto the photos as findings a rep can edit', async () => {
    const photos = [photo(0, 'IMG_4521.jpg'), photo(1, 'North field lap at RTU-3'), photo(2), photo(3)];
    const picked = photos.slice(0, 3).map((p) => ({ url: p.url, caption: p.caption }));
    const run = { results: [parseScanResponse(scanJson()), parseScanResponse(scanJson({ issues: [] })), null], requested: 3, scanned: 2, timedOut: false };
    const out = applyPhotoScan(baseReport(photos), picked, run, new Date('2026-09-14T12:00:00Z'));
    const [a, b, c, d] = out.damageAnalysis.photos;
    // a filename is not a caption; the inspector's own caption is kept
    expect(a.caption).toBe('Open seam along a field lap');
    expect(b.caption).toBe('North field lap at RTU-3');
    expect(isPlaceholderCaption('DSC_0012')).toBe(true);
    // the observation leads, each issue follows, and none of it can be priced as shingle damage
    expect(a.damages.map((x: any) => [x.id, x.type, x.label, x.severity])).toEqual([
      ['damage-0-0', 'commercial_seams', 'Seams and laps', null],
      ['damage-0-1', 'commercial_seams', 'Open seam', 'high'],
    ]);
    expect(a).toMatchObject({ scanned: true, component: 'seams', condition: 'failed', overallSeverity: 'high', aiSummary: 'Photo reviewed.' });
    expect(b.damages).toHaveLength(1);
    expect(c.aiSummary).toBe('Unable to analyze this image.');
    expect(d.aiSummary).toBe('Not analysed — inspection record.'); // never sent for scanning
    expect(out.damageAnalysis).toMatchObject({ totalPhotosAnalyzed: 2, photosWithDamage: 1, overallSeverity: 'high', analysisSkipped: false });
    expect(out.photoScan).toMatchObject({ requested: 3, scanned: 2, withIssues: 1 });
    // the write-up is fed the scan's own wording, not a shingle label
    const digest = digestStoredAnalysis(out);
    expect(digest).toContain('Open seam; severity high');
    expect(digest).not.toContain('severity null');
    // reuse: the same picked set reuses the scan — including the photo that
    // could not be read, which was still part of what was sent — and a
    // different set re-reads
    expect(out.photoScan.urls).toEqual(picked.map((p) => p.url));
    expect(sameScanSelection(out, picked.map((p) => p.url))).toBe(true);
    expect(sameScanSelection(out, [photos[0].url, photos[1].url])).toBe(false);
    expect(sameScanSelection(out, [photos[0].url, photos[1].url, photos[3].url])).toBe(false);
    expect(sameScanSelection(out, [])).toBe(true);
    expect(scanWarning({ results: [], requested: 2, scanned: 2, timedOut: false })).toBeUndefined();
    expect(scanWarning({ results: [], requested: 2, scanned: 0, timedOut: false })).toContain('None of the 2');
  });
});

/* -------------------------------------------------------------- documents --- */

const scannedReport = (extra: Record<string, any> = {}) => {
  const photos = [photo(0, 'North field lap'), photo(1), photo(2, 'Lobby ceiling')];
  const { report, ctx: c } = priced({}, photos, extra);
  const run = {
    results: [
      parseScanResponse(scanJson()),
      parseScanResponse(scanJson({ component: 'drains', caption: 'Roof drain with strainer', observation: 'The strainer is in place and the bowl is clear.', condition: 'good', issues: [] })),
      parseScanResponse(scanJson({ usable: false, component: 'other', caption: 'Lobby', observation: 'An interior lobby.', condition: 'not_assessable', issues: [] })),
    ],
    requested: 3, scanned: 3, timedOut: false,
  };
  return { report: { ...applyPhotoScan(report, photos, run), appendixPhotos: [{ url: 'https://cdn.example.com/extra.jpg', caption: 'Parking lot' }] } as any, ctx: c };
};

const render = {
  proposal: (r: any, c: any) => renderCommercialProposalHtml(r, { customer: 'Warehouse LLC', inspection: c }),
  presentation: (r: any, c: any) => renderCommercialPresentationHtml(r, { customer: 'Warehouse LLC', rep: 'Sam Rep', inspection: c }),
};
const sectionsOf = {
  proposal: (r: any, c: any) => commercialProposalSections(r, { customer: 'Warehouse LLC', inspection: c }),
  presentation: (r: any, c: any) => commercialPresentationSectionList(r, { customer: 'Warehouse LLC', inspection: c }),
};
const chapterCount = (html: string) => (html.slice(html.indexOf('<main')).match(/<section[^>]*\bid="ch-/g) || []).length;

describe.each(['proposal', 'presentation'] as const)('the commercial %s', (kind) => {
  it('carries the COI and W-9 and the permit commitments, word for word', () => {
    const { report, ctx: c } = scannedReport();
    const html = withProfile(TEST_PROFILE, () => render[kind](report, c));
    for (const [, line] of BEFORE_START_COMMITMENTS) expect(html).toContain(line);
    expect(html).toContain('Our Certificate of Insurance (COI) and our W-9 are provided to you before any work starts.');
    expect(html).toContain('every permit is pulled before the start of work');
    expect(html).toContain('Company Information');
    expect(html).toContain('Acme Test Roofing LLC'); // the company's own legal name
    expect(html).not.toMatch(FORMER_COMPANY);
    expect(html).not.toMatch(/general contractor/i); // never claimed
  });

  it('is never shorter than ten chapters, however sparse the job', () => {
    // No photos, no notes, no measurement, no narrative, a bare checklist.
    const bare = { 'Inspection Date': '2026-09-14', 'Inspector Name': 'Sam Rep', 'Roof area (sq ft)': 9000, 'Deck type': 'Unknown', 'Insulation type': 'Unknown', 'Membrane type': 'Unknown', 'Membrane attachment': 'Unknown', 'Number of roof systems in place': 'Unknown', 'Core cut taken': 'No — recommended' };
    const c: any = { ...ctx(), answers: bare, damageSummary: null };
    const report: any = applyReplacementPricing({ ...baseReport(), commercial: commercialSnapshot(c) }, { tierSelection: { good: 'dura_last_layover', better: 'dura_last_tpo', best: 'gaf_commercial_tpo' }, squares: 90, selectedTier: 'better' });
    expect(chapterCount(render[kind](report, c))).toBeGreaterThanOrEqual(COMMERCIAL_MIN_CHAPTERS);
  });

  it('puts hidden chapters back rather than fall below ten, and never hides the required four', () => {
    const { report, ctx: c } = scannedReport();
    const all = sectionsOf[kind](report, c);
    expect(all.filter((s) => s.required).map((s) => s.key).sort()).toEqual(['before-start', 'company', 'product', 'roof-today']);
    const hideEverything = { hidden: all.map((s) => s.key) };
    const html = render[kind]({ ...report, layout: hideEverything }, c);
    expect(chapterCount(html)).toBe(COMMERCIAL_MIN_CHAPTERS);
    for (const id of ['ch-roof-today', 'ch-company', 'ch-product', 'ch-before-start']) expect(html).toContain(`id="${id}"`);
    // a modest trim is honoured exactly
    const trimmed = render[kind]({ ...report, layout: { hidden: ['our-work', 'maintenance'] } }, c);
    expect(trimmed).not.toContain('id="ch-our-work"');
    expect(trimmed).not.toContain('id="ch-maintenance"');
  });

  it('prints every answer the inspector recorded', () => {
    const { report, ctx: c } = scannedReport();
    const html = render[kind](report, c);
    const a = answers();
    for (const f of COMMERCIAL_INSPECTION_FIELDS) {
      if (f.type === 'signature' || f.type === 'date') continue;
      const v = a[f.name];
      if (v === undefined || v === null || v === '') continue;
      const shown = String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      expect(html, f.name).toContain(shown);
    }
    expect(html).toContain('The Inspection Record');
  });

  it('shows the live layer diagram, following the tier the reader taps', () => {
    const { report, ctx: c } = scannedReport();
    const html = render[kind](report, c);
    expect(html).toContain('<html lang="en" data-tier="better">');
    expect(html).toMatch(/<section data-section="layers" data-sc-act="pin" data-sc-span="[\d.]+"/);
    expect(html).toContain('What Comes Off, What Stays, What Goes On');
    expect(html.match(/data-asm-tier="/g)).toHaveLength(3 + 3); // three diagrams + three CSS selectors
    expect(html).toContain("document.documentElement.setAttribute('data-tier', tier)");
    expect(html).toContain("report:select-tier");
  });

  it('sorts the scanned photos by the part of the roof and sets each beside the inspector rating', () => {
    const { report, ctx: c } = scannedReport();
    const html = render[kind](report, c);
    const found = html.slice(html.indexOf('id="ch-found"'));
    const body = found.slice(0, found.indexOf('</section>'));
    // worst first: the failed seam before the clean drain, the photo that is not the roof last
    expect(body.indexOf('Seams and laps <span>')).toBeLessThan(body.indexOf('Drains and scuppers <span>'));
    expect(body.indexOf('Drains and scuppers <span>')).toBeLessThan(body.indexOf('Other <span>'));
    expect(body).toContain("Inspector's rating for seams and laps: <b>Failed</b>");
    expect(body).toContain('The lap is open at the centre of the frame.');
    expect(body).toContain('cf-rating--good');
    // The full photo list is not in the evidence chapter; it closes the document.
    expect(body).not.toContain("The rest of the job's photos");
    expect(body).not.toContain('https://cdn.example.com/extra.jpg');
    expect(body).toContain('Every other photo from the job is at the end of this report');
    expect(body).toContain('drafted with AI assistance');
    const record = html.slice(html.indexOf('id="ch-photo-record"'));
    expect(html.indexOf('id="ch-photo-record"')).toBeGreaterThan(html.indexOf('id="ch-next"'));
    expect(record).toContain("The rest of the job's photos");
    expect(record).toContain('https://cdn.example.com/extra.jpg');
    expect(body).toContain('data-sc-count="0 3"'); // photos reviewed
  });

  it("carries the rep's own chapters, pinned notes, terms and summary", () => {
    const { report, ctx: c } = scannedReport({
      customSections: [{ id: 'abc123', title: 'Phasing <plan>', body: '## Week one\n- North half\nCrane on Monday.', photoUrl: 'https://cdn.example.com/p0.jpg' }, { id: 'bad id', title: 'x', body: 'y' }],
      sectionNotes: { water: 'We will add two drains at the NE corner.', layers: 'never shown here', welcome: 'See {{CH}} below.' },
      beforeStartTerms: ['Site walk with your facilities manager the week before.'],
      commercialEdits: { summary: 'An edited summary for the owner.' },
      inspectorNotes: 'Owner wants work done before November.',
    });
    const html = render[kind](report, c);
    expect(html).toContain('id="ch-custom-abc123"');
    expect(html).toContain('Phasing &lt;plan&gt;');
    expect(html).toContain('<h3 class="nar-h">Week one</h3>');
    expect(html).not.toContain('ch-custom-bad');
    expect(html).toContain('We will add two drains at the NE corner.');
    expect(html).not.toContain('never shown here'); // a pinned stage would clip it
    expect(html).toContain('See &#123;&#123;CH}} below.'); // a typed token cannot eat a chapter number
    expect(html).toContain('Site walk with your facilities manager the week before.');
    expect(html).not.toContain('Tenant and occupants are notified'); // the standard list was replaced
    expect(html).toContain('An edited summary for the owner.');
    expect(html).toContain('Owner wants work done before November.');
    const keys = sectionsOf[kind](report, c).map((s) => s.key);
    expect(keys.indexOf('custom-abc123')).toBe(keys.indexOf('next') - 1); // before the closing chapter
    expect(keys[keys.length - 1]).toBe('photo-record'); // the full photo list ends the document
    // every chapter is numbered and the numbering has no hole
    if (kind === 'presentation') {
      const nums = [...html.slice(html.indexOf('<main')).matchAll(/<p class="sc-label">Chapter (\d+)/g)].map((m) => Number(m[1]));
      expect(nums).toEqual(nums.map((_, i) => i + 1));
      expect(nums.length).toBeGreaterThan(20);
    } else {
      expect(html).not.toContain('{{CH}}');
      expect(html).toContain('Chapter Twenty');
    }
    expect(html).not.toMatch(/your home|homeowner/i);
  });
});

describe('the commercial Inspection, with a scan and with pricing', () => {
  const inspectionOf = (r: any, c: any) => renderCommercialInspectionHtml(r, { jobType: 'retail', inspection: c });

  it('prints the photos as taken until a scan has read them, then sorts and describes them', () => {
    const c = ctx();
    const plain = { ...baseReport([photo(0, 'North field lap'), photo(1)]), commercial: commercialSnapshot(c) };
    const before = inspectionOf(plain, c);
    expect(before).toContain('2 photos, as taken');
    expect(before).not.toContain('class="ev-doc"');

    const { report } = scannedReport();
    const after = inspectionOf(report, c);
    expect(after).toContain('3 photos, 3 read and described');
    expect(after).toContain('class="ev-doc"');
    expect(after).toContain("Inspector's rating for seams and laps: <b>Failed</b>");
    expect(after).toContain('The lap is open at the centre of the frame.');
    expect(after).toContain('drafted with AI assistance');
    expect(after).toContain('.ev-doc {'); // the document shell's own values for the cards
    expect(after).not.toContain('Photos from the inspection <span>'); // not the as-taken record
  });

  it('a long tail of unscanned photos prints as a strip, not a card each', () => {
    const many = Array.from({ length: 60 }, (_, i) => photo(i));
    const c = ctx();
    const scanned = applyPhotoScan({ ...baseReport(many), commercial: commercialSnapshot(c) }, [{ url: many[0].url }], { results: [parseScanResponse(scanJson())], requested: 1, scanned: 1, timedOut: false });
    const html = inspectionOf(scanned, c);
    expect(html).toContain('60 photos, 1 read and described');
    expect(html.match(/class="ev-card"/g)).toHaveLength(1);
    expect(html).toContain('59 photos, as taken');
    expect(html).toContain('class="ev-strip"');
  });

  it('carries no price unless the rep priced it, and then shows the three options on the diagram and in a table', () => {
    const c = ctx();
    const unpriced = { ...baseReport(), commercial: commercialSnapshot(c) };
    const without = inspectionOf(unpriced, c);
    expect(without).not.toContain('Your Options');
    expect(without).not.toContain('What Is Included');
    expect(without).toContain('What the inspection calls for'); // the three paths
    expect(commercialInspectionSections(unpriced, { inspection: c }).find((s) => s.key === 'options')!.html).toBe('');

    const { report } = priced();
    const html = inspectionOf(report, c);
    expect(html).toContain('>Your Options</h2>');
    expect(html).toContain('better &middot; Quoted');
    expect(html).toContain('Duro-Last Commercial PVC (tear-off)');
    expect(html).toContain('includes R-25 ISO Insulation');
    expect(html).toContain('>What Is Included</h2>');
    expect(html).toContain('Complete tear-off of the existing roof to the deck');
    expect(html).toContain('Our Certificate of Insurance (COI) and our W-9 are provided to you before any work starts');
    expect(html).toContain('every permit is pulled before the start of work');
    // the diagram now draws the products quoted, option by option
    expect(html).toContain('data-asm-pick="better" aria-pressed="true"><span>better</span>Duro-Last Commercial PVC (tear-off)');
    expect(html).toContain('Duro-Last\u00AE PVC Roofing Membrane');
    expect(html).not.toContain('What the inspection calls for');
    const keys = commercialInspectionSections(report, { inspection: c }).map((s) => s.key);
    expect(keys.slice(keys.indexOf('layers'), keys.indexOf('layers') + 3)).toEqual(['layers', 'options', 'included']);
  });

  it('drives the diagram from scroll in the document shell, and finishes it for print and reduced motion', () => {
    const c = ctx();
    const html = inspectionOf({ ...baseReport(), commercial: commercialSnapshot(c) }, c);
    expect(html).toContain("document.querySelectorAll('.asm-doc')");
    expect(html).toContain("d.style.setProperty('--sc-p'");
    expect(html).toContain("'beforeprint'");
    expect(html).toContain('prefers-reduced-motion');
    expect(html).toContain('var(--sc-p, 1)'); // with no script at all the diagram is drawn finished
  });
});

/* ----------------------------------------------------------------- layout --- */

describe('required sections and the minimum length', () => {
  const secs: ReportSection[] = [
    { key: 'a', label: 'A', html: '<p>a</p>' }, { key: 'b', label: 'B', html: '<p>b</p>', required: true },
    { key: 'c', label: 'C', html: '<p>c</p>' }, { key: 'd', label: 'D', html: '' }, { key: 'e', label: 'E', html: '<p>e</p>' },
  ];
  it('a required section is shown even when the layout hides it, and still moves', () => {
    const out = arrangeSections(secs, { hidden: ['b', 'c'], order: ['e', 'b', 'a'] });
    expect(out.map((s) => s.key)).toEqual(['e', 'b', 'a']);
    expect(describeSections(secs, { hidden: ['b'] }).find((s) => s.key === 'b')).toMatchObject({ hidden: false, required: true });
  });
  it('un-hides in template order only as far as the minimum needs', () => {
    expect(enforceMinimumSections(secs, { hidden: ['a', 'c', 'e'] }, 3)!.hidden).toEqual(['e']);
    expect(enforceMinimumSections(secs, { hidden: ['a'] }, 3)!.hidden).toEqual(['a']); // already long enough
    expect(enforceMinimumSections(secs, null, 3)).toBeNull();
    expect(enforceMinimumSections(secs, { hidden: ['a', 'c', 'e'] }, 99)!.hidden).toEqual([]); // cannot conjure chapters
  });
  it('custom chapters need a title and something to say; notes skip pinned chapters', () => {
    expect(customSections([{ id: 'ok1', title: 'T', body: '' }, { id: 'ok2', title: '', body: 'b' }, { id: 'ok3', title: 'T', body: 'b' }, { id: 'ok3', title: 'dupe', body: 'b' }]).map((s) => s.key)).toEqual(['custom-ok3']);
    const noted = withSectionNotes([{ key: 'x', label: 'X', html: '<section><div class="sc-wrap"><p>x</p></div></section>' }, { key: 'y', label: 'Y', html: '<section data-sc-act="pin"><div></div></section>' }], { x: 'a <note>', y: 'no' });
    expect(noted[0].html).toContain('<aside class="rep-note">');
    expect(noted[0].html).toContain('a &lt;note&gt;');
    expect(noted[0].html.indexOf('rep-note')).toBeLessThan(noted[0].html.lastIndexOf('</div>'));
    expect(noted[1].html).not.toContain('rep-note');
  });
});

/* ------------------------------------------------------------------ draft --- */

describe('editing a commercial document', () => {
  it('saves the commercial fields, cleaned, and reports each change', () => {
    const { report } = scannedReport();
    const applied = applyDraft(report, {
      commercialSummary: '  A tighter\nsummary.  ',
      sectionNotes: { water: 'Two new drains.', 'Bad Key!': 'x' },
      customSections: [{ id: 'abc', title: ' Phasing ', body: 'Week one', photoUrl: 'javascript:alert(1)' }, { id: 'NOPE', title: 'x', body: 'y' }],
      assembly: {
        layers: { 't-membrane': { label: ' 60 mil EPDM ' }, 'x-bad': { label: 'no' } },
        actions: { tear_off: { 't-insulation': 'stays', 'n-tear_off-membrane': 'removed' }, bogus: { 't-deck': 'removed' } } as any,
        note: 'Core cut dry.', photoUrl: 'https://cdn.example.com/core.jpg', photoCaption: 'The core',
      },
      beforeStartTerms: ['  Site walk first.  ', ''],
    });
    expect(applied.changes).toEqual(['summary', 'chapter notes (1)', 'your own chapters (1)', 'layer diagram', 'before-we-start list (1)']);
    const d = applied.data;
    expect(d.commercialEdits.summary).toBe('A tighter summary.');
    expect(d.sectionNotes).toEqual({ water: 'Two new drains.' });
    expect(d.customSections).toEqual([{ id: 'abc', title: 'Phasing', body: 'Week one' }]); // unsafe photo url dropped
    expect(d.assemblyEdits).toEqual({
      layers: { 't-membrane': { label: '60 mil EPDM' } },
      actions: { tear_off: { 't-insulation': 'stays' } }, // a new layer has no fate to change
      note: 'Core cut dry.', photoUrl: 'https://cdn.example.com/core.jpg', photoCaption: 'The core',
    });
    expect(d.beforeStartTerms).toEqual(['Site walk first.']);
    // a note that is not text is ignored, and the stored notes have a ceiling however many saves it takes
    expect(applyDraft(d, { sectionNotes: { fix: { evil: true } as any } }).changes).toEqual([]);
    let grown = d;
    for (let i = 0; i < 3; i++) grown = applyDraft(grown, { sectionNotes: Object.fromEntries(Array.from({ length: 30 }, (_, k) => [`k${i}-${k}`, 'note'])) }).data;
    expect(Object.keys(grown.sectionNotes).length).toBe(40);
    // applying the same draft again changes nothing
    expect(applyDraft(d, { sectionNotes: { water: 'Two new drains.' }, beforeStartTerms: ['Site walk first.'] }).changes).toEqual([]);
    // and each one can be undone
    const undone = applyDraft(d, { commercialSummary: '', sectionNotes: { water: '' }, customSections: [], assembly: null, beforeStartTerms: null });
    expect(undone.changes).toEqual(['summary', 'chapter notes removed', 'your own chapters removed', 'layer diagram reset', 'before-we-start list reset']);
    expect(undone.data.beforeStartTerms).toBeUndefined();
    expect(undone.data.assemblyEdits).toBeNull();
  });

  it("typing the inspector's own summary back is not an edit, and none of this touches a residential report", () => {
    const { report } = scannedReport();
    expect(applyDraft(report, { commercialSummary: report.commercial.damageSummary }).changes).toEqual([]);
    const residential = baseReport();
    expect(applyDraft(residential, { commercialSummary: 'x', sectionNotes: { found: 'y' }, customSections: [{ id: 'a', title: 't', body: 'b' }], beforeStartTerms: ['z'] }).changes).toEqual([]);
    expect(isEmptyDraft({ beforeStartTerms: null })).toBe(false);
    expect(isEmptyDraft({ sectionNotes: {} })).toBe(true);
  });
});
