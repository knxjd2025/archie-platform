/**
 * The one thing a blanked-credential run can never prove: that the link
 * actually reaches somebody.
 *
 * ⚠ This talks to PRODUCTION. It forges a session against the live app, sends
 * a REAL email, and writes and deletes rows in the live database. Everything
 * else in this folder is safe to run at any time; this is not.
 *
 * It refuses to start unless you mean it:
 *
 *   E2E_LIVE_CONFIRM=yes-send-a-real-email \
 *   E2E_LIVE_EMAIL=you@bestroofingnow.com \
 *   E2E_LIVE_SESSION_SECRET="…production secret…" \
 *   npx tsx scripts/e2e/live-check.ts
 *
 * The secret has its own variable rather than SESSION_SECRET on purpose: the
 * repo's .env is loaded here for DATABASE_URL, and it carries the LOCAL
 * secret, which would quietly satisfy a plain SESSION_SECRET check and then
 * fail to authenticate for reasons nobody would enjoy tracking down. Get the
 * production value from `npx vercel env pull` and delete that file afterwards.
 * DATABASE_URL in the repo's .env already points at the live database.
 *
 * Only ever emails E2E_LIVE_EMAIL, never texts anybody, and cancels and
 * deletes the request it creates before it exits.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../../server/db';
import { clientReports, leads, signatureRequests, signatureSigners } from '../../shared/schema';
import { createSessionStore } from '../../server/session-store';

const BASE = process.env.E2E_LIVE_BASE_URL || 'https://app.bestroofingnow.com';
const CONFIRM = 'yes-send-a-real-email';
const TO = (process.env.E2E_LIVE_EMAIL || '').trim();
const SECRET = (process.env.E2E_LIVE_SESSION_SECRET || '').trim();

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = '') => {
  console.log(`${ok ? '\x1b[32m  ✓\x1b[0m' : '\x1b[31m  ✗\x1b[0m'} ${n}${d ? `  \x1b[2m${d}\x1b[0m` : ''}`);
  ok ? pass++ : fail++;
};

function refuseUnlessDeliberate() {
  const problems: string[] = [];
  if (process.env.E2E_LIVE_CONFIRM !== CONFIRM) problems.push(`E2E_LIVE_CONFIRM must be set to "${CONFIRM}"`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(TO)) problems.push('E2E_LIVE_EMAIL must be the address to send the test to');
  if (!SECRET) problems.push('E2E_LIVE_SESSION_SECRET must be the PRODUCTION secret (npx vercel env pull)');
  if (SECRET && SECRET === (process.env.SESSION_SECRET || '').trim()) {
    problems.push('E2E_LIVE_SESSION_SECRET matches the local .env secret — production uses a different one');
  }
  if (problems.length) {
    console.error('\nThis script sends a real email from production. It will not run until you say so:\n');
    for (const p of problems) console.error(`  · ${p}`);
    console.error('');
    process.exit(1);
  }
}

async function main() {
  refuseUnlessDeliberate();
  console.log(`\n\x1b[1mP · Production\x1b[0m  \x1b[2m${BASE} → ${TO}\x1b[0m`);

  // A rate-limited signer is shown a page, and one link's cap is not another's.
  const tokenA = 'a'.repeat(32), tokenB = 'b'.repeat(32);
  let limitedBody = '';
  for (let i = 0; i < 15; i++) {
    const r = await fetch(`${BASE}/r/s/${tokenA}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=x',
    });
    if (r.status === 429) { limitedBody = await r.text(); break; }
  }
  check('hammering one link is capped', !!limitedBody);
  check('the turned-away signer gets a page, not JSON', /<html/i.test(limitedBody) && /Give it a moment/i.test(limitedBody));
  const other = await fetch(`${BASE}/r/s/${tokenB}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=x',
  });
  check('a different link from the same connection is unaffected', other.status !== 429, `got ${other.status}`);

  // A real send, to one address, with the text channel off.
  const sid = crypto.randomBytes(18).toString('hex');
  const store: any = createSessionStore();
  await new Promise<void>((res, rej) => store.set(sid, {
    cookie: { originalMaxAge: 3600000, expires: new Date(Date.now() + 3600000), httpOnly: true, path: '/', secure: true, sameSite: 'lax' },
    user: { email: TO, name: 'End-to-end check', role: 'admin' },
  }, (e: any) => (e ? rej(e) : res())));
  const sig = crypto.createHmac('sha256', SECRET).update(sid).digest('base64').replace(/=+$/, '');
  const cookie = `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;

  const call = async (m: string, p: string, b?: unknown) => {
    const r = await fetch(`${BASE}${p}`, {
      method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    const t = await r.text();
    try { return { status: r.status, json: JSON.parse(t) as any }; } catch { return { status: r.status, json: null as any }; }
  };

  const [target] = await db.select({ job: clientReports.jobExternalId, reportId: clientReports.reportId })
    .from(clientReports)
    .where(and(eq(clientReports.status, 'succeeded'), isNotNull(clientReports.html)))
    .orderBy(desc(clientReports.createdAt)).limit(1);
  if (!target) { check('a finished report exists to test with', false); process.exit(1); }
  const [lead] = await db.select({ name: leads.jobName }).from(leads).where(eq(leads.externalId, target.job));
  console.log(`  \x1b[2mjob ${target.job} — ${lead?.name ?? ''}\x1b[0m`);

  check('the forged session authenticates', (await call('GET', `/api/clients/${target.job}/signature-docs`)).status === 200);

  const sent = await call('POST', `/api/clients/${target.job}/signature-requests`, {
    kind: 'report', ref: target.reportId,
    message: 'Automated end-to-end check — this is cancelled and deleted immediately.',
    channels: { email: true, text: false },                 // never text anybody
    signers: [{ name: 'End-to-end check', email: TO, phone: '', role: 'company' }],
  });
  check('a real send works', sent.status === 200, `got ${sent.status} ${sent.json?.error ?? ''}`);

  const created = sent.json?.request;
  if (created) {
    const signer = created.signers[0];
    check('the email actually went out', !!signer.emailedAt, signer.emailedAt || '');
    check('no text was sent', !signer.textedAt);
    check('the request says whether the property was located', typeof created.propertyLocated === 'boolean', `propertyLocated=${created.propertyLocated}`);
    check('no internal error text is exposed', !(sent.json.warnings || []).some((w: string) => /key|token|keyFile/i.test(w)));
    const page = await fetch(signer.signUrl);
    check('the signing page renders', page.status === 200 && /Sign here/.test(await page.text()));

    await call('POST', `/api/signature-requests/${created.id}/void`, { reason: 'Automated end-to-end check' });
    await db.delete(signatureRequests).where(eq(signatureRequests.id, created.id));
    const gone = (await db.select().from(signatureRequests).where(eq(signatureRequests.id, created.id))).length === 0;
    const orphans = await db.select().from(signatureSigners).where(eq(signatureSigners.requestId, created.id));
    check('it cleaned up after itself', gone && orphans.length === 0);
  }

  await new Promise<void>((res) => store.destroy(sid, () => res()));
  console.log(`\n  ${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('LIVE CHECK FAILED:', e?.message || e); process.exit(1); });
