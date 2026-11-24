import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditorView, EditorMessage, type EditorViewProps } from '../Editor';
import { initialFields, readDetail, valuesOf, fieldReducer, type ReportDetail } from '../editor-model';
import { partialNotes } from '../generate-flow';
import { initialShare, type ShareState } from '../share-model';
import { initialSend, sendReducer } from '../send-model';
import { initialPdf, pdfReducer } from '../pdf-model';
import { initialRewrites, rewriteReducer } from '../rewrite-model';
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
  share: initialShare(false), onCopyLink: noop, onTurnLinkOff: noop,
  rewrites: initialRewrites(), onRewrite: noop, onUndoRewrite: noop, pdf: initialPdf(), onPdf: noop, send: initialSend(), onOpenSend: noop, onEditSend: noop, onSend: noop, onCloseSend: noop,
  onBack: noop, onEdit: noop, onSave: noop, onTemplate: noop, onVisualStyle: noop, onAskArchive: noop, onCancelArchive: noop, onArchive: noop, onPreviewLoaded: noop, ...over,
}));

describe('the inspector notes field', () => {
  it('says next to the field that the customer may see the notes', () => {
    const html = view();
    expect(html).toContain('These notes can appear in the report the customer sees.');
    const at = html.indexOf('These notes can appear in the report the customer sees.');
    const field = html.indexOf('id="rr-edit-inspectorNotes"');
    expect(field).toBeGreaterThan(-1);
    // Close to the notes field and in the same block as its label.
    expect(Math.abs(at - field)).toBeLessThan(900);
    const textarea = /<textarea[^>]*id="rr-edit-inspectorNotes"[^>]*>/.exec(html)![0];
    expect(textarea).toContain('aria-describedby="rr-edit-inspectorNotes-help"');
    expect(html).toContain('id="rr-edit-inspectorNotes-help"');
  });
  it('shows it for a read-only person too, since they see the same field', () => {
    expect(view({ role: 'crew' as any })).toContain('These notes can appear in the report the customer sees.');
  });
});

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

  it('says in a plain sentence, under the Look control, when the look chosen is shown as a document instead', () => {
    const sentence = 'This report has only 2 photos, so it is shown as a document. A flight needs 3 or more.';
    const d = { ...detail(), visualStyle: 'flight' as const, look: { shown: 'formal' as const, notice: sentence } };
    const h = view({ detail: d });
    expect(h).toContain(sentence);
    expect(h).toMatch(/id="rr-look-notice"[^>]*role="status"|role="status"[^>]*id="rr-look-notice"/);
    // The select points at it, so a screen reader reads it with the control.
    expect(h).toMatch(/<select[^>]*id="rr-edit-look"[^>]*aria-describedby="rr-look-notice"|<select[^>]*aria-describedby="rr-look-notice"[^>]*id="rr-edit-look"/);
    expect(h).not.toMatch(BANNED);
  });

  it('says nothing about the look when it is shown as chosen, or when the server said nothing', () => {
    expect(view({ detail: { ...detail(), look: { shown: 'flight' as const, notice: null } } })).not.toContain('rr-look-notice');
    expect(view()).not.toContain('rr-look-notice');
    expect(view()).not.toMatch(/aria-describedby="rr-look-notice"/);
  });

  describe('the customer link', () => {
    const URL1 = 'https://app.example.test/r/roof/' + 'a'.repeat(64);
    const withShare = (share: ShareState, over: Partial<EditorViewProps> = {}) => view({ share, ...over });

    it('offers Copy link, and Turn link off only while a link is on, each as a real labelled button', () => {
      const off = withShare(initialShare(false));
      expect(off).toContain('Share with the customer');
      expect(off).toMatch(/<button[^>]*>Copy link<\/button>/);
      expect(off).not.toContain('Turn link off');
      expect(off).toContain('Nothing is sent to the customer.');
      const on = withShare(initialShare(true));
      expect(on).toContain('A share link is on. Anyone who has it can open this report.');
      expect(on).toMatch(/<button[^>]*>Turn link off<\/button>/);
      expect(on).toMatch(/<button[^>]*>Copy link<\/button>/);
    });

    it('answers a click in the same frame: Making the link... while it waits, and the button cannot be pressed twice', () => {
      const h = withShare({ on: false, phase: 'making', url: null, error: null });
      expect(h).toContain('Making the link...');
      expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Copy link<\/button>|<button[^>]*>Copy link<\/button>/);
      expect(h).toMatch(/role="status"[^>]*>[^<]*Making the link\.\.\./);
    });

    it('says the link was copied, with a status the screen reader reads', () => {
      const h = withShare({ on: true, phase: 'copied', url: URL1, error: null });
      expect(h).toContain('Link copied. Anyone who has it can open this report.');
      expect(h).toMatch(/role="status"[^>]*>[^<]*Link copied/);
    });

    it('shows the link in a labelled field to copy by hand when the browser would not', () => {
      const h = withShare({ on: true, phase: 'manual', url: URL1, error: null });
      expect(h).toContain('Your browser would not copy it. Copy the link from here.');
      expect(h).toMatch(/<label[^>]*for="rr-share-link"[^>]*>Share link<\/label>/);
      expect(h).toMatch(/<input[^>]*id="rr-share-link"[^>]*readOnly=""|<input[^>]*readonly=""[^>]*id="rr-share-link"|<input[^>]*id="rr-share-link"[^>]*readonly=""/);
      expect(h).toContain(URL1);
    });

    it('says Turning the link off... at once, then that it is off', () => {
      expect(withShare({ on: true, phase: 'turningOff', url: null, error: null })).toContain('Turning the link off...');
      const off = withShare({ on: false, phase: 'off', url: null, error: null });
      expect(off).toContain('The link is off. It no longer opens this report.');
      expect(off).not.toContain('Turn link off');
    });

    it('says in a plain sentence when it could not be done, and keeps the buttons', () => {
      const h = withShare({ on: false, phase: 'idle', url: null, error: 'The link could not be made. Please try again.' });
      expect(h).toContain('The link could not be made. Please try again.');
      expect(h).toContain('role="alert"');
      expect(h).toContain('Copy link');
    });

    it('draws nothing for a role that may not share, and has no banned marks', () => {
      const h = view({ role: 'production', share: initialShare(true) });
      expect(h).not.toContain('Copy link');
      expect(h).not.toContain('Turn link off');
      expect(h).not.toContain('Share with the customer');
      expect(withShare({ on: true, phase: 'copied', url: URL1, error: null })).not.toMatch(BANNED);
    });
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

describe('the editor: emailing the report', () => {
  it('shows the email button to a role that may send, and not to crew', () => {
    expect(view({ role: 'admin' })).toContain('Email this report');
    expect(view({ role: 'sales' })).toContain('Email this report');
    expect(view({ role: 'production' })).not.toContain('Email this report');
  });

  it('says how many times it was emailed, and when, only when it was', () => {
    expect(view()).not.toContain('Emailed');
    const d = { ...detail(), emailSentCount: 2, emailSentAt: '2026-11-24T15:00:00.000Z' };
    expect(view({ detail: d })).toContain('Emailed 2 times. Last sent Nov 24, 2026.');
  });

  it('draws the dialog only once it is opened, with the customer\'s address in it', () => {
    expect(view()).not.toContain('role="dialog"');
    const open = sendReducer(initialSend(), { type: 'open', email: 'dana@example.com', name: 'Dana Whitfield', key: 'send-aaaaaaaa' });
    const h = view({ send: open });
    expect(h).toContain('role="dialog"');
    expect(h).toContain('value="dana@example.com"');
  });

  it('reads the counts from the server\'s answer, and a missing count is none', async () => {
    const { readDetail: read } = await import('../editor-model');
    const base = { id: ID, status: 'ready', address: '12 Elm Street' };
    expect(read({ ...base, emailSentCount: 3, emailSentAt: '2026-11-24T15:00:00.000Z' })).toMatchObject({ emailSentCount: 3, emailSentAt: '2026-11-24T15:00:00.000Z' });
    expect(read(base)).toMatchObject({ emailSentCount: 0, emailSentAt: null });
    expect(read({ ...base, emailSentCount: 'lots' })).toMatchObject({ emailSentCount: 0 });
  });
});

describe('the editor: rewriting a finding or the summary', () => {
  it('puts a Rewrite button on the summary and on each finding, for a role that may edit, and not for one that may not', () => {
    const h = view({ role: 'admin' });
    expect(h).toContain('aria-label="Rewrite Summary"');
    expect(h).toContain('aria-label="Rewrite Finding 1: Missing shingles"');
    expect((h.match(/>Rewrite</g) ?? []).length).toBe(2);
    expect(view({ role: 'production' })).not.toContain('>Rewrite<');
  });

  it('says Rewriting on that one field, turns its button off and the box read-only, and leaves the others alone', () => {
    const h = view({ rewrites: rewriteReducer(initialRewrites(), { type: 'start', key: 'finding:0' }) });
    expect(h).toContain('Rewriting...');
    expect((h.match(/Rewriting\.\.\./g) ?? []).length).toBe(1);
    expect(h).toMatch(/<button[^>]*aria-label="Rewrite Finding 1: Missing shingles"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-label="Rewrite Finding 1: Missing shingles"/);
    expect(h).toMatch(/<textarea[^>]*id="rr-edit-finding-0"[^>]*disabled=""|<textarea[^>]*disabled=""[^>]*id="rr-edit-finding-0"/);
    expect(h).not.toMatch(/<button[^>]*aria-label="Rewrite Summary"[^>]*disabled=""/);
  });

  it('shows Undo rewrite only after a rewrite landed, on that field', () => {
    expect(view()).not.toContain('Undo rewrite');
    const done = rewriteReducer(rewriteReducer(initialRewrites(), { type: 'start', key: 'summary' }), { type: 'done', key: 'summary', previous: 'Old.' });
    const h = view({ rewrites: done });
    expect((h.match(/>Undo rewrite</g) ?? []).length).toBe(1);
    expect(h).toContain('aria-label="Undo rewrite of Summary"');
  });

  it('says the plain sentence when it failed, on that field', () => {
    const failed = rewriteReducer(rewriteReducer(initialRewrites(), { type: 'start', key: 'summary' }), { type: 'failed', key: 'summary', error: 'The rewrite did not work, so nothing was changed. Please try again.' });
    const h = view({ rewrites: failed });
    expect(h).toContain('role="alert"');
    expect(h).toContain('The rewrite did not work, so nothing was changed. Please try again.');
  });

  it('does not offer a rewrite of a box that holds unsaved typing, and says why', () => {
    const typed = fieldReducer(initialFields(valuesOf(detail())), { type: 'edit', key: 'summary', text: 'Typed but not saved' });
    const h = view({ fields: typed });
    expect(h).toMatch(/<button[^>]*aria-label="Rewrite Summary"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-label="Rewrite Summary"/);
    expect(h).toContain('Save your changes to this box first.');
  });

  it('draws no sparkle, wand or magic and no em dash', () => {
    const h = view({ rewrites: rewriteReducer(initialRewrites(), { type: 'start', key: 'summary' }) });
    expect(h).not.toMatch(BANNED);
    expect(h).not.toMatch(/sparkle|wand|magic/i);
  });
});

describe('the editor: the PDF button', () => {
  it('is there for anyone who can open the report, saying Download PDF', () => {
    for (const role of ['admin', 'sales', 'customer_service'] as const) expect(view({ role })).toContain('Download PDF');
    expect(view()).not.toContain('Preparing PDF...');
  });

  it('answers the press in the same frame: Preparing PDF..., busy, and not pressable again', () => {
    const h = view({ pdf: pdfReducer(initialPdf(), { type: 'start' }) });
    expect(h).toContain('Preparing PDF...');
    expect(h).not.toContain('>Download PDF<');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"|<button[^>]*aria-busy="true"[^>]*disabled=""/);
  });

  it('says in one plain sentence when it failed, and lets them press again', () => {
    const failed = pdfReducer(pdfReducer(initialPdf(), { type: 'start' }), { type: 'failed', error: 'The PDF could not be made. Please try again.' });
    const h = view({ pdf: failed });
    expect(h).toContain('role="alert"');
    expect(h).toContain('The PDF could not be made. Please try again.');
    expect(h).toContain('Download PDF');
  });

  it('reads the inspection day from the server\'s answer', async () => {
    const { readDetail: read } = await import('../editor-model');
    const base = { id: ID, status: 'ready', address: '12 Elm Street' };
    expect(read({ ...base, inspectionDate: '2026-11-20T00:00:00.000Z' })?.inspectionDate).toBe('2026-11-20T00:00:00.000Z');
    expect(read(base)?.inspectionDate).toBeNull();
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
