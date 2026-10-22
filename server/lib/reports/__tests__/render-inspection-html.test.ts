import { describe, it, expect } from 'vitest';
import { renderInspectionHtml, inspectionDamageSection } from '../render-inspection-html';
import { buildDamageAnalysisSection } from '../comprehensive-roof-report';
import { generateEstimateFromDamageAnalysis } from '../roof-repair-pricing';
import { withProfile } from '../../../tenant/context';
import { TEST_PROFILE } from '../../../__tests__/helpers/tenant';
import { FORMER_COMPANY } from './profiles';

const summary = generateEstimateFromDamageAnalysis([{ type: 'missing_shingles', count: 1 }]);

const report = (over: any = {}): any => ({
  id: 'r1',
  generatedAt: '2026-09-06T00:00:00Z',
  dataQuality: 'high',
  property: { address: '550 Manning Dr', city: 'Springfield', state: 'IL', zip: '62701' },
  damageAnalysis: {
    totalPhotosAnalyzed: 2,
    overallSeverity: 'high',
    aiSummary: 'We looked over 2 photos and found 1 kind of damage.',
    photos: [
      {
        id: 'photo-0', url: 'https://cdn.example/1.jpg', caption: 'South slope',
        damages: [{ id: 'd0', type: 'missing_shingles', label: 'Missing shingles', severity: 'high', description: 'Two tabs gone.', location: 'ridge' }],
      },
      { id: 'photo-1', url: 'https://cdn.example/clean.jpg', caption: 'North slope', damages: [] },
    ],
  },
  stormHistory: { totalEvents: 3, hailEvents: 1, windEvents: 2, yearsAnalyzed: 3, searchRadiusMiles: 5, riskLevel: 'moderate', claimPotential: 'high' },
  repairEstimate: { lineItems: summary.lineItems, total: summary.subtotalFinal, notes: [] },
  ...over,
});

describe('renderInspectionHtml', () => {
  const html = renderInspectionHtml(report());

  it('never shows a dollar figure or a repair estimate — pricing lives in other report types now', () => {
    expect(html).not.toContain('Repair Estimate');
    expect(html).not.toMatch(/\$[\d,]+\.\d{2}/);
  });

  it('shows every photo as taken, with its caption, and never a detected-damage label', () => {
    // The Inspection is the inspector's record. Vision findings ("Missing
    // Shingles", a "Fix Soon" severity) were being printed as though the
    // inspector had written them.
    expect(html).toContain('Photo Record');
    expect(html).toContain('cdn.example/1.jpg');
    expect(html).toContain('South slope');
    expect(html).toContain('cdn.example/clean.jpg');
    expect(html).toContain('North slope');
    expect(html).not.toContain('Missing Shingles');
    expect(html).not.toContain('Fix Soon');
    expect(html).not.toContain('Looks Okay Here');
    expect(html).not.toMatch(/found no problems/i);
  });

  it('keeps the storm record and drops what was derived from looking at photos', () => {
    expect(html).toContain('Storm History');
    expect(html).toMatch(/storm events recorded/i);
    expect(html).not.toContain('We looked over 2 photos'); // the vision summary
    expect(html).not.toContain('Roof Age');
    expect(html).not.toContain('Data quality');
  });

  it("includes the About Us / filing-a-claim section, built from the company's own profile only", () => {
    const acme = withProfile(TEST_PROFILE, () => renderInspectionHtml(report()));
    expect(acme).toContain('About Acme Roofing');
    expect(acme).toContain('Filing a Claim');
    expect(acme).toContain('They send an adjuster');
    expect(acme).toContain('Acme started in a garage.');
    expect(acme).toContain('Acme Credential One');
    expect(acme).toContain('(555) 010-2030');
    expect(acme).not.toMatch(FORMER_COMPANY);
  });

  it('a company that entered nothing gets the claim steps but no story, stats or credentials', () => {
    expect(html).toContain('They send an adjuster');
    expect(html).not.toContain('By the numbers');
    expect(html).not.toContain('class="cred"');
    expect(html).not.toContain('Reach out anytime');
    expect(html).not.toMatch(FORMER_COMPANY);
  });

  it('escapes customer/photo-controlled text', () => {
    const evil = report({ property: { address: '<script>alert(1)</script>', city: 'Springfield', state: 'IL' } });
    const out = renderInspectionHtml(evil);
    expect(out).not.toContain('<script>alert(1)</script>');
  });

  it('leaves out the "Our Work" map until the company has a project feed', () => {
    expect(html).not.toContain('See Our Work Near You');
    expect(html).not.toMatch(/<div class="work-map-wrap"/);
  });
});

describe('photo section — damage first, clean photos compacted', () => {
  const photo = (id: string, damages: any[] = []) => ({ id, url: `https://cdn/${id}.jpg`, damages, aiSummary: 'x' });
  const dmg = [{ id: 'd1', type: 'missing_shingles', label: 'Missing shingles', severity: 'high' }];

  it('does not give every clean photo its own card', () => {
    // On a real 117-photo job, 77 photos rendered "Looks Okay Here / We did not
    // see a problem in this photo" — 66% of the document, with the actual
    // damage buried in the middle of it.
    const report: any = { damageAnalysis: { photos: [photo('a', dmg), ...Array.from({ length: 20 }, (_, i) => photo(`c${i}`))] } };
    const html = inspectionDamageSection(report);
    expect((html.match(/We did not see a problem in this photo/g) || [])).toHaveLength(0);
  });

  it('still shows the clean photos, in one strip', () => {
    // They prove the whole roof was covered, and an adjuster wants them.
    const report: any = { damageAnalysis: { photos: [photo('a', dmg), photo('c1'), photo('c2')] } };
    const html = inspectionDamageSection(report);
    expect(html).toMatch(/found no problems/i);
    expect(html).toContain('c1.jpg');
    expect(html).toContain('c2.jpg');
  });

  it('counts damage photos in the header, not the whole set', () => {
    const report: any = { damageAnalysis: { photos: [photo('a', dmg), photo('c1'), photo('c2')] } };
    expect(inspectionDamageSection(report)).toMatch(/1 photo showing damage/);
  });

  it('says so plainly when nothing was found anywhere', () => {
    const report: any = { damageAnalysis: { photos: [photo('c1'), photo('c2')] } };
    const html = inspectionDamageSection(report);
    expect(html).toMatch(/did not find damage in any of the photos/i);
  });

  it('still handles a report with no photos', () => {
    expect(inspectionDamageSection({ damageAnalysis: { photos: [] } } as any)).toMatch(/No photos were submitted/i);
  });
});

describe('what the customer must NOT be told', () => {
  // The fixture deliberately sets claimPotential 'high' — the point is that it
  // is never printed regardless of value.
  const html = renderInspectionHtml(report());

  it('never prints our claim-odds read on their document', () => {
    // "Insurance claim potential: low" argues against the homeowner's own
    // claim before an adjuster has looked — and coverage is the carrier's
    // determination, not ours. The storm facts stay; the verdict does not.
    expect(html).not.toMatch(/claim potential/i);
    expect(html).toMatch(/storm events recorded/i);
  });

  it('does not repeat the photo count in the written summary', () => {
    // The count is already a stat at the top. Repeating it in prose made the
    // summary about our process rather than their roof, and contradicted the
    // findings prompt, which forbids photo counts outright.
    // Built by comprehensive-roof-report, so assert on a real generated
    // summary rather than the fixture's hand-written string.
    const generated = buildDamageAnalysisSection([
      { id: 'photo-0', url: 'u1', damages: [{ id: 'd0', type: 'missing_shingles', severity: 'high' }] },
      { id: 'photo-1', url: 'u2', damages: [] },
    ] as any);
    expect(generated.aiSummary).not.toMatch(/\d+\s+photos?/i);
    expect(generated.aiSummary).toMatch(/We found damage in/i);
  });
});
