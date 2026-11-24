/**
 * What goes into the PDF, as plain text prepared from the saved report: no
 * screen, no library. Everything a person or a model wrote is cleaned and cut to
 * length first; a section with nothing in it is left out; the words are plain.
 * Fictional: Summit Ridge Roofing, 12 Elm Street, Cedar Falls, the customer Dana Whitfield.
 */
import { describe, expect, it } from 'vitest';
import { makeReport } from '../../../../../server/lib/roof-reports/__tests__/fixtures/report';
import { pdfContent, pdfText, type PdfInput } from '../content';

const input = (over: Partial<PdfInput> = {}, report: Record<string, unknown> = {}): PdfInput => ({
  company: { name: 'Summit Ridge Roofing', phone: '555-0100', email: 'office@example.com', website: 'summitridge.example.com' },
  title: 'Roof report, 12 Elm Street', address: '12 Elm Street', cityStateZip: 'Cedar Falls, IA 50613', customerName: 'Dana Whitfield', inspectionDate: '2026-11-20T00:00:00.000Z', inspectorNotes: 'Ridge cap lifted near the chimney.',
  report: { ...(makeReport({ executiveSummary: 'The roof has wind damage near the ridge and should be repaired soon.' }) as unknown as Record<string, unknown>), ...report },
  photos: [], generatedOn: new Date('2026-11-24T15:00:00Z'), ...over,
});

describe('cleaning text for the PDF', () => {
  it('keeps plain text, takes out what the PDF cannot draw or should never carry, and cuts to length', () => {
    expect(pdfText('Hail damage near the ridge.', 100)).toBe('Hail damage near the ridge.');
    expect(pdfText('a\u0000b\u0007c‮d', 100)).toBe('abcd');
    expect(pdfText('Smart “quotes” and ’apostrophes’', 100)).toBe('Smart "quotes" and \'apostrophes\'');
    expect(pdfText('one — two', 100)).toBe('one, two');
    expect(pdfText('emoji 😀 gone', 100)).toBe('emoji gone');
    expect(pdfText('x'.repeat(50), 10)).toBe('xxxxxxxxx.');
    expect(pdfText('  spaced   out  ', 100)).toBe('spaced out');
    for (const bad of [null, undefined, 5, {}, []]) expect(pdfText(bad, 10)).toBe('');
  });

  it('keeps paragraph breaks', () => {
    expect(pdfText('One.\r\n\r\n\r\nTwo.', 100)).toBe('One.\n\nTwo.');
  });
});

describe('the PDF\'s contents', () => {
  it('opens with the company, the address, the customer and the day it was made', () => {
    const c = pdfContent(input());
    expect(c.cover).toMatchObject({ company: 'Summit Ridge Roofing', title: 'Roof report', address: '12 Elm Street', cityStateZip: 'Cedar Falls, IA 50613', customer: 'Dana Whitfield', inspected: 'Nov 20, 2026', made: 'Nov 24, 2026' });
    expect(c.footer).toBe('Summit Ridge Roofing  |  555-0100  |  office@example.com');
  });

  it('puts the summary and the findings in, each finding with its plain severity and what to do', () => {
    const c = pdfContent(input({}, { structuredFindings: [{ id: 'f0', title: 'Missing shingles', severity: 'high', narrative: 'Several shingles are missing near the ridge.', repairAction: 'Replace the shingles', insuranceRelevant: true, relatedPhotoIds: [] }] }));
    expect(c.summary).toContain('wind damage near the ridge');
    expect(c.findings).toEqual([{ title: 'Missing shingles', severity: 'High', narrative: 'Several shingles are missing near the ridge.', action: 'Replace the shingles' }]);
  });

  it('leaves out any section with nothing in it', () => {
    const c = pdfContent(input({ inspectorNotes: '', customerName: '', photos: [] }, { executiveSummary: '', structuredFindings: [], measurementReport: undefined, damageAnalysis: { ...makeReport().damageAnalysis, damageTypes: [], photos: [] }, repairEstimate: { lineItems: [], subtotal: 0, multiplierApplied: 1, total: 0, notes: [] }, stormHistory: { ...makeReport().stormHistory, totalEvents: 0, eventsByYear: {} } }));
    expect(c.summary).toBe('');
    expect(c.findings).toEqual([]);
    expect(c.damage).toEqual([]);
    expect(c.estimate).toBeNull();
    expect(c.measurements).toBeNull();
    expect(c.notes).toBe('');
    expect(c.photos).toEqual([]);
    expect(c.sections).not.toContain('Estimate');
    expect(c.cover.customer).toBe('');
  });

  it('lists the damage found, with counts', () => {
    const c = pdfContent(input());
    expect(c.damage).toEqual([{ label: 'Hail impact', count: 4, severity: 'High' }, { label: 'Wind lift', count: 2, severity: 'Medium' }]);
  });

  it('tells the storm history in plain lines', () => {
    const c = pdfContent(input());
    expect(c.storm?.lines).toEqual(expect.arrayContaining(['15 storm reports within 5 miles in the last 3 years: 8 hail, 7 wind.', 'Largest hail reported: 1.5 inches.', 'Highest wind reported: 65 mph.']));
    expect(c.storm?.years).toEqual({ 2024: { hail: 3, wind: 2, total: 5 }, 2025: { hail: 5, wind: 5, total: 10 } });
  });

  it('shows the estimate as a table with a total, in dollars', () => {
    const r = makeReport();
    const c = pdfContent(input({}, { repairEstimate: { ...r.repairEstimate, lineItems: [{ repairTypeId: 'a', repairName: 'Hail Damage Repair', quantity: 4, unit: 'each', baseCostPerUnit: 100, finalCostPerUnit: 165, totalBaseCost: 400, totalFinalCost: 660 }], total: 660, subtotal: 400 } }));
    expect(c.estimate).toEqual({ rows: [{ item: 'Hail Damage Repair', quantity: '4 each', each: '$165.00', total: '$660.00' }], total: '$660.00' });
  });

  it('puts the photos in, each with a plain caption', () => {
    const c = pdfContent(input({ photos: [{ id: 'p1', category: 'roof_surface', dataUrl: 'data:image/jpeg;base64,AAAA' }, { id: 'p2', category: null, dataUrl: 'data:image/jpeg;base64,BBBB' }] }, { damageAnalysis: { ...makeReport().damageAnalysis, photos: [{ id: 'p1', url: '', damages: [], overallSeverity: 'low', aiSummary: 'Granule loss is visible on this slope.', analyzedAt: '' }] } }));
    expect(c.photos).toEqual([{ dataUrl: 'data:image/jpeg;base64,AAAA', caption: 'Roof surface. Granule loss is visible on this slope.' }, { dataUrl: 'data:image/jpeg;base64,BBBB', caption: '' }]);
  });

  it('takes a photo only if it is a JPEG or PNG picture in the page, never an address', () => {
    const c = pdfContent(input({ photos: [{ id: 'a', category: null, dataUrl: 'https://evil.example/x.jpg' }, { id: 'b', category: null, dataUrl: 'javascript:alert(1)' }, { id: 'c', category: null, dataUrl: 'data:text/html;base64,AAAA' }, { id: 'd', category: null, dataUrl: 'data:image/jpeg;base64,QUJD' }] }));
    expect(c.photos.map((p) => p.dataUrl)).toEqual(['data:image/jpeg;base64,QUJD']);
  });

  it('cleans and cuts everything a person or a model wrote, and holds no em dash or markup in any of it', () => {
    const evil = '<script>alert(1)</script> — \u0000 ' + 'long '.repeat(2000);
    const c = pdfContent(input({ title: evil, customerName: evil, inspectorNotes: evil, company: { name: evil, phone: evil, email: evil, website: evil } }, {
      executiveSummary: evil,
      structuredFindings: [{ title: evil, severity: 'weird', narrative: evil, repairAction: evil }],
      damageAnalysis: { ...makeReport().damageAnalysis, damageTypes: [{ type: evil, count: 3, severity: evil }] },
    }));
    const text = JSON.stringify(c);
    expect(text).not.toContain('—');
    expect(text).not.toContain('\\u0000');
    expect(c.summary.length).toBeLessThanOrEqual(4000);
    expect(c.findings[0].narrative.length).toBeLessThanOrEqual(2000);
    expect(c.notes.length).toBeLessThanOrEqual(4000);
    expect(c.damage[0].label).toBe('Other');
    expect(c.findings[0].severity).toBe('Noted');
  });

  it('survives a report with pieces missing or the wrong shape', () => {
    for (const report of [{}, { stormHistory: null, damageAnalysis: null, repairEstimate: null, structuredFindings: 'x', measurementReport: 5 }, { structuredFindings: [null, 5, {}], executiveSummary: 12 }]) {
      expect(() => pdfContent(input({}, report as never)), JSON.stringify(report)).not.toThrow();
    }
    expect(() => pdfContent({ ...input(), report: null as never })).not.toThrow();
  });

  it('ends with a plain note about what the report is, and no promise about insurance', () => {
    const c = pdfContent(input());
    expect(c.disclaimer).toMatch(/not a guarantee/i);
    expect(c.disclaimer).not.toContain('—');
  });
});
