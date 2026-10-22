// Fixtures for the signature checks: their own leads, reports and walkthrough,
// so they neither depend on nor disturb what seed.mjs and api.mjs set up.
// Idempotent — each suite calls this and can be run alone or in either order.
import pg from 'pg';
import crypto from 'node:crypto';

export const JOB = 'e2e-sig-a';        // the rep's own job
export const JOB_EMPTY = 'e2e-sig-b';  // the rep's, but nothing finished on it
export const JOB_OTHER = 'e2e-sig-c';  // another rep's

export const REP = 'E2E Rep';
export const REP_EMAIL = 'e2e-rep@bestroofingnow.com';

/**
 * A real street address, deliberately. Half of this feature is the distance
 * between the signer and the roof, and a made-up address does not geocode.
 */
export const ADDRESS = { address: '1200 Queens Rd', city: 'Charlotte', state: 'NC', zip: '28207' };
/** 1200 Queens Rd, near enough for "at the property" to be true. */
export const NEARBY = { lat: 35.1922, lng: -80.8395 };

export const REPORT_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Roof Report</title>
<style>body{font:15px/1.6 system-ui;margin:0;padding:28px;color:#16233a}h1{color:#0e1f57}
.tier{border:1px solid #dde3ee;border-radius:10px;padding:14px;margin:10px 0}</style></head>
<body><h1>Roof Replacement Proposal</h1><p>${ADDRESS.address}, ${ADDRESS.city}, ${ADDRESS.state} ${ADDRESS.zip}</p>
${Array.from({ length: 12 }, (_, i) => `<div class="tier"><h3>Section ${i + 1}</h3><p>Scope, measurements and findings for section ${i + 1} of the roof, with photographs and the recommended solution.</p></div>`).join('')}
<p><b>Total: $24,500.00</b></p></body></html>`;

export const pool = () => new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const token = () => crypto.randomBytes(16).toString('hex');
export const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * A submitted walkthrough, answered the way a real one is.
 *
 * The field names are written out rather than read from
 * shared/final-walkthrough.ts — that is TypeScript, and this file is plain
 * ESM that node loads directly. They are asserted against in
 * signatures-docs.ts, so a rename over there fails loudly here rather than
 * quietly producing a certificate with nothing on it.
 */
const WALKTHROUGH_ANSWERS = {
  'Walked by': REP,
  Role: 'Project Manager',
  Date: '2026-09-17',
  'Homeowner present': 'Yes',
  'Explained the warranty, roof care and what to expect': true,
  'Walked the property with the homeowner': true,
  'Final balance': 'Insurance — awaiting depreciation / final check',
  'Homeowner concerns': 'Asked us to keep an eye on the gutter over the garage.',
  'Walkthrough signature': REP,

  // Passed, spread across four sections so the certificate tallies them.
  'Magnetic sweep — driveway, walkways, garage apron': { state: 'ok' },
  'Magnetic sweep — lawn, flower beds, mulch': { state: 'ok' },
  'Shingle scraps, wrappers, felt and cut-offs removed from the property': { state: 'ok' },
  'Dumpster hauled away; the pad under it swept and checked for marks': { state: 'ok' },
  'Driveway and concrete — no cracks, chips or dumpster marks': { state: 'ok' },
  'Ridge and hip caps straight, sealed, no exposed nails': { state: 'ok' },
  'Drip edge and valleys finished; no gaps at rakes and eaves': { state: 'ok' },

  // The two the certificate has to carry forward as still open.
  'Gutters and downspouts cleared of nails, granules and debris':
    { state: 'issue', note: 'One downspout still has granules — returning Friday.' },
  'Siding, trim, paint, windows and screens undamaged':
    { state: 'issue', note: 'Small scuff on the garage trim at the ladder point.' },
};

export async function ensureFixtures() {
  const db = pool();
  const q = (sql, params = []) => db.query(sql, params).then((r) => r.rows);

  await q(`DELETE FROM signature_requests WHERE job_external_id = ANY($1)`, [[JOB, JOB_EMPTY, JOB_OTHER]]);
  await q(`DELETE FROM client_reports WHERE job_external_id = ANY($1)`, [[JOB, JOB_EMPTY, JOB_OTHER]]);
  await q(`DELETE FROM final_walkthroughs WHERE job_external_id = ANY($1)`, [[JOB, JOB_EMPTY, JOB_OTHER]]);
  await q(`DELETE FROM leads WHERE external_id = ANY($1)`, [[JOB, JOB_EMPTY, JOB_OTHER]]);

  const lead = (externalId, first, last, rep, stage) => q(
    `INSERT INTO leads (external_id, source, first_name, last_name, email, phone, address, city, state, zip,
                        status, property_type, job_name, stage, jt_sales_rep)
     VALUES ($1,'jobtread',$2,$3,$4,$5,$6,$7,$8,$9,'qualified','residential',$10,$11,$12)`,
    [externalId, first, last, `${first.toLowerCase()}@example.com`, '+17045550300',
      ADDRESS.address, ADDRESS.city, ADDRESS.state, ADDRESS.zip, `${last} Residence`, stage, rep]);

  await lead(JOB, 'Dana', 'Whitfield', REP, 'Complete');
  await lead(JOB_EMPTY, 'Morgan', 'Ellis', REP, 'Roof Construction');
  await lead(JOB_OTHER, 'Casey', 'Nunez', 'Someone Else', 'Complete');

  const report = (job, id, type, title, html, tok) => q(
    `INSERT INTO client_reports (job_external_id, report_id, report_type, status, title, html, share_token, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [job, id, type, html ? 'succeeded' : 'failed', title, html, tok, REP_EMAIL]);

  await report(JOB, 'e2e-sig-report', 'comprehensive', 'Roof Replacement Proposal — Whitfield', REPORT_HTML, token());
  await report(JOB, 'e2e-sig-inspection', 'inspection', 'Roof Inspection — Whitfield',
    '<!doctype html><html><body><h1>Inspection</h1><p>Findings.</p></body></html>', token());
  // Neither finished nor rendered: must never be offered for signature.
  await report(JOB, 'e2e-sig-failed', 'comprehensive', 'Failed report', null, null);
  await report(JOB_OTHER, 'e2e-sig-other-report', 'comprehensive', 'Roof Replacement Proposal — Nunez', REPORT_HTML, token());

  const [member] = await q(`SELECT id FROM team_members WHERE email=$1`, [REP_EMAIL]);
  await q(
    `INSERT INTO final_walkthroughs (job_external_id, team_member_id, walked_by, answers, status, issue_count, submitted_at, created_by)
     VALUES ($1,$2,$3,$4,'submitted',2,now(),$5)`,
    [JOB, member?.id ?? null, REP, JSON.stringify(WALKTHROUGH_ANSWERS), REP_EMAIL]);
  // A draft: the certificate must not be offered for this job.
  await q(
    `INSERT INTO final_walkthroughs (job_external_id, team_member_id, walked_by, answers, status, created_by)
     VALUES ($1,$2,$3,'{}','draft',$4)`,
    [JOB_EMPTY, member?.id ?? null, REP, REP_EMAIL]);

  await db.end();
}

/**
 * A document that really is out for signature, written straight to the
 * database. The harness blanks every integration, so no send can succeed and
 * a send that reaches nobody is discarded — the state after delivery has to be
 * set up rather than produced.
 */
export async function sentRequest(db, { kind = 'certificate', ref = null, title, html, signers = [{ name: 'Dana Whitfield', email: 'dana@example.com', phone: '+17045550300' }], message = 'Please sign this.', located = true } = {}) {
  const q = (sql, params = []) => db.query(sql, params).then((r) => r.rows);
  // A report request carries the report's own rendered copy, the way the real
  // send does; anything else gets the certificate body.
  const fromReport = !html && kind === 'report' && ref
    ? (await q(`SELECT html FROM client_reports WHERE report_id=$1`, [ref]))[0]?.html
    : null;
  const body = html ?? fromReport
    ?? ('<h1>Certificate of Completion</h1><p>The roofing work at 1200 Queens Rd was completed on September 17, 2026.</p>'
      + '<ul><li>One downspout still has granules — returning Friday.</li></ul>');
  const [r] = await q(
    `INSERT INTO signature_requests
       (job_external_id, source_kind, source_ref, title, html, doc_hash, message,
        property_address, property_lat, property_lng, status, created_by, sent_at, sent_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'sent',$11, now(), $11) RETURNING *`,
    [JOB, kind, ref, title ?? 'Certificate of Completion', body, sha256(body), message,
      `${ADDRESS.address}, ${ADDRESS.city}, ${ADDRESS.state}, ${ADDRESS.zip}`,
      located ? NEARBY.lat : null, located ? NEARBY.lng : null, REP_EMAIL]);

  const rows = [];
  for (const [i, s] of signers.entries()) {
    const [row] = await q(
      `INSERT INTO signature_signers (request_id, ordinal, name, email, phone, role, token, emailed_at, texted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now()) RETURNING *`,
      [r.id, i, s.name, s.email ?? null, s.phone ?? null, s.role ?? 'customer', token()]);
    rows.push(row);
  }
  return { request: r, signers: rows };
}
