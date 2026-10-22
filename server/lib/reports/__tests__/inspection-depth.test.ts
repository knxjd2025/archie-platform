import { describe, it, expect } from 'vitest';
import { renderInspectionHtml } from '../render-inspection-html';
import { ventilationRequirement, assemblyAgainstStandard, inspectionDetails, damageDetail } from '../sections/inspection-facts';
import { DOCUMENT_STYLE } from '../sections/style';
import { ASSEMBLY_STANDARDS, standardsReviewSheet } from '../damage-standards';
import { renderPresentationScrollcraftHtml } from '../render-presentation-scrollcraft';
import { applyReplacementPricing } from '../estimate-replacement';
import type { TierSelection } from '../roofing-products';

const report = (extra: any = {}): any => ({
  id: 'r-insp', generatedAt: '2026-09-14T12:00:00.000Z', version: '2.0',
  property: { address: '7 Depth Ct', city: 'Charlotte', state: 'NC', latitude: 35.2, longitude: -80.8 },
  stormHistory: { yearsAnalyzed: 3, searchRadiusMiles: 5, totalEvents: 4, hailEvents: 3, windEvents: 1, tornadoEvents: 0, largestHailInches: 1.5, highestWindMph: 62, riskLevel: 'high', riskScore: 70, claimPotential: 'high', eventsByYear: { 2025: { hail: 2, wind: 1, total: 3 } }, recommendedDateOfLoss: { date: '2025-05-20', eventType: 'Hail', magnitude: '1.5" hail', reason: 'largest' } },
  damageAnalysis: {
    totalPhotosAnalyzed: 1, photosWithDamage: 1, overallSeverity: 'high',
    roofAge: { estimatedAgeYears: 16, expectedLifespanYears: 25, remainingLifeYears: 9, confidence: 'medium', indicators: ['granule loss', 'curling at edges'], roofMaterial: 'asphalt_architectural', materialCondition: 'fair' },
    damageTypes: [], aiSummary: 'We found damage in 1 area.',
    photos: [{ id: 'p1', url: 'https://example.invalid/1.jpg', overallSeverity: 'high', aiSummary: 'x', analyzedAt: 'now', damages: [{ id: 'd1', type: 'hail_damage', label: 'Hail Damage', severity: 'high', confidence: 0.9, description: 'bruises', location: 'south' }] }],
  },
  repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] },
  inspectorNotes: '', dataQuality: 'verified', dataSources: [],
  ...extra,
});

const inspection = (answers: Record<string, unknown> = {}) => ({
  inspectionType: 'Insurance Claim', recommendation: 'File a claim', damageSummary: 'Hail on all slopes, 12 hits per square.', approxSquares: 30,
  answers: {
    'Inspector Name': 'Thomas B.', 'Inspection Date': '2026-09-10', 'Inspection Type': 'Insurance Claim',
    'How was the roof accessed?': 'Ladder and walked the roof', 'Number of Stories': '2 Story', 'Roof Covering Type': 'Asphalt Shingle - Architectural',
    'Average pitch across ALL slopes': '6/12', 'Number of existing layers': '1',
    'Drip edge': 'No', 'Felt or underlayment type': '#15', 'Ice and water shield': 'Yes - eaves only', 'Valley type': 'Closed cut', 'Starter course present': 'Yes - eaves and rakes',
    'Chimney': '24 x 36, no cricket', 'Skylights': 'None',
    'Ventilation types, counts, and plan': '4 box vents, no soffit intake. Recommend ridge vent plus soffit vents.',
    'Hail hits per test square by slope': 'N 12, S 14, E 9, W 11 (10x10)', 'Wind damage found': 'Yes', 'Soft metal hits found': 'Yes', 'Granule loss or accumulation in gutters and downspouts': 'Yes', 'Is shingle matching possible?': 'No, discontinued or unavailable',
    'Storm Date': '2026-05-11', 'Storm Type': 'Hail',
    'Leaks or water damage in the attic or interior': 'No', 'Decking type and condition': 'OSB, solid', 'Gutters and downspouts': '5 inch K-style, hits on north run', 'Siding damage': 'Yes',
    ...answers,
  },
});

describe('ventilation math', () => {
  it('estimates the attic floor from squares and pitch and applies the 1/150 and 1/300 rules', () => {
    const r = ventilationRequirement(30, '6/12')!;
    // 3000 sq ft of roof at 6/12 → floor ≈ 3000 / 1.118 = 2683
    expect(r.floorSqFt).toBe(2683);
    expect(r.nfa150SqIn).toBe(Math.round((2683 / 150) * 144));
    expect(r.nfa300SqIn).toBe(Math.round((2683 / 300) * 144));
    expect(r.pitchUsed).toBe('6/12');
    expect(ventilationRequirement(30, 'steep-ish')!.pitchUsed).toBe('6/12 (assumed)');
    expect(ventilationRequirement(0, '6/12')).toBeNull();
  });
});

describe('roof assembly graded against the standard', () => {
  it('flags a missing drip edge and eaves-only ice barrier, passes a full starter course', () => {
    const { html, attention } = assemblyAgainstStandard(inspection(), DOCUMENT_STYLE);
    expect(attention).toBe(2);
    expect(html).toContain('asm-status--attention');
    expect(html).toContain('No drip edge found');
    expect(html).toContain('At the eaves only');
    expect(html).toContain('Starter course at the eaves and rakes');
    expect(html).toContain('24 x 36, no cricket');
    expect(html).not.toContain('Skylights'); // "None" is not shown
  });

  it('"could not determine" is not verified, not a failure', () => {
    const { html, attention } = assemblyAgainstStandard(inspection({ 'Drip edge': 'Could not determine', 'Ice and water shield': 'Yes - eaves, valleys and penetrations' }), DOCUMENT_STYLE);
    expect(attention).toBe(0);
    expect(html).toContain('asm-status--unknown');
  });

  it('every assembly standard has a grader that handles all of its form options', () => {
    // Options straight from shared/inspection-form.ts.
    const opts: Record<string, string[]> = {
      'Drip edge': ['Yes - painted', 'Yes - prefinished / mill finished', 'No', 'Could not determine'],
      'Felt or underlayment type': ['#15', '#30', 'Synthetic', 'Rolled ice and water shield', 'None present', 'Could not determine'],
      'Ice and water shield': ['Yes - eaves only', 'Yes - eaves and valleys', 'Yes - eaves, valleys and penetrations', 'No', 'Could not determine'],
      'Valley type': ['Ice and water shield', 'Metal', 'Roll roofing', 'Closed cut', 'No valleys', 'Could not determine'],
      'Starter course present': ['Yes - eaves and rakes', 'Yes - eaves only', 'Yes - rakes only', 'No', 'Could not determine'],
    };
    for (const s of ASSEMBLY_STANDARDS) {
      for (const o of opts[s.field]) {
        const g = s.grade(o);
        expect(['present', 'attention', 'unknown'], `${s.field}: ${o}`).toContain(g.status);
        expect(g.note.length, `${s.field}: ${o}`).toBeGreaterThan(5);
      }
    }
    expect(standardsReviewSheet().some((r) => r.usedBy.includes('assembly:Drip edge'))).toBe(true);
  });
});

describe('the Inspection document', () => {
  const claim = renderInspectionHtml(report({ repConfirmedStorm: { date: '2026-05-11', type: 'Hail' } }), { jobType: 'insurance', inspection: inspection() });

  it('prints the details, the claim evidence, the graded assembly, ventilation, attic and exterior', () => {
    for (const s of ['Inspection Details', 'Thomas B.', 'September 10, 2026', 'Ladder and walked the roof', 'The Claim Evidence', 'N 12, S 14, E 9, W 11',
      'No, discontinued or unavailable', 'Roof Assembly, Checked Against the Standard', '2 items need attention', 'Attic Ventilation', 'sq in net free area',
      'Recommend ridge vent plus soffit vents', 'Attic &amp; Interior', 'OSB, solid', 'Ground &amp; Exterior', 'Collateral damage', '5 inch K-style',
      'What We Found', 'Hail on all slopes, 12 hits per square.', 'May 11, 2026', 'Storm History', 'Recommended date of loss']) {
      expect(claim, s).toContain(s);
    }
  });

  it('never estimates roof age — on a claim or a retail job', () => {
    // The engine guessed an age from photo condition. The inspector never
    // said it, so the Inspection does not either.
    expect(claim).not.toContain('Roof Age');
    const retail = renderInspectionHtml(report(), { jobType: 'retail', inspection: { ...inspection(), inspectionType: 'Retail / Non-Insurance' } });
    expect(retail).not.toContain('Roof Age');
    expect(retail).not.toContain('about 16 years');
    expect(retail).toContain('The Damage, In Detail');
  });

  it('never prints a vision finding, even when one is stored on the data', () => {
    expect(claim).not.toContain('Hail Damage'); // the fixture's vision finding
    expect(claim).not.toContain('Why it matters:');
  });

  it('prints every recorded answer field by field, long answers in full', () => {
    // The curated sections phrase a subset; this section is the guarantee
    // that nothing the inspector wrote is missing from the document.
    expect(claim).toContain('The Inspection, Field by Field');
    for (const s of ['Roof Assembly', 'Yes - eaves and rakes', 'Ground &amp; Exterior', 'hits on north run', 'Damage Findings', 'Attic &amp; Interior', 'Basics']) {
      expect(claim, s).toContain(s);
    }
    expect(claim).not.toContain('Inspector Signature');
  });

  it('prints no draft code citation anywhere', () => {
    for (const cite of ['R905.2.8.5', 'R806.2', 'R905.1.1', 'Shingle Applicator']) expect(claim).not.toContain(cite);
  });

  it('shows the write-up only when one was composed from the checklist and notes', () => {
    expect(claim).not.toContain('Inspection Findings, In Depth');
    const withN = renderInspectionHtml(report({ narrative: { findings: '## Overview\nField-wide bruising.', solution: null, generatedAt: 'now' } }), { jobType: 'insurance', inspection: inspection() });
    expect(withN).toContain('Inspection Findings, In Depth');
    expect(withN).toContain('Field-wide bruising.');
    expect(withN).toContain('subject to verification by a licensed insurance adjuster');
  });

  it('with no checklist at all it is a photo record, and says so', () => {
    const bare = renderInspectionHtml(report(), { jobType: 'retail' });
    expect(bare).toContain('Photo Record');
    expect(bare).toContain('No field inspection checklist has been submitted');
    expect(bare).not.toContain('Inspection Details');
    expect(bare).not.toContain('Roof Assembly, Checked');
    expect(bare).not.toContain('Roof Age');
    expect(bare).not.toContain('Hail Damage'); // the fixture's vision finding
  });

  it('prints the inspector\'s notes and a rep-written summary, in their words', () => {
    const html = renderInspectionHtml(report({ inspectorNotes: 'Walked all four slopes.', executiveSummary: 'Rep summary override.' }), { jobType: 'retail', inspection: inspection() });
    expect(html).toContain('Walked all four slopes.');
    expect(html).toContain('Rep summary override.');
  });

  it('measurement-report facts print in the details when present', () => {
    const html = inspectionDetails(inspection(), { documentName: 'EagleView-1.pdf', squares: 31, facets: 12, predominantPitch: '7/12', eavesFt: 150 }, DOCUMENT_STYLE);
    expect(html).toContain('EagleView-1.pdf');
    expect(html).toContain('150 ft');
    expect(damageDetail(inspection(), DOCUMENT_STYLE)).toContain('May 11, 2026 — Hail');
  });
});

describe('the Presentation carries the same depth', () => {
  const tiers = { good: 'landmark', better: 'landmark_pro', best: 'landmark_presidential' } as TierSelection;
  const priced = (extra: any = {}) => applyReplacementPricing(report({ measurements: { documentName: 'EagleView-9.pdf', squares: 30, facets: 11, predominantPitch: '6/12', eavesFt: 140 }, ...extra }), { tierSelection: tiers, squares: 30, selectedTier: 'better' });

  it('grades the assembly, sizes the ventilation, and shows the inspector summary and NOAA record on a claim', () => {
    const html = renderPresentationScrollcraftHtml(priced({ repConfirmedStorm: { date: '2026-05-11', type: 'Hail' } }), { customer: 'T', jobType: 'insurance', inspection: inspection() as any });
    for (const s of ['2 items need attention', 'asm-status--attention', 'No drip edge found', 'Your attic', 'sq in net free area', 'Recommend ridge vent plus soffit vents',
      "Your inspector's summary.", 'Recommended date of loss', 'Storm documented by inspector', 'EagleView-9.pdf', '140 ft']) {
      expect(html, s).toContain(s);
    }
    expect(html).not.toContain('Roof age'); // claim
    expect(html).not.toContain('R905.2.8.5');
  });

  it('shows the roof-age estimate on a retail job only', () => {
    const html = renderPresentationScrollcraftHtml(priced(), { customer: 'T', jobType: 'retail', inspection: { ...inspection(), inspectionType: 'Retail / Non-Insurance' } as any });
    expect(html).toContain('Roof age');
    expect(html).toContain('about 16 years');
    expect(html).not.toContain('Recommended date of loss');
  });
});
