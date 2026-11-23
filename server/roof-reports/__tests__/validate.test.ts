/**
 * What the roof report routes accept (Task B7): the generate body, the update
 * body, a saved report's contents and a saved page. Pure functions, no
 * database. Fictional customer: Dana Whitfield, 12 Elm Street, Cedar Falls.
 *
 * The rule behind all of it: a request names WHAT to change, never WHOSE. A
 * company, a role, a status, a share token or an id in a body is refused or
 * never read.
 */
import { describe, it, expect } from 'vitest';
import {
  checkEditedHtml, parseGenerateBody, parseListQuery, parseUpdateBody, sanitizeReportJson, MAX_REPORT_JSON_BYTES, MAX_EDITED_HTML_BYTES,
} from '../validate';
import {
  BAD_DATE, BAD_EMAIL, CANT_CHANGE, NEEDS_ADDRESS, NEEDS_CITY_STATE, NOTHING_TO_CHANGE, NOT_A_KIND, NOT_A_STYLE, NOT_A_TEMPLATE,
  PAGE_NOT_SAFE, PICK_A_KIND, REPORT_DATA_BAD, TEXT_TOO_LONG, TOO_MANY_PHOTOS, NOT_TEXT, roofReportPhotoPath,
} from '../../../shared/roof-reports';

const REPORT = 'a1b2c3d4-0000-4000-8000-000000000001';
const photo = (i: number) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`;

const good = {
  reportTypes: ['inspection', 'storm'], template: 'homeowner', address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613',
  photoIds: [photo(1), photo(2)], inspectorNotes: 'Ladder was wet.',
  customer: { name: 'Dana Whitfield', email: 'dana@example.com', phone: '(555) 010-0142' },
  roofDetails: { squares: '28', pitch: '6/12' },
};

describe('parseGenerateBody', () => {
  it('reads a good body into a request, cleaning what was typed', () => {
    const r = parseGenerateBody(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      reportTypes: ['inspection', 'storm'], template: 'homeowner', address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', zip: '50613',
      photoIds: [photo(1), photo(2)], inspectorNotes: 'Ladder was wet.',
      customer: { name: 'Dana Whitfield', email: 'dana@example.com', phone: '(555) 010-0142' },
    });
    expect(r.value.roofDetails).toEqual({ squares: 28, pitch: '6/12', stories: undefined });
  });

  it('says what is wrong in a plain sentence', () => {
    const err = (body: unknown) => { const r = parseGenerateBody(body); return r.ok ? null : r.error; };
    expect(err(null)).toBe(PICK_A_KIND);
    expect(err({ ...good, reportTypes: [] })).toBe(PICK_A_KIND);
    expect(err({ ...good, reportTypes: 'inspection' })).toBe(PICK_A_KIND);
    expect(err({ ...good, reportTypes: ['inspect'] })).toBe(NOT_A_KIND);
    expect(err({ ...good, address: '   ' })).toBe(NEEDS_ADDRESS);
    expect(err({ ...good, address: 12 })).toBe(NEEDS_ADDRESS);
    expect(err({ ...good, city: '' })).toBe(NEEDS_CITY_STATE);
    expect(err({ ...good, state: undefined })).toBe(NEEDS_CITY_STATE);
    expect(err({ ...good, template: 'luxury' })).toBe(NOT_A_TEMPLATE);
    expect(err({ ...good, photoIds: Array.from({ length: 41 }, (_, i) => photo(i + 1)) })).toBe(TOO_MANY_PHOTOS);
    expect(err({ ...good, customer: { email: 'not an email' } })).toBe(BAD_EMAIL);
    expect(err({ ...good, address: 'x'.repeat(500) })).toBe(TEXT_TOO_LONG);
  });

  it('takes the template as full when none is sent, and ignores photo ids that are not ids', () => {
    const r = parseGenerateBody({ ...good, template: undefined, photoIds: [photo(1), 'nope', '../x', 5, photo(1)] });
    expect(r.ok && r.value.template).toBe('full');
    expect(r.ok && r.value.photoIds).toEqual([photo(1)]);
  });

  it('never reads a company, a role, a status, an id or a token from the body', () => {
    const r = parseGenerateBody({ ...good, companyId: 'other', company_id: 'other', role: 'admin', status: 'ready', id: REPORT, shareToken: 'x', createdByMemberId: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.value).sort()).toEqual(['address', 'city', 'customer', 'damageCounts', 'inspectorNotes', 'jobExternalId', 'measurements', 'photoIds', 'reportTypes', 'roofDetails', 'state', 'template', 'zip'].sort());
    expect(JSON.stringify(r.value)).not.toMatch(/other|admin|ready|shareToken/);
  });

  it('keeps a job key only as text, for the route to check against the person\'s own jobs', () => {
    const r = parseGenerateBody({ ...good, jobExternalId: ' job-123 ' });
    expect(r.ok && r.value.jobExternalId).toBe('job-123');
    const odd = parseGenerateBody({ ...good, jobExternalId: { $ne: 1 } });
    expect(odd.ok && odd.value.jobExternalId).toBeUndefined();
  });
});

describe('parseUpdateBody', () => {
  it('accepts only the named fields, cleaned', () => {
    const r = parseUpdateBody({ title: ' Roof report for Dana ', customerName: 'Dana Whitfield', customerEmail: 'DANA@example.com', customerPhone: '555', inspectorNotes: 'x', inspectionDate: '2026-11-20', template: 'insurance', visualStyle: 'flight' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe('Roof report for Dana');
    expect(r.value.customerEmail).toBe('dana@example.com');
    expect(r.value.inspectionDate).toEqual(new Date('2026-11-20'));
    expect(r.value.template).toBe('insurance');
    expect(r.value.visualStyle).toBe('flight');
  });

  it('refuses every field that is not named, whatever it is', () => {
    for (const field of ['companyId', 'company_id', 'id', 'status', 'shareToken', 'share_token', 'createdByMemberId', 'reportTypes', 'address', 'legacyId', 'emailSentCount', 'problem', 'totalEstimate', 'role', '__proto__', 'constructor']) {
      const body = JSON.parse(`{"title":"x","${field}":"y"}`);
      const r = parseUpdateBody(body);
      expect(r, field).toEqual({ ok: false, error: CANT_CHANGE });
    }
  });

  it('refuses nothing to change, and a body that is not an object', () => {
    expect(parseUpdateBody({})).toEqual({ ok: false, error: NOTHING_TO_CHANGE });
    expect(parseUpdateBody(null)).toEqual({ ok: false, error: NOTHING_TO_CHANGE });
    expect(parseUpdateBody([1])).toEqual({ ok: false, error: NOTHING_TO_CHANGE });
    expect(parseUpdateBody('x')).toEqual({ ok: false, error: NOTHING_TO_CHANGE });
  });

  it('checks each value and answers in plain words', () => {
    const err = (body: object) => { const r = parseUpdateBody(body); return r.ok ? null : r.error; };
    expect(err({ title: 5 })).toBe(NOT_TEXT);
    expect(err({ title: 'x'.repeat(300) })).toBe(TEXT_TOO_LONG);
    expect(err({ customerEmail: 'nope' })).toBe(BAD_EMAIL);
    expect(err({ inspectionDate: 'last tuesday' })).toBe(BAD_DATE);
    expect(err({ inspectionDate: '1850-01-01' })).toBe(BAD_DATE);
    expect(err({ template: 'luxury' })).toBe(NOT_A_TEMPLATE);
    expect(err({ visualStyle: 'neon' })).toBe(NOT_A_STYLE);
    expect(err({ reportJson: 'a string' })).toBe(REPORT_DATA_BAD);
    expect(err({ reportJson: [1] })).toBe(REPORT_DATA_BAD);
    expect(err({ reportJson: { pad: 'x'.repeat(MAX_REPORT_JSON_BYTES) } })).toBe(TEXT_TOO_LONG);
    expect(err({ editedHtml: 'x'.repeat(MAX_EDITED_HTML_BYTES + 1) })).toBe(TEXT_TOO_LONG);
    expect(err({ editedHtml: 7 })).toBe(NOT_TEXT);
    expect(err({ editedHtml: '<p onclick="x()">hi</p>' })).toBe(PAGE_NOT_SAFE);
    expect(err({ editedHtml: '<h1>Roof report</h1>' })).toBeNull();
    expect(err({ jobExternalId: 7 })).toBe(NOT_TEXT);
  });

  it('lets a value be cleared with null or an empty string, and a style go back to the template\'s own', () => {
    const r = parseUpdateBody({ title: '', customerEmail: null, visualStyle: null, jobExternalId: null, inspectionDate: null, editedHtml: null });
    expect(r.ok && r.value).toMatchObject({ title: null, customerEmail: null, visualStyle: null, jobExternalId: null, inspectionDate: null, editedHtml: null });
  });
});

describe('checkEditedHtml', () => {
  it('lets a plain page through', () => {
    expect(checkEditedHtml('<!doctype html><html><head><style>p{color:#333}</style></head><body><h1>Roof report</h1><p>Dana &amp; co</p><img src="https://example.com/a.jpg"></body></html>')).toBe(true);
  });
  it('refuses what can run or change where the page goes', () => {
    for (const bad of [
      '<p>x</p><script>alert(1)</script>', '<SCRIPT src=x></SCRIPT>', '<iframe src="https://x"></iframe>', '<object data=x></object>', '<embed src=x>',
      '<p onclick="x()">x</p>', '<img src=x onerror=alert(1)>', '<a href="javascript:alert(1)">x</a>', '<a href="  JaVaScRiPt:alert(1)">x</a>',
      '<base href="https://evil.example/">', '<form action="https://evil.example/"><input></form>', '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
      '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', '<svg><script>1</script></svg>',
    ]) expect(checkEditedHtml(bad), bad).toBe(false);
    expect(PAGE_NOT_SAFE).toBeTruthy();
  });
});

describe('sanitizeReportJson', () => {
  const ownPhotos = [photo(1), photo(2)];
  const report = (over: Record<string, unknown> = {}) => ({
    id: 'whatever-the-editor-sent', generatedAt: '2026-11-24T12:00:00Z', version: '3.1',
    property: { address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', latitude: '42.5', longitude: -92.4 },
    stormHistory: { totalEvents: '7', hailEvents: '<img src=x onerror=alert(1)>', yearsAnalyzed: 3, eventsByYear: {} },
    damageAnalysis: {
      totalPhotosAnalyzed: 2, photosWithDamage: 1, overallSeverity: 'medium', damageTypes: [], aiSummary: 'ok',
      photos: [
        { id: photo(1), url: 'https://tracker.example/pixel.gif', thumbnailUrl: 'c/co/rr/pending/x/thumb.jpg', damages: [], overallSeverity: 'none', aiSummary: 'fine', analyzedAt: 'x' },
        { id: photo(3), url: 'https://other.example/a.jpg', damages: [], overallSeverity: 'none', aiSummary: 'not this report\'s', analyzedAt: 'x' },
        { id: photo(2), damages: [], overallSeverity: 'none', aiSummary: 'also fine', analyzedAt: 'x' },
      ],
    },
    repairEstimate: { lineItems: [], subtotal: '10', total: 20, multiplierApplied: 1.65, notes: [] },
    photoLabels: { [photo(1)]: [{ id: 'l', text: 'x', position: 'center', severity: 'high' }], [photo(3)]: [{ id: 'l', text: 'y', position: 'center', severity: 'high' }] },
    crmLink: { leadId: 'someone else\'s job' },
    notAKnownKey: { x: 1 },
    ...over,
  });

  it('forces the report\'s own id and drops keys the report does not have', () => {
    const r = sanitizeReportJson(report(), REPORT, ownPhotos);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).toBe(REPORT);
    expect(r.value).not.toHaveProperty('notAKnownKey');
    expect(r.value).not.toHaveProperty('crmLink');
    expect(r.value.property.address).toBe('12 Elm Street');
  });

  it('makes every figure a number, so a page can never get a word where a number goes', () => {
    const r = sanitizeReportJson(report(), REPORT, ownPhotos);
    expect(r.ok && r.value.stormHistory.totalEvents).toBe(7);
    expect(r.ok && r.value.stormHistory.hailEvents).toBe(0);
    expect(r.ok && r.value.repairEstimate.subtotal).toBe(10);
    expect(r.ok && r.value.property.latitude).toBe(42.5);
  });

  it('keeps only this report\'s own photos, and points each at the app\'s own route, never at an outside address or the store', () => {
    const r = sanitizeReportJson(report(), REPORT, ownPhotos);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.damageAnalysis.photos.map((p: any) => p.id)).toEqual([photo(1), photo(2)]);
    for (const p of r.value.damageAnalysis.photos as any[]) {
      expect(p.url).toBe(roofReportPhotoPath(REPORT, p.id, 'working'));
      expect(p.thumbnailUrl).toBe(roofReportPhotoPath(REPORT, p.id, 'thumb'));
    }
    expect(Object.keys(r.value.photoLabels ?? {})).toEqual([photo(1)]);
    expect(JSON.stringify(r.value)).not.toMatch(/tracker\.example|other\.example|\/rr\//);
  });

  it('refuses a report that is not the shape a page needs', () => {
    expect(sanitizeReportJson({}, REPORT, ownPhotos)).toEqual({ ok: false, error: REPORT_DATA_BAD });
    expect(sanitizeReportJson(report({ stormHistory: 'x' }), REPORT, ownPhotos)).toEqual({ ok: false, error: REPORT_DATA_BAD });
    expect(sanitizeReportJson(report({ damageAnalysis: { photos: 'x' } }), REPORT, ownPhotos)).toEqual({ ok: false, error: REPORT_DATA_BAD });
    expect(sanitizeReportJson(report({ property: [] }), REPORT, ownPhotos)).toEqual({ ok: false, error: REPORT_DATA_BAD });
    expect(sanitizeReportJson(report({ repairEstimate: null }), REPORT, ownPhotos)).toEqual({ ok: false, error: REPORT_DATA_BAD });
  });
});

describe('parseListQuery', () => {
  it('reads the page, the search and the filters, and ignores anything else', () => {
    expect(parseListQuery({ page: '3', search: ' elm ', kind: 'storm', status: 'ready', company: 'x' })).toEqual({ page: 3, search: 'elm', kind: 'storm', status: 'ready' });
    expect(parseListQuery({})).toEqual({ page: 1, search: '', kind: null, status: null });
    expect(parseListQuery({ page: '-4', kind: 'nope', status: 'nope', search: ['a', 'b'] })).toEqual({ page: 1, search: '', kind: null, status: null });
    expect(parseListQuery({ page: '99999999' }).page).toBe(10000);
    expect(parseListQuery({ search: 'x'.repeat(500) }).search.length).toBe(100);
  });
});
