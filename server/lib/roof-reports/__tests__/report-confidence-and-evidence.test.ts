/**
 * Two rules the customer-facing report has to hold to:
 *
 *  1. AI confidence scores are INTERNAL. They tell an inspector how much to
 *     trust the model; a "72% conf." badge on a homeowner's roof photo invites
 *     exactly the argument the report exists to avoid.
 *  2. The evidence belongs beside the claim. Every finding carries
 *     relatedPhotoIds, and the narrative used to render as a wall of text with
 *     all the photography dumped in a grid at the end.
 */
import { describe, it, expect } from 'vitest';
import { generateComprehensiveReportHTML } from '../roof-analysis-report-html';
import { makeReport } from './fixtures/report';
import type { ComprehensiveRoofReport } from '../comprehensive-roof-report';

const PHOTO_A = 'https://cdn.example.com/boot.jpg';
const PHOTO_B = 'https://cdn.example.com/ridge.jpg';

function withFindings(over: Partial<ComprehensiveRoofReport> = {}): ComprehensiveRoofReport {
  const base = makeReport();
  return {
    ...base,
    damageAnalysis: {
      ...base.damageAnalysis,
      overallSeverity: 'high',
      damageTypes: [{ type: 'pipe_boot_failure', count: 1, severity: 'high' }],
      photos: [
        {
          id: 'p-a', url: PHOTO_A, caption: 'Pipe boot', overallSeverity: 'high',
          damages: [{ type: 'pipe_boot_failure', label: 'Pipe boot failure', severity: 'high', location: 'Rear slope', confidence: 72 }],
          aiSummary: '', analyzedAt: '',
        },
        {
          id: 'p-b', url: PHOTO_B, caption: 'Ridge', overallSeverity: 'low',
          damages: [{ type: 'granule_loss', label: 'Granule loss', severity: 'low', location: 'Ridge', confidence: 64 }],
          aiSummary: '', analyzedAt: '',
        },
      ],
    } as never,
    structuredFindings: [{
      id: 'f1', title: 'Pipe boot failure', severity: 'high',
      narrative: 'The rubber collar has split at the base.',
      relatedPhotoIds: ['p-a'], repairAction: 'Replace the boot', insuranceRelevant: false,
    }] as never,
    ...over,
  } as ComprehensiveRoofReport;
}

describe('confidence is internal only', () => {
  it('shows no confidence badge in the customer report', () => {
    const html = generateComprehensiveReportHTML(withFindings());
    expect(html).not.toContain('% conf.');
    expect(html).not.toContain('72% conf.');
  });

  it('shows no roof-age confidence badge in the customer report', () => {
    const html = generateComprehensiveReportHTML(
      withFindings({
        damageAnalysis: {
          ...withFindings().damageAnalysis,
          roofAge: { estimatedAgeYears: 12, expectedLifespanYears: 25, remainingLifeYears: 13, confidence: 'medium' },
        } as never,
      }),
    );
    expect(html).not.toContain('medium confidence');
  });

  it('defaults to the customer view when no flag is passed', () => {
    expect(generateComprehensiveReportHTML(withFindings(), {})).not.toContain('% conf.');
  });

  it('shows confidence when the internal view is explicitly asked for', () => {
    const html = generateComprehensiveReportHTML(withFindings(), { internalView: true });
    expect(html).toContain('% conf.');
  });
});

describe('evidence sits beside the finding', () => {
  it('renders the related photo inside the finding card', () => {
    const html = generateComprehensiveReportHTML(withFindings());
    const findingsAt = html.indexOf('Pipe boot failure');
    const galleryAt = html.lastIndexOf('Analyzed');
    expect(findingsAt).toBeGreaterThan(-1);
    // the photo appears before the gallery at the bottom, i.e. up in the narrative
    expect(html.indexOf(PHOTO_A)).toBeLessThan(galleryAt);
  });

  it('only pulls the photos the finding actually points at', () => {
    const html = generateComprehensiveReportHTML(withFindings());
    const card = html.slice(html.indexOf('The rubber collar has split'), html.indexOf('Damage Inventory'));
    expect(card).toContain(PHOTO_A);
    expect(card).not.toContain(PHOTO_B);
  });

  it('falls back to matching photos by damage type when there are no Claude findings', () => {
    const html = generateComprehensiveReportHTML(withFindings({ structuredFindings: undefined }));
    const card = html.slice(html.indexOf('Inspection Findings'), html.indexOf('Damage Inventory'));
    expect(card).toContain(PHOTO_A);
  });

  it('renders no evidence block when a finding points at nothing', () => {
    const html = generateComprehensiveReportHTML(
      withFindings({
        structuredFindings: [{
          id: 'f1', title: 'General wear', severity: 'low', narrative: 'Nothing specific.',
          relatedPhotoIds: [], repairAction: '', insuranceRelevant: false,
        }] as never,
      }),
    );
    const card = html.slice(html.indexOf('Nothing specific.'), html.indexOf('Damage Inventory'));
    expect(card).not.toContain('<img');
  });
});

describe('the report never shows a placeholder to a customer', () => {
  /** AI output routinely comes back with a field missing; the badge colour
   *  lookups already fell back but the text did not. */
  const withAge = (roofAge: unknown) => generateComprehensiveReportHTML(
    withFindings({
      damageAnalysis: { ...withFindings().damageAnalysis, roofAge } as never,
    }),
  );

  it('does not print "undefined" when the AI returned no material condition', () => {
    const html = withAge({
      estimatedAgeYears: 14, expectedLifespanYears: 25, remainingLifeYears: 8,
      confidence: 'medium', indicators: [], roofMaterial: null,
    });
    expect(html).not.toContain('>undefined<');
    expect(html).toContain('Not assessed');
  });

  it('does not print "~null years" when the AI returned no age', () => {
    const html = withAge({
      estimatedAgeYears: null, expectedLifespanYears: null, remainingLifeYears: null,
      confidence: 'low', indicators: [], roofMaterial: 'asphalt_shingle',
      materialCondition: 'fair',
    });
    expect(html).not.toMatch(/~\s*null/);
    expect(html).not.toContain('>undefined<');
  });

  it('drops the AI analysis block entirely when it has nothing to say', () => {
    const html = withAge({
      estimatedAgeYears: null, expectedLifespanYears: null, remainingLifeYears: null,
      confidence: 'low', indicators: [], roofMaterial: null, materialCondition: undefined,
    });
    expect(html).not.toContain('AI Roof Analysis');
  });

  it('still renders the block normally when the AI did return values', () => {
    const html = withAge({
      estimatedAgeYears: 14, expectedLifespanYears: 25, remainingLifeYears: 8,
      confidence: 'medium', indicators: ['granule loss'], roofMaterial: 'asphalt_shingle',
      materialCondition: 'fair',
    });
    expect(html).toContain('AI Roof Analysis');
    expect(html).toContain('14');
    expect(html).not.toContain('Not assessed');
  });
});
