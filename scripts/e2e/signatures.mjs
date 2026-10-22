// The signature flow end to end against the local server — access control,
// every refusal, signing, declining, reminding, cancelling, completion, abuse.
// Same shape as api.mjs: PASS/FAIL with evidence, nothing hits a real service.
//
//   E2E_BASE=http://127.0.0.1:3999 E2E_COOKIES=/tmp/e2e/cookies.json node scripts/e2e/signatures.mjs
//
// Restart the server between back-to-back runs: the rate limiters keep their
// buckets in process, so a second run starts with an exhausted budget.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ADDRESS, JOB, JOB_EMPTY, JOB_OTHER, ensureFixtures, pool, sentRequest } from './signatures-fixtures.mjs';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3999';
const cookies = JSON.parse(fs.readFileSync(process.env.E2E_COOKIES, 'utf8'));
const results = [];
const T = (name, ok, evidence = '') => { results.push({ name, ok: !!ok, evidence: String(evidence).slice(0, 220) }); return ok; };

async function api(who, method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (who) headers.cookie = cookies[who];
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}

/** The signing pages post ordinary forms, so that they work without JavaScript. */
async function form(path, fields, headers = {}) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
    redirect: 'manual',
  });
  return { status: r.status, text: await r.text(), location: r.headers.get('location') };
}

/** A structurally valid baseline JPEG; PDF carries the bytes verbatim, nothing decodes it. */
function fakeJpeg(width = 600, height = 200, padding = 400) {
  const sof = Buffer.alloc(20);
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(17, 2); sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7); sof.writeUInt8(3, 9);
  for (let i = 0; i < 3; i++) sof.writeUInt8(i + 1, 10 + i * 3);
  const bytes = Buffer.from(Array.from({ length: padding }, (_, i) => i % 256));
  const len = Buffer.alloc(2); len.writeUInt16BE(bytes.length + 2, 0);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xfe]), len, bytes, sof, Buffer.from([0xff, 0xd9])]);
}

const signer = (over = {}) => ({ name: 'Dana Whitfield', email: 'dana@example.com', phone: '+17045550300', ...over });
const create = (who, job, body) => api(who, 'POST', `/api/clients/${job}/signature-requests`, body);
const baseCreate = (over = {}) => ({
  kind: 'certificate', ref: null, message: 'Please sign this.',
  channels: { email: true, text: true }, signers: [signer()], ...over,
});

await ensureFixtures();
const db = pool();
const q = (sql, params = []) => db.query(sql, params).then((r) => r.rows);

// ------------------------------------------------------------- access ----
{
  T('signatures: anonymous cannot list documents', (await api(null, 'GET', `/api/clients/${JOB}/signature-docs`)).status === 401);
  T('signatures: anonymous cannot list requests', (await api(null, 'GET', `/api/clients/${JOB}/signature-requests`)).status === 401);
  T('signatures: anonymous cannot send', (await create(null, JOB, baseCreate())).status === 401);
  T('signatures: anonymous cannot fetch a PDF', (await api(null, 'GET', '/api/signature-requests/1/pdf')).status === 401);

  T('signatures: a rep sees their own job', (await api('rep', 'GET', `/api/clients/${JOB}/signature-docs`)).status === 200);
  const cross = await api('rep', 'GET', `/api/clients/${JOB_OTHER}/signature-docs`);
  T("signatures: a rep cannot see another rep's job", cross.status === 404, cross.status);
  T("signatures: a rep cannot list another rep's requests", (await api('rep', 'GET', `/api/clients/${JOB_OTHER}/signature-requests`)).status === 404);
  T("signatures: a rep cannot send on another rep's job",
    (await create('rep', JOB_OTHER, baseCreate({ kind: 'report', ref: 'e2e-sig-other-report' }))).status === 404);
  T('signatures: an admin sees every job', (await api('admin', 'GET', `/api/clients/${JOB_OTHER}/signature-docs`)).status === 200);
}

// ---------------------------------------------------------- what to send ----
{
  const docs = (await api('rep', 'GET', `/api/clients/${JOB}/signature-docs`)).json;
  T('signatures: offers both finished reports', docs.options.filter((o) => o.kind === 'report').length === 2, JSON.stringify(docs.options.map((o) => o.ref)));
  T('signatures: never offers the failed report', !docs.options.some((o) => o.ref === 'e2e-sig-failed'));
  T('signatures: does not offer the certificate until somebody creates it',
    !docs.options.some((o) => o.kind === 'certificate'), docs.options.map((o) => o.kind).join(', '));
  T('signatures: prefills the customer from the lead', docs.customer.name === 'Dana Whitfield', JSON.stringify(docs.customer));
  T('signatures: prefills the sender', !!docs.me.email);
  T('signatures: assembles the property address', docs.propertyAddress.includes(ADDRESS.address) && docs.propertyAddress.includes(ADDRESS.zip), docs.propertyAddress);

  const empty = (await api('rep', 'GET', `/api/clients/${JOB_EMPTY}/signature-docs`)).json;
  T('signatures: a job with nothing finished offers nothing', empty.options.length === 0, empty.options.length);
}

// ------------------------------------------------------------- refusals ----
{
  const bad = async (name, body) => {
    const r = await create('rep', JOB, body);
    T(`signatures: refuses ${name}`, r.status === 400, `${r.status} ${r.json?.error ?? ''}`);
  };
  await bad('no signers at all', baseCreate({ signers: [] }));
  await bad('a signer with no name', baseCreate({ signers: [signer({ name: '' })] }));
  await bad('an email that is not an email', baseCreate({ signers: [signer({ email: 'dana@' })] }));
  await bad('a phone we could not text', baseCreate({ signers: [signer({ phone: '555-1234', email: '' })] }));
  await bad('a signer with no way to reach them', baseCreate({ signers: [signer({ email: '', phone: '' })] }));
  await bad('no channel chosen', baseCreate({ channels: { email: false, text: false } }));
  await bad('email-only with no email address', baseCreate({ channels: { email: true, text: false }, signers: [signer({ email: '' })] }));
  await bad('text-only with no mobile number', baseCreate({ channels: { email: false, text: true }, signers: [signer({ phone: '' })] }));
  await bad('a document kind that does not exist', baseCreate({ kind: 'invoice' }));
  await bad('a report belonging to another job', baseCreate({ kind: 'report', ref: 'e2e-sig-other-report' }));
  await bad('a report that does not exist', baseCreate({ kind: 'report', ref: 'nope' }));
  await bad('a report chosen with no id', baseCreate({ kind: 'report', ref: null }));

  const draft = await create('rep', JOB_EMPTY, baseCreate());
  T('signatures: refuses the certificate while the walkthrough is a draft',
    draft.status === 400 && /walkthrough/i.test(draft.json?.error || ''), draft.json?.error);
  const uncreated = await create('rep', JOB, baseCreate());
  T('signatures: refuses a certificate nobody has created, and says which problem it is',
    uncreated.status === 400 && /create it/i.test(uncreated.json?.error || ''), uncreated.json?.error);
}

// ------------------------------------------------ a send nobody receives ----
{
  const before = (await q(`SELECT count(*)::int AS n FROM signature_requests`))[0].n;
  // A report, not the certificate: this section is about delivery, and a
  // document that does not exist is refused long before anything is sent.
  const failed = await create('rep', JOB, baseCreate({ kind: 'report', ref: 'e2e-sig-report' }));
  T('signatures: answers 502 when nothing could be delivered', failed.status === 502, failed.status);
  T('signatures: tells the rep in plain words', /didn't go out/.test((failed.json?.errors || [])[0] || ''), (failed.json?.errors || [])[0]);
  T("signatures: never shows the rep the provider's own error", !/keyFile|api key|token/i.test((failed.json?.errors || []).join(' ')));
  T('signatures: leaves no junk draft on the board', (await q(`SELECT count(*)::int AS n FROM signature_requests`))[0].n === before);
  T('signatures: leaves no orphan signers',
    (await q(`SELECT count(*)::int AS n FROM signature_signers s LEFT JOIN signature_requests r ON r.id=s.request_id WHERE r.id IS NULL`))[0].n === 0);
  const log = (await q(`SELECT * FROM write_log WHERE action='signature_sent' ORDER BY id DESC LIMIT 1`))[0];
  T('signatures: writes the attempt to the log anyway', log && log.ok === false, log?.summary);
  T('signatures: keeps the real reason in the log', /key|refused|GoHighLevel|Gmail|invalid/i.test(log?.error || ''), log?.error);
}

// ------------------------------------------------------ the frozen copy ----
{
  const { request, signers } = await sentRequest(db);
  T('signatures: the document is fingerprinted', /^[a-f0-9]{64}$/.test(request.doc_hash));
  T('signatures: each signer gets their own token', /^[a-f0-9]{32}$/.test(signers[0].token));

  const four = await sentRequest(db, { signers: [signer(), signer({ name: 'Two' }), signer({ name: 'Three' }), signer({ name: 'Four' })] });
  T('signatures: no two signers share a token', new Set(four.signers.map((s) => s.token)).size === 4);

  // Read the report's own copy first: what gets restored afterwards has to be
  // the report's HTML, not whatever the request happens to be carrying.
  const [{ html: reportHtml }] = await q(`SELECT html FROM client_reports WHERE report_id='e2e-sig-report'`);
  const frozen = await sentRequest(db, { kind: 'report', ref: 'e2e-sig-report', title: 'Roof Replacement Proposal — Whitfield' });
  await q(`UPDATE client_reports SET html='<h1>REWRITTEN AFTER SENDING</h1>' WHERE report_id='e2e-sig-report'`);
  const after = (await q(`SELECT html FROM signature_requests WHERE id=$1`, [frozen.request.id]))[0];
  T('signatures: editing the report cannot rewrite a document already sent',
    after.html === reportHtml && !after.html.includes('REWRITTEN'));
  await q(`UPDATE client_reports SET html=$1 WHERE report_id='e2e-sig-report'`, [reportHtml]);
}

// ------------------------------------------------------- the signing page ----
const { request: liveReq, signers: live } = await sentRequest(db);
const token = live[0].token;
{
  T('signatures: an unknown token is refused', (await fetch(`${BASE}/r/s/${'0'.repeat(32)}`)).status === 404);
  T('signatures: a malformed token is refused', (await fetch(`${BASE}/r/s/not-a-real-token`)).status === 404);

  const res = await fetch(`${BASE}/r/s/${token}`);
  const page = await res.text();
  T('signatures: the signing page opens', res.status === 200);
  T('signatures: it names the document', page.includes('Certificate of Completion'));
  T('signatures: it shows the property', page.includes(ADDRESS.address));
  T('signatures: it carries the note from the rep', page.includes('Please sign this'));
  T('signatures: it asks for consent in words', page.includes('I intend to be bound by it'));
  T('signatures: it says the location is recorded', page.includes('Where you sign is recorded'));
  T('signatures: it works without JavaScript', page.includes('id="name"') && page.includes('id="padwrap" hidden'));
  T('signatures: it is not indexed', page.includes('noindex'));
  T('signatures: it is not cached', /no-store/.test(res.headers.get('cache-control') || ''));

  const v1 = (await q(`SELECT * FROM signature_signers WHERE id=$1`, [live[0].id]))[0];
  T('signatures: opening the link is recorded', v1.view_count === 1 && v1.first_viewed_at !== null, `views=${v1.view_count}`);
  await fetch(`${BASE}/r/s/${token}`);
  const v2 = (await q(`SELECT * FROM signature_signers WHERE id=$1`, [live[0].id]))[0];
  T('signatures: a second visit counts but keeps the first time', v2.view_count === 2 && +v2.first_viewed_at === +v1.first_viewed_at);

  // A malformed query string must not take the signing page down: Express has
  // already decoded it, and decoding a second time threw on a bare percent
  // sign and mangled any literal one in the message.
  const malformed = await fetch(`${BASE}/r/s/${token}?e=%`);
  T('signatures: a malformed query string does not break the signing page', malformed.status === 200, `${malformed.status}`);
  const pct = await fetch(`${BASE}/r/s/${token}?e=${encodeURIComponent('Needs 100% of the balance')}`);
  const pctHtml = await pct.text();
  T('signatures: a message with a percent sign survives intact',
    pctHtml.includes('Needs 100% of the balance'), (pctHtml.match(/Needs 100[^<]*/) || [])[0] || 'not found');

  const doc = await fetch(`${BASE}/r/s/${token}/document`);
  T('signatures: the frozen document is served on its own', doc.status === 200 && (await doc.clone().text()).includes('Certificate of Completion'));
  T('signatures: the document may only be framed by us', (doc.headers.get('content-security-policy') || '').includes("frame-ancestors 'self'"));
}

// ------------------------------------------------------------- signing ----
{
  const noConsent = await form(`/r/s/${token}`, { name: 'Dana Whitfield', kind: 'typed' });
  T('signatures: refuses a signature without the consent tick', noConsent.status === 303 && /tick the box/i.test(decodeURIComponent(noConsent.location || '')));
  const short = await form(`/r/s/${token}`, { name: 'D', affirm: 'yes', kind: 'typed' });
  T('signatures: refuses a one-letter name', short.status === 303 && /full name/i.test(decodeURIComponent(short.location || '')));
  T('signatures: neither attempt recorded anything', (await q(`SELECT signed_at FROM signature_signers WHERE id=$1`, [live[0].id]))[0].signed_at === null);

  const png = await form(`/r/s/${token}`, { name: 'Dana Whitfield', affirm: 'yes', kind: 'drawn', signature: 'data:image/png;base64,iVBORw0KGgo=' });
  T('signatures: refuses a drawn signature that is not a JPEG', png.status === 303);
  const huge = await form(`/r/s/${token}`, { name: 'Dana Whitfield', affirm: 'yes', kind: 'drawn', signature: `data:image/jpeg;base64,${'A'.repeat(500000)}` });
  T('signatures: refuses an oversized signature', huge.status === 303);

  const signed = await form(`/r/s/${token}`, {
    name: 'Dana Whitfield', affirm: 'yes', kind: 'drawn',
    signature: `data:image/jpeg;base64,${fakeJpeg().toString('base64')}`,
    lat: '35.1925', lng: '-80.8396', accuracy: '11',
  }, { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) Safari/604.1', 'x-forwarded-for': '73.15.2.9, 10.0.0.1' });
  T('signatures: signing works', signed.status === 200 && /this is signed/i.test(signed.text));

  const row = (await q(`SELECT * FROM signature_signers WHERE id=$1`, [live[0].id]))[0];
  T('signatures: the drawn signature is stored', row.signature_kind === 'drawn' && !!row.signature_image);
  T('signatures: the name is recorded', row.signed_name === 'Dana Whitfield');
  T('signatures: the client IP is taken, not the proxy', row.ip === '73.15.2.9', row.ip);
  T('signatures: the device is recorded', /iPhone/.test(row.user_agent || ''));
  T('signatures: the location is recorded as GPS', row.geo?.source === 'gps', JSON.stringify(row.geo?.source));
  T('signatures: the accuracy the browser gave is kept', row.geo?.accuracyM === 11);
  T('signatures: the coordinates were reverse geocoded', !!row.geo?.address, row.geo?.address);
  T('signatures: the distance from the property was measured', typeof row.geo?.distanceFromPropertyM === 'number', `${row.geo?.distanceFromPropertyM} m`);

  const again = await form(`/r/s/${token}`, { name: 'Someone Else', affirm: 'yes', kind: 'typed' });
  T('signatures: signing twice shows the thank-you', again.status === 200 && /this is signed/i.test(again.text));
  const unchanged = (await q(`SELECT signed_name, signed_at FROM signature_signers WHERE id=$1`, [live[0].id]))[0];
  T('signatures: the second attempt did not overwrite the first', unchanged.signed_name === 'Dana Whitfield' && +unchanged.signed_at === +row.signed_at);
  const reopened = await (await fetch(`${BASE}/r/s/${token}`)).text();
  T('signatures: re-opening shows the thank-you, not a second form', !reopened.includes('id="signform"') && /this is signed/i.test(reopened));

  const noGeo = await sentRequest(db);
  const typed = await form(`/r/s/${noGeo.signers[0].token}`, { name: 'Dana Whitfield', affirm: 'yes', kind: 'typed' },
    { 'x-vercel-ip-city': 'Charlotte', 'x-vercel-ip-country-region': 'NC' });
  T('signatures: refusing location still signs', typed.status === 200 && /this is signed/i.test(typed.text));
  const netRow = (await q(`SELECT geo, signature_kind FROM signature_signers WHERE id=$1`, [noGeo.signers[0].id]))[0];
  T('signatures: it falls back to the network location', netRow.geo?.source === 'network' && netRow.geo?.city === 'Charlotte', JSON.stringify(netRow.geo?.city));
  T('signatures: a typed signature is stored as typed', netRow.signature_kind === 'typed');

  const spoof = await sentRequest(db);
  await form(`/r/s/${spoof.signers[0].token}`, { name: 'Dana Whitfield', affirm: 'yes', kind: 'typed', lat: '900', lng: '-900', accuracy: '-5' });
  T('signatures: impossible coordinates are not stored as a position',
    (await q(`SELECT geo FROM signature_signers WHERE id=$1`, [spoof.signers[0].id]))[0].geo?.source !== 'gps');
}

// ------------------------------------------------------------ declining ----
{
  const { request, signers } = await sentRequest(db);
  const page = await fetch(`${BASE}/r/s/${signers[0].token}/decline`);
  const html = await page.text();
  T('signatures: the decline page opens', page.status === 200 && /Not signing/i.test(html) && /nothing is sent until/i.test(html));
  const declined = await form(`/r/s/${signers[0].token}/decline`, { reason: 'The address on it is wrong' });
  T('signatures: declining is accepted', declined.status === 200 && /let your rep know/i.test(declined.text));
  const row = (await q(`SELECT * FROM signature_signers WHERE id=$1`, [signers[0].id]))[0];
  T('signatures: the refusal and reason are recorded', row.declined_at !== null && row.decline_reason === 'The address on it is wrong');
  T('signatures: the whole document counts as declined', (await q(`SELECT status FROM signature_requests WHERE id=$1`, [request.id]))[0].status === 'declined');
}

// -------------------------------------------------- reminding, cancelling ----
{
  const { request, signers } = await sentRequest(db);
  T('signatures: a reminder that cannot be delivered answers 502',
    (await api('rep', 'POST', `/api/signature-requests/${request.id}/remind`, { channels: { email: true, text: true } })).status === 502);
  const row = (await q(`SELECT remind_count, reminded_at FROM signature_signers WHERE id=$1`, [signers[0].id]))[0];
  T('signatures: the reminder attempt is recorded', row.remind_count === 1 && row.reminded_at !== null);
  T("signatures: a rep cannot remind another rep's document",
    (await api('pm', 'POST', `/api/signature-requests/${request.id}/remind`, {})).status === 404);
  T("signatures: a rep cannot cancel another rep's document",
    (await api('pm', 'POST', `/api/signature-requests/${request.id}/void`, {})).status === 404);

  const voided = await api('rep', 'POST', `/api/signature-requests/${request.id}/void`, { reason: 'Price changed' });
  T('signatures: cancelling works', voided.status === 200 && voided.json.request.status === 'voided', voided.status);
  const gone = await fetch(`${BASE}/r/s/${signers[0].token}`);
  T('signatures: a cancelled link stops opening', gone.status === 410, gone.status);
  T('signatures: and says why', /cancelled/i.test(await gone.text()));
  T('signatures: a cancelled document cannot be signed',
    (await form(`/r/s/${signers[0].token}`, { name: 'Dana Whitfield', affirm: 'yes', kind: 'typed' })).status === 410);
  T('signatures: reminding a cancelled document is refused',
    (await api('rep', 'POST', `/api/signature-requests/${request.id}/remind`, {})).status === 400);
}

// -------------------------------------------------------- everyone signed ----
{
  const { request, signers } = await sentRequest(db, {
    signers: [signer(), signer({ name: 'Sam Reyes', email: 'sam@example.com', phone: '+17045550301' })],
  });
  await form(`/r/s/${signers[0].token}`, { name: 'Dana Whitfield', affirm: 'yes', kind: 'typed', lat: '35.1925', lng: '-80.8396', accuracy: '9' });
  T('signatures: one of two signed leaves it out for signature',
    (await q(`SELECT status FROM signature_requests WHERE id=$1`, [request.id]))[0].status === 'sent');

  await form(`/r/s/${signers[1].token}`, { name: 'Sam Reyes', affirm: 'yes', kind: 'drawn', signature: `data:image/jpeg;base64,${fakeJpeg(500, 160).toString('base64')}` });
  await new Promise((r) => setTimeout(r, 2000));   // completion runs after the response
  const done = (await q(`SELECT * FROM signature_requests WHERE id=$1`, [request.id]))[0];
  T('signatures: the last signature completes the document', done.status === 'signed', done.status);
  T('signatures: the completion time is recorded', done.completed_at !== null);
  T('signatures: a failed JobTread upload does not lose the signatures', done.status === 'signed' && done.jobtread_file_id === null);
  const filed = (await q(`SELECT ok, error FROM write_log WHERE action='signature_filed' ORDER BY id DESC LIMIT 1`))[0];
  T('signatures: the filing failure is written to the log', filed && filed.ok === false, filed?.error);

  const served = await (await fetch(`${BASE}/r/s/${signers[0].token}/document`)).text();
  T('signatures: the served document carries the signatures', served.includes('Signatures') && served.includes('Sam Reyes'));
  T('signatures: a drawn signature appears as an image', served.includes('data:image/jpeg;base64,'));

  const pdf = await api('rep', 'GET', `/api/signature-requests/${request.id}/pdf`);
  T('signatures: the signed PDF downloads', pdf.status === 200 && (pdf.headers.get('content-type') || '') === 'application/pdf');
  T('signatures: it is a real PDF with an audit trail', pdf.text.startsWith('%PDF-') && pdf.text.includes('Audit'));
  T("signatures: a rep cannot fetch another rep's PDF", (await api('pm', 'GET', `/api/signature-requests/${request.id}/pdf`)).status === 404);

  const list = await api('rep', 'GET', `/api/clients/${JOB}/signature-requests`);
  T('signatures: the board loads', list.status === 200 && Array.isArray(list.json.requests));
  const listed = list.json.requests.find((r) => r.id === request.id);
  T('signatures: a signed document reads as signed', listed?.status === 'signed');
  T('signatures: the signers come with it', listed?.signers.length === 2);
  T('signatures: the signing links are there for copying', listed?.signers.every((s) => (s.signUrl || '').includes('/r/s/')));
  T('signatures: the location is on the record', listed?.signers[0].geo?.source === 'gps');
  T('signatures: signature images are left out of the list', listed?.signers.every((s) => s.signatureImage === null));
  T('signatures: no other job leaks into the board', list.json.requests.every((r) => r.jobExternalId === JOB));
}

// ------------------------------------------- the certificate of completion ----
{
  // Reading must never create one — it used to, the moment anyone opened the
  // client page, so a job nobody had certified still had a certificate on it.
  await q(`DELETE FROM job_certificates WHERE job_external_id = ANY($1)`, [[JOB, JOB_EMPTY]]);
  const before = await api('rep', 'GET', `/api/clients/${JOB}/signature-docs`);
  const look = await api('rep', 'GET', `/api/clients/${JOB}/certificate`);
  T('certificate: looking at a job does not create one', look.status === 200 && look.json.certificate === null,
    JSON.stringify(look.json?.certificate));
  T('certificate: nothing was written to the table',
    (await q(`SELECT count(*)::int AS n FROM job_certificates WHERE job_external_id=$1`, [JOB]))[0].n === 0);
  T('certificate: it reports the walkthrough is in', look.json.walkthroughSubmitted === true);
  T('certificate: and offers the Create button', look.json.canCreate === true);
  T('certificate: it is not offered for signature before it exists',
    !(before.json.options || []).some((o) => o.kind === 'certificate'), 'nothing to send yet');

  // A job whose walkthrough is still a draft cannot create one at all.
  const draft = await api('rep', 'GET', `/api/clients/${JOB_EMPTY}/certificate`);
  T('certificate: a draft walkthrough offers no Create button', draft.json.canCreate === false && draft.json.walkthroughSubmitted === false);
  const refusedCreate = await api('rep', 'POST', `/api/clients/${JOB_EMPTY}/certificate`, {});
  T('certificate: creating against a draft walkthrough is refused',
    refusedCreate.status === 400 && /walkthrough/i.test(refusedCreate.json?.error || ''), refusedCreate.json?.error);
  T('certificate: and still nothing was written',
    (await q(`SELECT count(*)::int AS n FROM job_certificates WHERE job_external_id=$1`, [JOB_EMPTY]))[0].n === 0);

  // Signing or sending one that does not exist must not conjure it.
  const signGhost = await api('rep', 'POST', `/api/clients/${JOB}/certificate/sign`, { name: 'Thomas Bramhill' });
  T('certificate: signing one that does not exist is refused', signGhost.status === 400 && /create it first/i.test(signGhost.json?.error || ''), signGhost.json?.error);
  T('certificate: and that refusal created nothing',
    (await q(`SELECT count(*)::int AS n FROM job_certificates WHERE job_external_id=$1`, [JOB]))[0].n === 0);

  // The button.
  const made = await api('rep', 'POST', `/api/clients/${JOB}/certificate`, {});
  T('certificate: the Create button creates it', made.status === 200 && made.json.created === true, JSON.stringify(made.json));
  const row = (await q(`SELECT * FROM job_certificates WHERE job_external_id=$1`, [JOB]))[0];
  T('certificate: exactly one row exists', !!row);
  T('certificate: it was built from the walkthrough', row?.data?.completedOn === '2026-09-17' && /E2E Rep/.test(row?.data?.walkedBy || ''),
    `${row?.data?.completedOn} · ${row?.data?.walkedBy}`);
  T('certificate: it carries what the walkthrough left open', (row?.data?.openItems || []).length === 2,
    (row?.data?.openItems || []).map((i) => i.label).join(' | ').slice(0, 80));
  T('certificate: it records who created it', row?.created_by === 'e2e-rep@bestroofingnow.com', row?.created_by);
  T('certificate: it starts unsigned', row?.status === 'draft' && !row?.company_signer && !row?.homeowner_signer);
  T('certificate: the creation is written to the log',
    (await q(`SELECT count(*)::int AS n FROM write_log WHERE action='certificate_created' AND target_id=$1`, [JOB]))[0].n === 1);

  const again = await api('rep', 'POST', `/api/clients/${JOB}/certificate`, {});
  T('certificate: a second click is harmless', again.status === 200 && again.json.created === false);
  T('certificate: and did not make a second one',
    (await q(`SELECT count(*)::int AS n FROM job_certificates WHERE job_external_id=$1`, [JOB]))[0].n === 1);

  const after = await api('rep', 'GET', `/api/clients/${JOB}/certificate`);
  T('certificate: once it exists the Create button is gone', after.json.canCreate === false && !!after.json.certificate);
  T('certificate: it is now offered for signature',
    ((await api('rep', 'GET', `/api/clients/${JOB}/signature-docs`)).json.options || []).some((o) => o.kind === 'certificate'));
  T("certificate: another rep cannot create one on someone else's job",
    (await api('pm', 'POST', `/api/clients/${JOB}/certificate`, {})).status === 404);
}

// ---------------------------------------------------------------- abuse ----
{
  const xss = await sentRequest(db, { message: '<script>alert(1)</script>', signers: [signer({ name: '<img src=x onerror=alert(1)>' })] });
  const page = await (await fetch(`${BASE}/r/s/${xss.signers[0].token}`)).text();
  T('signatures: a scripted note is escaped, not run', !page.includes('<script>alert(1)</script>') && page.includes('&lt;script&gt;'));
  T('signatures: a scripted name is escaped', !page.includes('<img src=x onerror'));

  // One link hammered: capped, and answered with a page rather than JSON.
  const hammer = [];
  for (let i = 0; i < 16; i++) hammer.push(form(`/r/s/${'f'.repeat(32)}`, { name: 'x' }));
  const codes = (await Promise.all(hammer)).map((r) => r.status);
  T('signatures: hammering one link is capped', codes.includes(429), [...new Set(codes)].join(','));
  const limited = await form(`/r/s/${'f'.repeat(32)}`, { name: 'x' });
  T('signatures: a turned-away signer gets a page, not JSON', /<html/i.test(limited.text) && /Give it a moment/i.test(limited.text));
  T('signatures: a different link from the same connection still works',
    (await form(`/r/s/${'e'.repeat(32)}`, { name: 'x' })).status !== 429);
}

await db.end();
if (process.env.E2E_OUT) fs.writeFileSync(process.env.E2E_OUT, JSON.stringify(results, null, 2));
const passed = results.filter((r) => r.ok).length;
console.log(`signatures: PASS ${passed} FAIL ${results.length - passed} of ${results.length}`);
for (const r of results.filter((x) => !x.ok)) console.log('FAIL:', r.name, '::', r.evidence);
process.exit(results.length === passed ? 0 : 1);
