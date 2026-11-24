import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditorView, EditorMessage, type EditorViewProps } from '../Editor';
import { initialFields, readDetail, valuesOf, fieldReducer, type ReportDetail } from '../editor-model';
import { partialNotes } from '../generate-flow';
import { WARN_OUT_OF_TIME, warnSomePhotos } from '../../../../shared/roof-reports';

const BANNED = new RegExp(`${String.fromCharCode(0x2014)}|✨|🪄`, 'u');
const noop = () => {};
const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const ID = '00000000-0000-4000-8000-0000000000aa';

const detail = (): ReportDetail => readDetail({
  id: ID, status: 'ready', problem: null, title: 'Roof report, 12 Elm Street', address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613',
  reportTypes: ['inspection'], template: 'full', visualStyle: null, customerName: 'Dana Whitfield', customerEmail: 'dana@example.com', customerPhone: '', inspectorNotes: 'Ridge cap lifted.',
  jobExternalId: null, createdAt: '2026-11-24T15:00:00.000Z',
  report: { executiveSummary: 'Summary text.', structuredFindings: [{ title: 'Missing shingles', severity: 'high', narrative: 'Several shingles are missing.' }] }, photos: [],
})!;

const view = (over: Partial<EditorViewProps> = {}) => render(createElement(EditorView, {
  role: 'admin', detail: detail(), fields: initialFields(valuesOf(detail())), previewVersion: 1, previewLoading: false, partial: [],
  style: { template: { busy: false, error: null }, visualStyle: { busy: false, error: null } }, archive: { phase: 'idle', error: null },
  onBack: noop, onEdit: noop, onSave: noop, onTemplate: noop, onVisualStyle: noop, onAskArchive: noop, onCancelArchive: noop, onArchive: noop, onPreviewLoaded: noop, ...over,
}));

describe('the editor as drawn', () => {
  it('shows the page in a frame that cannot reach the app, and never puts the report\'s HTML in the app\'s own page', () => {
    const h = view();
    expect(h).toMatch(/<iframe[^>]*sandbox="allow-scripts"/);
    expect(h).not.toContain('allow-same-origin');
    expect(h).toContain(`src="/api/roof-reports/${ID}/html?v=1"`);
    expect(h).toContain('title="Preview of the report"');
    expect(h).not.toContain('srcDoc');
    expect(h).not.toContain('srcdoc');
    expect(h).not.toContain('dangerouslySetInnerHTML');
  });

  it('says the preview is updating while it reloads', () => {
    expect(view({ previewLoading: true })).toContain('Updating the preview...');
    expect(view()).not.toContain('Updating the preview...');
  });

  it('leaves room under its last control, so the floating bug button and the phone menu never sit on Archive', () => {
    expect(view()).toMatch(/<section class="[^"]*\bpb-24\b/);
  });

  it('has a way back, and names the report', () => {
    const h = view();
    expect(h).toContain('Back to reports');
    expect(h).toContain('Roof report, 12 Elm Street');
  });

  it('labels every field, and gives each finding its own box named for it', () => {
    const h = view();
    for (const label of ['Report title', 'Customer name', 'Customer email', 'Customer phone', 'Inspector notes', 'Summary', 'Finding 1: Missing shingles']) expect(h).toContain(label);
    expect(h).not.toMatch(/<(input|select|textarea)(?![^>]*\bid=)[^>]*>/);
    expect(h).toMatch(/<label[^>]*for="rr-edit-title"/);
    expect(h).toMatch(/<label[^>]*for="rr-edit-finding-0"/);
    expect(h).toContain('Several shingles are missing.');
  });

  it('shows each field\'s own state beside it', () => {
    let fields = initialFields(valuesOf(detail()));
    fields = fieldReducer(fields, { type: 'edit', key: 'title', text: 'New' });
    fields = fieldReducer(fields, { type: 'saving', key: 'summary' });
    fields = fieldReducer(fields, { type: 'saved', key: 'customerName', text: 'Dana Whitfield' });
    fields = fieldReducer(fields, { type: 'edit', key: 'customerEmail', text: 'nope' });
    fields = fieldReducer(fields, { type: 'failed', key: 'customerEmail', error: 'That email address doesn\'t look right.' });
    const h = view({ fields });
    expect(h).toContain('Unsaved changes');
    expect(h).toContain('Saving...');
    expect(h).toContain('That email address doesn&#x27;t look right.');
    expect(h).toContain('role="alert"');
    expect(h).toContain('aria-label="Try saving Customer email again"');
    expect(h).toContain('aria-busy="true"');
  });

  it('offers the four styles and the three looks, each labelled, and says Saving... beside the one being saved', () => {
    const h = view({ style: { template: { busy: true, error: null }, visualStyle: { busy: false, error: 'The change could not be saved. Please try again.' } } });
    for (const word of ['Report style', 'Insurance claim', 'Quick summary', 'Look', 'Classic document', 'Presentation', 'Flight over the photos', 'The style&#x27;s usual look']) expect(h).toContain(word);
    expect(h).toMatch(/<label[^>]*for="rr-edit-template"/);
    expect(h).toMatch(/<label[^>]*for="rr-edit-look"/);
    expect(h).toContain('Saving...');
    expect(h).toContain('The change could not be saved. Please try again.');
  });

  it('asks before archiving, says Archiving... while it waits, and says why if it failed', () => {
    expect(view()).toContain('Archive this report');
    const asking = view({ archive: { phase: 'asking', error: null } });
    expect(asking).toContain('Archive this report? It leaves your list and can&#x27;t be opened again here.');
    expect(asking).toContain('Yes, archive');
    expect(asking).toContain('Keep it');
    expect(view({ archive: { phase: 'busy', error: null } })).toContain('Archiving...');
    expect(view({ archive: { phase: 'idle', error: 'The report could not be archived. Please try again.' } })).toContain('The report could not be archived. Please try again.');
  });

  it('says in amber what is missing from a report that is ready but partly missing, each in its own sentence', () => {
    const h = view({ partial: partialNotes([WARN_OUT_OF_TIME, warnSomePhotos(2, 5)].join(' ')) });
    expect(h).toContain('Part of this report is missing because it took too long to finish.');
    expect(h).toContain('2 of the 5 photos could not be looked at, so they are not described in the report.');
  });

  it('shows no edit controls to a role that may not edit, and says so', () => {
    const h = view({ role: 'production' });
    expect(h).toMatch(/<textarea[^>]*disabled=""/);
    expect(h).not.toMatch(/<(input|textarea|select)(?![^>]*disabled)[^>]*id="rr-edit/);
    expect(h).not.toContain('Archive this report');
    expect(h).toContain('You can look at this report but not change it.');
    expect(h).toContain('<iframe');
  });

  it('says when there are no written findings', () => {
    const d = { ...detail(), report: { executiveSummary: 'x' } };
    expect(view({ detail: d, fields: initialFields(valuesOf(d)) })).toContain('This report has no written findings to edit.');
  });

  it('has a focus ring on every control and uses no long dash, sparkle or wand', () => {
    const h = view();
    expect(h).toContain('focus-visible:ring-2');
    expect(h).not.toMatch(BANNED);
    expect(h).not.toMatch(/sparkle|wand|magic/i);
  });
});

describe('the editor when there is no report to edit yet', () => {
  const msg = (kind: Parameters<typeof EditorMessage>[0]['kind']) => render(createElement(EditorMessage, { kind, onBack: noop, onRetry: noop, problem: null }));
  it('says it is opening', () => { expect(msg('loading')).toContain('Opening the report...'); expect(msg('loading')).toContain('role="status"'); });
  it('says it could not be opened, with Try again', () => {
    const h = msg('loadFailed');
    expect(h).toContain('The report could not be opened. Please try again.');
    expect(h).toContain('>Try again<');
    expect(h).toContain('Back to reports');
  });
  it('says a report still being made cannot be edited yet', () => { expect(msg('making')).toContain('This report is still being made. Please try again once it finishes.'); });
  it('says a report that could not finish could not finish', () => { expect(msg('failed')).toContain('The report could not be finished.'); });
  it('says a report that is not there is not there', () => { expect(msg('missing')).toContain('That report could not be found.'); });
});
