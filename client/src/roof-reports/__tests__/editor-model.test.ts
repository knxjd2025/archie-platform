import { describe, expect, it } from 'vitest';
import {
  FRAME_SANDBOX, SaveChain, editsAllowed, fieldReducer, initialFields, previewSrc, readDetail, requestFor, valuesOf, type FieldsState, type ReportDetail,
} from '../editor-model';

const ID = '00000000-0000-4000-8000-0000000000aa';
const detail = (over: Record<string, unknown> = {}): unknown => ({
  id: ID, status: 'ready', problem: null, title: 'Roof report, 12 Elm Street', address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613',
  reportTypes: ['inspection'], template: 'full', visualStyle: null, customerName: 'Dana Whitfield', customerEmail: 'dana@example.com', customerPhone: null,
  inspectionDate: null, inspectorNotes: 'Ridge cap lifted.', jobExternalId: 'job-77', totalEstimate: 4200, createdAt: '2026-11-24T15:00:00.000Z', updatedAt: '2026-11-24T15:00:00.000Z',
  report: { id: ID, executiveSummary: 'Summary text.', structuredFindings: [{ title: 'Missing shingles', severity: 'high', narrative: 'Several shingles are missing.', extra: 1 }, { title: 'Flashing', severity: 'low', narrative: 'Flashing is loose.' }], property: {} },
  photos: [], ...over,
});

describe('reading the report as the editor holds it', () => {
  it('takes a ready report with its fields and findings', () => {
    const d = readDetail(detail())!;
    expect(d.id).toBe(ID);
    const v = valuesOf(d);
    expect(v).toEqual({
      title: 'Roof report, 12 Elm Street', customerName: 'Dana Whitfield', customerEmail: 'dana@example.com', customerPhone: '', inspectorNotes: 'Ridge cap lifted.',
      summary: 'Summary text.', findings: ['Several shingles are missing.', 'Flashing is loose.'],
    });
  });

  it('holds a report that is not ready without a report to edit', () => {
    const d = readDetail(detail({ status: 'generating', report: null }))!;
    expect(valuesOf(d).findings).toEqual([]);
    expect(valuesOf(d).summary).toBe('');
  });

  it('reads the look the server says the report is shown in, and the sentence about it, and nothing else', () => {
    expect(readDetail(detail({ look: { shown: 'formal', notice: 'This report has only 2 photos, so it is shown as a document. A flight needs 3 or more.' } }))!.look)
      .toEqual({ shown: 'formal', notice: 'This report has only 2 photos, so it is shown as a document. A flight needs 3 or more.' });
    expect(readDetail(detail({ look: { shown: 'flight', notice: null } }))!.look).toEqual({ shown: 'flight', notice: null });
    expect(readDetail(detail())!.look).toBeNull();
    expect(readDetail(detail({ look: { shown: 'sideways', notice: 5 } }))!.look).toBeNull();
    expect(readDetail(detail({ look: 'x' }))!.look).toBeNull();
  });

  it('reads whether a share link is on, and nothing else about it', () => {
    expect(readDetail(detail({ shareLinkOn: true }))!.shareLinkOn).toBe(true);
    expect(readDetail(detail({ shareLinkOn: false }))!.shareLinkOn).toBe(false);
    expect(readDetail(detail())!.shareLinkOn).toBe(false);
    expect(readDetail(detail({ shareLinkOn: 'yes', shareToken: 'x'.repeat(64) }))!.shareLinkOn).toBe(false);
    expect(JSON.stringify(readDetail(detail({ shareToken: 'x'.repeat(64) })))).not.toContain('x'.repeat(64));
  });

  it('is nothing when the answer is not a report', () => {
    expect(readDetail(null)).toBeNull();
    expect(readDetail({ id: 'x' })).toBeNull();
    expect(readDetail({ id: ID })).toBeNull();
  });

  it('ignores findings that are not text', () => {
    const d = readDetail(detail({ report: { executiveSummary: 5, structuredFindings: [{ narrative: 7 }, 'x', null] } }))!;
    expect(valuesOf(d).summary).toBe('');
    expect(valuesOf(d).findings).toEqual(['', '', '']);
  });
});

describe('what each save sends', () => {
  const d = readDetail(detail()) as ReportDetail;
  const v = valuesOf(d);

  it('sends only the one field for a plain field', () => {
    expect(requestFor('title', { ...v, title: 'New title' }, d.report)).toEqual({ title: 'New title' });
    expect(requestFor('customerPhone', { ...v, customerPhone: '319-555-0100' }, d.report)).toEqual({ customerPhone: '319-555-0100' });
    expect(requestFor('inspectorNotes', { ...v, inspectorNotes: 'x' }, d.report)).toEqual({ inspectorNotes: 'x' });
  });

  it('sends the whole report with just the summary changed for the summary, from what the server last confirmed', () => {
    const req = requestFor('summary', { ...v, summary: 'Better summary.' }, d.report) as { reportJson: Record<string, unknown> };
    expect(Object.keys(req)).toEqual(['reportJson']);
    expect(req.reportJson.executiveSummary).toBe('Better summary.');
    expect((req.reportJson.structuredFindings as Array<{ narrative: string }>)[0].narrative).toBe('Several shingles are missing.');
    expect(req.reportJson.property).toEqual({});
  });

  it('changes just one finding\'s text and keeps its title, severity and everything else', () => {
    const req = requestFor('finding:1', { ...v, findings: ['Several shingles are missing.', 'Flashing is loose at the chimney.'] }, d.report) as { reportJson: { structuredFindings: Array<Record<string, unknown>> } };
    expect(req.reportJson.structuredFindings[1]).toEqual({ title: 'Flashing', severity: 'low', narrative: 'Flashing is loose at the chimney.' });
    expect(req.reportJson.structuredFindings[0]).toMatchObject({ title: 'Missing shingles', extra: 1 });
    // A change to another field that has not been saved does not travel with this one.
    const other = requestFor('finding:1', { ...v, summary: 'unsaved other edit', findings: ['edited unsaved', 'Flashing is loose at the chimney.'] }, d.report) as { reportJson: Record<string, unknown> };
    expect(other.reportJson.executiveSummary).toBe('Summary text.');
    expect((other.reportJson.structuredFindings as Array<{ narrative: string }>)[0].narrative).toBe('Several shingles are missing.');
  });

  it('does not change the report it was handed', () => {
    const before = JSON.stringify(d.report);
    requestFor('summary', { ...v, summary: 'changed' }, d.report);
    expect(JSON.stringify(d.report)).toBe(before);
  });

  it('sends nothing for a report that has no contents to change', () => {
    expect(requestFor('summary', v, null)).toBeNull();
    expect(requestFor('finding:9', v, d.report)).toBeNull();
  });
});

describe('each field\'s own state', () => {
  const d = readDetail(detail()) as ReportDetail;
  const start = (): FieldsState => initialFields(valuesOf(d));

  it('starts with nothing to save', () => {
    expect(Object.values(start().status).every((s) => s.status === 'idle')).toBe(true);
  });

  it('is unsaved once the text differs from what was saved, and idle again when it is put back', () => {
    let s = fieldReducer(start(), { type: 'edit', key: 'title', text: 'New title' });
    expect(s.status.title).toEqual({ status: 'unsaved' });
    expect(s.values.title).toBe('New title');
    s = fieldReducer(s, { type: 'edit', key: 'title', text: 'Roof report, 12 Elm Street' });
    expect(s.status.title.status).toBe('idle');
  });

  it('says Saving, then Saved, and keeps the new text as what was saved', () => {
    let s = fieldReducer(start(), { type: 'edit', key: 'summary', text: 'Better.' });
    s = fieldReducer(s, { type: 'saving', key: 'summary' });
    expect(s.status.summary.status).toBe('saving');
    s = fieldReducer(s, { type: 'saved', key: 'summary', text: 'Better.' });
    expect(s.status.summary.status).toBe('saved');
    expect(s.saved.summary).toBe('Better.');
  });

  it('stays unsaved when the person kept typing while it saved', () => {
    let s = fieldReducer(start(), { type: 'edit', key: 'summary', text: 'Bet' });
    s = fieldReducer(s, { type: 'saving', key: 'summary' });
    s = fieldReducer(s, { type: 'edit', key: 'summary', text: 'Better' });
    s = fieldReducer(s, { type: 'saved', key: 'summary', text: 'Bet' });
    expect(s.status.summary.status).toBe('unsaved');
    expect(s.values.summary).toBe('Better');
  });

  it('keeps what was typed and says why when a save is refused', () => {
    let s = fieldReducer(start(), { type: 'edit', key: 'customerEmail', text: 'nope' });
    s = fieldReducer(s, { type: 'saving', key: 'customerEmail' });
    s = fieldReducer(s, { type: 'failed', key: 'customerEmail', error: 'That email address doesn\'t look right.' });
    expect(s.status.customerEmail).toEqual({ status: 'failed', error: 'That email address doesn\'t look right.' });
    expect(s.values.customerEmail).toBe('nope');
    // Typing again clears the old complaint.
    expect(fieldReducer(s, { type: 'edit', key: 'customerEmail', text: 'a@b.co' }).status.customerEmail).toEqual({ status: 'unsaved' });
  });

  it('starts again from a report just opened', () => {
    const s = fieldReducer(fieldReducer(start(), { type: 'edit', key: 'title', text: 'x' }), { type: 'reset', values: valuesOf(d) });
    expect(s).toEqual(start());
  });

  it('holds each finding as its own field', () => {
    const s = fieldReducer(start(), { type: 'edit', key: 'finding:1', text: 'Changed.' });
    expect(s.values.findings).toEqual(['Several shingles are missing.', 'Changed.']);
    expect(s.status['finding:1'].status).toBe('unsaved');
    expect(s.status['finding:0'].status).toBe('idle');
  });
});

describe('keeping saves in order', () => {
  it('runs one at a time, in the order they were asked for, even when an earlier one is slower or fails', async () => {
    const chain = new SaveChain();
    const log: string[] = [];
    const slow = chain.run(async () => { await new Promise((r) => setTimeout(r, 20)); log.push('first'); return 1; });
    const failing = chain.run(async () => { log.push('second'); throw new Error('no'); });
    const last = chain.run(async () => { log.push('third'); return 3; });
    expect(await slow).toBe(1);
    await expect(failing).rejects.toThrow('no');
    expect(await last).toBe(3);
    expect(log).toEqual(['first', 'second', 'third']);
  });
});

describe('the page frame and who may edit', () => {
  it('shows the page through the html route, by address only, and never lets it share the app\'s origin', () => {
    expect(previewSrc(ID, 3)).toBe(`/api/roof-reports/${ID}/html?v=3`);
    expect(FRAME_SANDBOX).toBe('allow-scripts');
    expect(FRAME_SANDBOX).not.toContain('allow-same-origin');
  });

  it('draws edit controls only for a role the written table lets edit', () => {
    expect(editsAllowed('admin')).toBe(true);
    expect(editsAllowed('sales')).toBe(true);
    expect(editsAllowed('production')).toBe(false);
  });
});
