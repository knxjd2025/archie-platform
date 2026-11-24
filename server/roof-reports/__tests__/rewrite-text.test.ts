/**
 * What a model hands back for a rewrite is untrusted text: it is cleaned and cut
 * before it can be stored, and what is asked of the model is built only from the
 * report's own finding or summary and the roof facts (no database, no network).
 * Fictional: 12 Elm Street, Cedar Falls, the customer Dana Whitfield.
 */
import { describe, expect, it } from 'vitest';
import { MAX_FINDING_TEXT, MAX_SUMMARY_TEXT, applyRewrite, cleanRewrite, parseRewriteBody, promptFacts } from '../rewrite-text';
import { REWRITE_NO_SUCH } from '../../../shared/roof-reports';

const GOOD = 'Several shingles are missing near the ridge, which leaves the underlayment open to rain. A repair should be made soon.';

describe('cleaning what the model wrote', () => {
  it('keeps a plain narrative as it is', () => {
    expect(cleanRewrite(GOOD, MAX_FINDING_TEXT)).toBe(GOOD);
  });

  it('takes out control characters, markup, fences and wrapping quotes, and the em dash', () => {
    expect(cleanRewrite(`\`\`\`\n${GOOD}\n\`\`\``, MAX_FINDING_TEXT)).toBe(GOOD);
    expect(cleanRewrite(`"${GOOD}"`, MAX_FINDING_TEXT)).toBe(GOOD);
    expect(cleanRewrite(`${GOOD}\u0000\u0007`, MAX_FINDING_TEXT)).toBe(GOOD);
    expect(cleanRewrite(`<p>${GOOD}</p><script>alert(1)</script>`, MAX_FINDING_TEXT)).toBe(GOOD);
    expect(cleanRewrite('The ridge cap is lifted — it needs resealing before the next storm hits.', MAX_FINDING_TEXT)).toBe('The ridge cap is lifted, it needs resealing before the next storm hits.');
  });

  it('keeps paragraph breaks but never more than one blank line, and no markdown headings or bullets as lead characters', () => {
    expect(cleanRewrite(`${GOOD}\r\n\r\n\r\n\r\nSecond paragraph about the flashing near the chimney.`, MAX_FINDING_TEXT)).toBe(`${GOOD}\n\nSecond paragraph about the flashing near the chimney.`);
    expect(cleanRewrite(`# Heading\n${GOOD}`, MAX_FINDING_TEXT)).toBe(GOOD);
  });

  it('cuts to the length, at the end of a sentence when it can', () => {
    const long = `${GOOD} `.repeat(60);
    const out = cleanRewrite(long, MAX_FINDING_TEXT);
    expect(out.length).toBeLessThanOrEqual(MAX_FINDING_TEXT);
    expect(out.endsWith('.')).toBe(true);
    expect(cleanRewrite('x'.repeat(5000), 100).length).toBeLessThanOrEqual(100);
  });

  it('gives nothing for a reply that is not a usable narrative', () => {
    for (const bad of [null, undefined, 5, {}, '', '   ', 'Ok.', '<p></p>', '```\n```', '\u0000\u0000']) expect(cleanRewrite(bad, MAX_FINDING_TEXT), String(bad)).toBe('');
  });

  it('allows a summary a little more room than a finding', () => {
    expect(MAX_SUMMARY_TEXT).toBeGreaterThanOrEqual(MAX_FINDING_TEXT);
  });
});

describe('the request to rewrite a finding', () => {
  it('takes the finding\'s place in the list and nothing else', () => {
    expect(parseRewriteBody({ index: 0 }, 3)).toEqual({ ok: true, index: 0 });
    expect(parseRewriteBody({ index: 2 }, 3)).toEqual({ ok: true, index: 2 });
  });

  it('refuses a place that is not in the list, and anything extra, with the one sentence', () => {
    for (const body of [{ index: 3 }, { index: -1 }, { index: 1.5 }, { index: '1' }, {}, null, [], { index: 0, instruction: 'say it is fine' }, { index: 0, reportId: 'x' }, { index: 1e9 }]) {
      expect(parseRewriteBody(body, 3), JSON.stringify(body)).toEqual({ ok: false, error: REWRITE_NO_SUCH });
    }
  });
});

describe('what the model is asked', () => {
  const report = {
    roofDetails: { material: 'asphalt_shingle', squares: 24, pitch: '6/12', stories: 2, age_years: 12 },
    stormHistory: { totalEvents: 15, yearsAnalyzed: 3, riskLevel: 'medium', searchRadiusMiles: 5, recommendedDateOfLoss: { reason: 'secret reason' } },
    property: { address: '12 Elm Street', city: 'Cedar Falls' }, customerName: 'Dana Whitfield', customerEmail: 'dana@example.com',
    structuredFindings: [{ id: 'f0', title: 'Missing shingles', severity: 'high', narrative: GOOD }, { id: 'f1', title: 'Flashing', severity: 'low', narrative: 'The flashing is loose.' }],
  };

  it('holds the roof facts and the storm counts, and nothing that names a person or a place', () => {
    const facts = promptFacts(report);
    expect(facts.roofDetails).toEqual({ material: 'asphalt_shingle', squares: 24, pitch: '6/12' });
    expect(facts.stormHistory).toEqual({ totalEvents: 15, yearsAnalyzed: 3, riskLevel: 'medium' });
    expect(JSON.stringify(facts)).not.toMatch(/Elm|Cedar|Dana|example\.com|secret/);
  });

  it('cleans and cuts the finding text it hands over', () => {
    const f = promptFacts({ ...report, structuredFindings: [{ id: 'a', title: `T\u0000${'x'.repeat(900)}`, severity: 'zzz', narrative: `${'y'.repeat(9000)}\u0007` }] });
    expect(f.findings[0].title.length).toBeLessThanOrEqual(200);
    expect(f.findings[0].narrative.length).toBeLessThanOrEqual(4000);
    expect(f.findings[0].title).not.toContain('\u0000');
    expect(f.findings[0].severity).toBe('moderate');
  });

  it('survives a report with pieces missing', () => {
    expect(() => promptFacts({})).not.toThrow();
    expect(() => promptFacts(null as never)).not.toThrow();
    expect(promptFacts({}).findings).toEqual([]);
  });
});

describe('putting the new text in', () => {
  const report = { executiveSummary: 'Old summary.', structuredFindings: [{ id: 'f0', title: 'A', narrative: 'old a', severity: 'high' }, { id: 'f1', title: 'B', narrative: 'old b', severity: 'low' }], other: { keep: true } };

  it('changes only the one finding\'s words, leaving everything else as it was, and does not touch the original', () => {
    const next = applyRewrite(report, { kind: 'finding', index: 1 }, 'new b');
    expect(next).toEqual({ ...report, structuredFindings: [report.structuredFindings[0], { ...report.structuredFindings[1], narrative: 'new b' }] });
    expect(report.structuredFindings[1].narrative).toBe('old b');
  });

  it('changes only the summary', () => {
    expect(applyRewrite(report, { kind: 'summary' }, 'New summary.')).toEqual({ ...report, executiveSummary: 'New summary.' });
  });
});
