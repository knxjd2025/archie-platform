/**
 * Hit every registered API route and report what it does.
 *
 * The app had no route-level coverage, so "is every endpoint working?" could
 * only be answered by reading 271 route registrations and hoping. This drives
 * them instead, against the throwaway e2e database, and answers two questions:
 *
 *   1. Is it guarded? Every route is called with no session. Anything that
 *      answers 200 is either deliberately public or a hole, and the list of
 *      deliberately-public routes is written down here rather than inferred.
 *   2. Does it work? Every GET is called as an admin. A 500 is a bug; a 4xx
 *      with a sensible body is a route doing its job.
 *
 * Mutations are NOT called with a session. Driving 99 POSTs would write junk,
 * fire webhooks and spend credits; they are still called unauthenticated,
 * which is the half that matters for the guard question. They are reported as
 * "guard checked, behaviour not exercised" rather than quietly counted as
 * passing.
 *
 *   node scripts/api-audit/sweep.mjs            # needs the e2e server running
 */
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.SWEEP_BASE || 'http://127.0.0.1:3999';
const COOKIES = JSON.parse(readFileSync(process.env.SWEEP_COOKIES || '/tmp/e2e/cookies.json', 'utf8'));
const ROUTES = JSON.parse(readFileSync(process.env.SWEEP_ROUTES || '/tmp/e2e/routes.json', 'utf8'));

/**
 * Routes that answer without a session on purpose. Each one is a deliberate
 * decision someone made, so each is named here with the reason — an endpoint
 * that becomes public by accident then shows up as a new finding rather than
 * blending in.
 */
const PUBLIC_BY_DESIGN = new Map([
  ['GET /api/auth/me', 'reports who you are; answers "nobody" when signed out'],
  ['GET /api/auth/login/google', 'starts sign-in'],
  ['GET /api/auth/login/google/callback', 'finishes sign-in'],
  ['POST /api/auth/logout', 'ending a session you may not have is harmless'],
  ['GET /api/auth/quickbooks', 'OAuth entry'],
  ['GET /api/auth/quickbooks/callback', 'OAuth return'],
  ['GET /r/:token', 'customer share link — the token is the capability'],
  ['POST /r/:token/track', 'engagement beacon from that page'],
  ['GET /r/sign/:token', 'homeowner certificate signing page'],
  ['POST /r/sign/:token', 'homeowner signature'],
  ['POST /api/webhooks/gohighlevel', 'provider webhook, shared-secret gated'],
  ['POST /api/webhooks/jobtread', 'provider webhook, shared-secret gated'],
  ['POST /api/webhooks/twilio', 'provider webhook, signature gated'],
  ['GET /api/cron/brain-sweep', 'cron, CRON_SECRET gated'],
  ['GET /api/cron/brain-digest', 'cron, CRON_SECRET gated'],
  ['GET /api/cron/inbox-watch', 'cron, CRON_SECRET gated'],
  ['GET /api/cron/outreach-campaigns', 'cron, CRON_SECRET gated'],
  ['GET /api/cron/outreach-send', 'cron, CRON_SECRET gated'],
  ['GET /api/sync/cron', 'cron, CRON_SECRET gated'],
  ['GET /api/sync/rooflink/cron', 'cron, CRON_SECRET gated'],
  ['GET /api/agent-chats/cron', 'cron, CRON_SECRET gated'],
  ['GET /api/ping', 'liveness'],
  ['GET /api/health', 'liveness + database reachability, for an uptime monitor; says nothing about integrations'],
  ['GET /api/projects-map', 'the Our Work map every customer report embeds — public data, rate-limited'],
]);

/** Stand-ins for path parameters, using what the e2e seed created. */
const PARAMS = {
  externalId: 'e2e-res-1',
  id: '1',
  token: 'not-a-real-token',
  contactId: 'x',
  conversationId: 'x',
  documentId: 'x',
  jobId: 'e2e-res-1',
  reportId: 'x',
  key: 'probe.key',
  role: 'cfo',
  threadId: 'x',
  handle: 'x',
};

const fill = (path) => path.replace(/:([A-Za-z]+)/g, (_, name) => PARAMS[name] ?? 'x');

async function call(method, path, cookie) {
  const url = `${BASE}${fill(path)}`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: method.toUpperCase(),
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(method === 'get' || method === 'delete' ? {} : { body: '{}' }),
      redirect: 'manual',
    });
    const text = await res.text();
    // A path Express doesn't know falls through to the SPA fallback, which
    // answers 200 with index.html. That is "no such route", not "a public
    // endpoint" — counting it as the latter is how a sweep invents 28
    // security holes that do not exist.
    const isSpa = res.headers.get('content-type')?.includes('text/html') && /<div id="root"|<!doctype html/i.test(text);
    return { status: isSpa ? 404 : res.status, spa: !!isSpa, ms: Date.now() - started, body: text.slice(0, 160) };
  } catch (e) {
    return { status: 0, spa: false, ms: Date.now() - started, body: String(e?.message || e) };
  }
}

const results = [];
for (const r of ROUTES) {
  const key = `${r.method.toUpperCase()} ${r.path}`;
  const anon = await call(r.method, r.path, null);

  // A route that answers 2xx/3xx with no session is public. Intentional for a
  // named few; a finding for anything else.
  const publicReason = PUBLIC_BY_DESIGN.get(key);
  const answersAnon = anon.status >= 200 && anon.status < 400;
  const guardVerdict = answersAnon
    ? (publicReason ? 'public-by-design' : 'UNGUARDED')
    : anon.status === 0 ? 'NO-RESPONSE' : 'guarded';

  let admin = null;
  if (r.method === 'get') {
    admin = await call(r.method, r.path, COOKIES.admin);
  }

  results.push({
    method: r.method.toUpperCase(),
    path: r.path,
    file: `${r.file}:${r.line}`,
    guards: r.guards,
    anonStatus: anon.status,
    guardVerdict,
    publicReason: publicReason ?? null,
    adminStatus: admin?.status ?? null,
    adminMs: admin?.ms ?? null,
    adminBody: admin && admin.status >= 500 ? admin.body : undefined,
    adminSpa: admin?.spa ?? null,
    exercised: r.method === 'get' ? 'guard + behaviour' : 'guard only',
  });
}

const out = process.env.SWEEP_OUT || '/tmp/e2e/sweep.json';
writeFileSync(out, JSON.stringify(results, null, 2));

const unguarded = results.filter((r) => r.guardVerdict === 'UNGUARDED');
const noResponse = results.filter((r) => r.guardVerdict === 'NO-RESPONSE');
// 500 means "we broke". 502/503 mean "something we depend on is unavailable",
// which is the correct answer when the sweep runs with every integration key
// blanked — lumping them together turns working error handling into a finding.
const serverErrors = results.filter((r) => r.adminStatus === 500);
const unavailable = results.filter((r) => r.adminStatus === 502 || r.adminStatus === 503);
const slow = results.filter((r) => (r.adminMs ?? 0) > 3000);

console.log(`swept ${results.length} routes → ${out}`);
console.log(`  guarded:            ${results.filter((r) => r.guardVerdict === 'guarded').length}`);
console.log(`  public by design:   ${results.filter((r) => r.guardVerdict === 'public-by-design').length}`);
console.log(`  UNGUARDED:          ${unguarded.length}`);
console.log(`  no response:        ${noResponse.length}`);
console.log(`  500 as admin:       ${serverErrors.length}`);
console.log(`  502/503 as admin:   ${unavailable.length}  (integration keys are blanked here — this is the right answer)`);
console.log(`  slower than 3s:     ${slow.length}`);

for (const r of unguarded) console.log(`  UNGUARDED  ${r.method} ${r.path}  → ${r.anonStatus}  (${r.file})`);
for (const r of serverErrors) console.log(`  500        ${r.method} ${r.path}  ${r.adminBody}`);
for (const r of unavailable) console.log(`  ${r.adminStatus}        ${r.method} ${r.path}  ${r.adminBody ?? ''}`);
for (const r of slow) console.log(`  SLOW ${r.adminMs}ms  ${r.method} ${r.path}`);
