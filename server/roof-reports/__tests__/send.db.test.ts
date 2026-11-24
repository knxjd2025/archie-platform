/**
 * Emailing a report (D5), through a real request path on the local test database
 * with a FAKE sender: no email is ever sent.
 *
 * Only a person's click sends. The email is short, plain, carries the report's
 * share link (making one when none is on, through the same code as "Copy link")
 * and never the report or its photos. The address is checked, never logged, and
 * never put in a record of a failure. A count changes only after the sender hands
 * back an id. A double click sends once. A report and a company have a daily
 * limit that holds when the requests arrive together. Crew are refused, a
 * salesperson may send only a report they may see, and another company's report
 * is simply not there.
 * Fictional companies: Summit Ridge Roofing and Cedar Falls Roofing Two.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeReport } from '../../lib/roof-reports/__tests__/fixtures/report';
import type { CompanyEmail } from '../../integrations/company-mail';
import {
  BAD_EMAIL, SEND_COMPANY_CAPPED, SEND_FAILED, SEND_KEY_REUSED, SEND_NOT_READY, SEND_NOT_SET_UP, SEND_REPORT_CAPPED, SEND_TOO_FAST, BAD_REQUEST_KEY,
} from '../../../shared/roof-reports';
import { localDb, startRoofApp, type Co } from './harness';

vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

describe.skipIf(!localDb)('emailing a report (database, fake sender)', async () => {
  const tag = `rrsend-${process.pid}-${Date.now()}`;
  const { registerRoofReportsRoutes } = await import('../routes');
  const { __resetRateLimits } = await import('../../lib/rate-limit');
  const { GhlNotConnectedError } = await import('../../integrations/ghl/connection');

  const sent: CompanyEmail[] = [];
  let behaviour: 'ok' | 'throw' | 'no-id' | 'not-connected' | 'slow' = 'ok';
  const mail = async (msg: CompanyEmail) => {
    if (behaviour === 'slow') await new Promise((r) => setTimeout(r, 150));
    if (behaviour === 'throw') throw new Error(`The provider said no to ${msg.to}`);
    if (behaviour === 'not-connected') throw new GhlNotConnectedError();
    if (behaviour === 'no-id') return { via: 'ghl' as const, messageId: '' };
    sent.push(msg);
    return { via: 'ghl' as const, messageId: `msg-${sent.length}` };
  };
  let caps = { perReport: 5, perCompany: 100 };
  const h = await startRoofApp(tag, (app) => registerRoofReportsRoutes(app, { mail, sendCaps: () => caps }));
  const { db, schema, runAsCompany } = h;
  const savedSwitch = process.env.ARCHIE_ROOF_REPORTS;
  const savedBase = process.env.APP_BASE_URL;
  const TO = 'jordan.hale@example.com';
  const SUMMARY = 'ZZ-SUMMARY-MUST-NOT-TRAVEL';
  let a: Co; let b: Co;
  let key = 0;
  const nextKey = () => `send-${tag}-${++key}`.padEnd(12, 'x');
  const sendBody = (over: Record<string, unknown> = {}) => ({ email: TO, customerName: 'Jordan Hale', message: 'Thank you for your time.', ...over });
  const post = (id: string, body: unknown, k: string | null = nextKey()) => h.send('POST', `/api/roof-reports/${id}/send`, body, k ? { headers: { 'idempotency-key': k } } : {});

  async function makeRow(co: Co, who: string | null, over: Record<string, unknown> = {}): Promise<string> {
    const [r] = await runAsCompany(co.id, () => db.insert(schema.roofReports).values({
      address: '12 Elm Street', city: 'Cedar Falls', state: 'IA', reportTypes: ['inspection'], status: 'ready', title: 'Roof report, 12 Elm Street',
      createdByMemberId: who ? co.people[who].id : null, customerName: 'Jordan Hale', customerEmail: TO,
      reportJson: makeReport({ id: 'send-report', executiveSummary: SUMMARY }), ...over,
    } as any).returning());
    return r.id;
  }
  const rowOf = (co: Co, id: string) => runAsCompany(co.id, async () => (await db.select().from(schema.roofReports).where(eq(schema.roofReports.id, id)))[0]);
  const liveSends = (co: Co) => runAsCompany(co.id, async () => (await db.select().from(schema.roofReportUses)).filter((u) => u.kind === 'send' && (u.status === 'reserved' || u.status === 'done')).length);
  const usesOf = (co: Co, id: string) => runAsCompany(co.id, async () => db.select().from(schema.roofReportUses).where(eq(schema.roofReportUses.reportId, id)));

  let logs: string[] = [];
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];

  beforeAll(async () => {
    process.env.ARCHIE_ROOF_REPORTS = 'on';
    process.env.APP_BASE_URL = 'https://app.example.test';
    a = await h.company('Summit Ridge Roofing', [['admin', 'admin'], ['csr', 'customer_service'], ['repa', 'sales'], ['repb', 'sales'], ['crew', 'production']]);
    b = await h.company('Cedar Falls Roofing Two', [['admin', 'admin']]);
  });
  beforeEach(() => {
    __resetRateLimits(); sent.length = 0; behaviour = 'ok'; caps = { perReport: 5, perCompany: 100 }; logs = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) spies.push(vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { logs.push(args.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : String(x))).join(' ')); }));
    h.as(a, 'admin');
  });
  afterEach(() => { for (const s of spies.splice(0)) s.mockRestore(); });
  afterAll(async () => {
    if (savedSwitch === undefined) delete process.env.ARCHIE_ROOF_REPORTS; else process.env.ARCHIE_ROOF_REPORTS = savedSwitch;
    if (savedBase === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = savedBase;
    await h.close();
  });

  it('sends one short email with the share link, from the person who pressed the button, and says so', async () => {
    const id = await makeRow(a, 'repa');
    h.as(a, 'repa');
    const res = await post(id, sendBody());
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ status: 'sent' });
    expect(sent).toHaveLength(1);
    const m = sent[0];
    expect(m.to).toBe(TO);
    expect(m.toName).toBe('Jordan Hale');
    expect(m.from).toBe(a.people.repa.email);
    expect(m.subject).toBe('Your roof report from Summit Ridge Roofing');
    expect(m.subject).not.toMatch(/[\r\n]/);
    const token = (await rowOf(a, id)).shareToken!;
    expect(m.html).toContain(`href="https://app.example.test/r/roof/${token}"`);
    expect(m.html).toContain('Thank you for your time.');
    expect(m.attachments ?? []).toHaveLength(0);
    expect(m.cc).toBeUndefined();
  });

  it('never carries the report or a photo, and never an em dash', async () => {
    const id = await makeRow(a, 'repa');
    await post(id, sendBody());
    const { html, subject } = sent[0];
    expect(html).not.toContain(SUMMARY);
    expect(html).not.toMatch(/<img|<iframe|photos\/|<script/i);
    expect(`${subject}${html}`).not.toContain('—');
    expect(html.length).toBeLessThan(3000);
  });

  it('makes a link when none is on, and uses the one that is on when there is one (the same code as Copy link)', async () => {
    const id = await makeRow(a, 'repa', { shareToken: null });
    const first = await post(id, sendBody());
    expect(first.status).toBe(200);
    const token = (await rowOf(a, id)).shareToken!;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    // "Copy link" afterwards gives the very same address.
    const copy = await h.post(`/api/roof-reports/${id}/share-link`);
    expect(copy.body.url).toBe(`https://app.example.test/r/roof/${token}`);
    // A second email uses the link that is there, and does not replace it.
    await post(id, sendBody());
    expect((await rowOf(a, id)).shareToken).toBe(token);
    expect(sent.map((m) => m.html.includes(token))).toEqual([true, true]);
    // The link opens the report, with no sign-in.
    h.signedOut();
    expect((await h.get(`/r/roof/${token}`)).status).toBe(200);
  });

  it('counts a send only after the sender hands back an id', async () => {
    const id = await makeRow(a, 'repa');
    expect((await rowOf(a, id)).emailSentCount).toBe(0);
    for (const b of ['throw', 'no-id'] as const) {
      behaviour = b;
      const res = await post(id, sendBody());
      expect(res.status, b).toBe(502);
      expect(res.body).toEqual({ error: SEND_FAILED });
      const row = await rowOf(a, id);
      expect(row.emailSentCount, b).toBe(0);
      expect(row.emailSentAt, b).toBeNull();
    }
    behaviour = 'ok';
    expect((await post(id, sendBody())).status).toBe(200);
    const row = await rowOf(a, id);
    expect(row.emailSentCount).toBe(1);
    expect(row.emailSentAt).toBeInstanceOf(Date);
    expect(Date.now() - row.emailSentAt!.getTime()).toBeLessThan(60_000);
  });

  it('gives a failed send its slot back, so a failure does not use up the day', async () => {
    const id = await makeRow(a, 'repa');
    caps = { perReport: 1, perCompany: 100 };
    behaviour = 'throw';
    expect((await post(id, sendBody())).status).toBe(502);
    behaviour = 'ok';
    expect((await post(id, sendBody())).status).toBe(200);
    expect((await post(id, sendBody())).status).toBe(429);
  });

  it('tells a company whose email is not connected so, in plain words', async () => {
    const id = await makeRow(a, 'repa');
    behaviour = 'not-connected';
    const res = await post(id, sendBody());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: SEND_NOT_SET_UP });
    expect((await rowOf(a, id)).emailSentCount).toBe(0);
  });

  it('never logs the address, and never puts it in a failure, a record or an answer', async () => {
    const id = await makeRow(a, 'repa');
    for (const b of ['ok', 'throw', 'no-id', 'not-connected'] as const) {
      behaviour = b;
      const res = await post(id, sendBody());
      expect(res.text, b).not.toContain(TO);
      expect(res.text, b).not.toContain('jordan');
      expect(res.text, b).not.toMatch(/node_modules|\bat \w+ \(/);
    }
    expect(await post(id, sendBody({ email: 'not an address jordan.hale@' }))).toMatchObject({ status: 400 });
    expect(logs.join('\n')).not.toMatch(/jordan\.hale|example\.com/i);
    const writes = await runAsCompany(a.id, () => db.select().from(schema.writeLog));
    for (const w of writes) expect(JSON.stringify(w)).not.toMatch(/jordan\.hale/i);
    for (const u of await usesOf(a, id)) expect(JSON.stringify(u)).not.toMatch(/jordan\.hale/i);
    expect(JSON.stringify(await rowOf(a, id)).match(/jordan\.hale/g)?.length ?? 0).toBe(1); // only the customer's own saved address, as before
  });

  it('sends once when the same request arrives twice at the same moment (a double click)', async () => {
    const id = await makeRow(a, 'repa');
    h.as(a, 'repa');
    behaviour = 'slow';
    const k = nextKey();
    const [one, two] = await Promise.all([post(id, sendBody(), k), post(id, sendBody(), k)]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect(sent).toHaveLength(1);
    expect((await rowOf(a, id)).emailSentCount).toBe(1);
    expect(await usesOf(a, id)).toHaveLength(1);
    const statuses = [one.body.status, two.body.status].sort();
    expect(statuses).toContain('sent');
    expect(['sending', 'sent']).toContain(statuses[1]);
    // And once it is done, the same request again is still one email.
    const again = await post(id, sendBody(), k);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('sent');
    expect(sent).toHaveLength(1);
    expect((await rowOf(a, id)).emailSentCount).toBe(1);
  });

  it('refuses the same key asking for something else, and a missing or unusable key, and sends nothing', async () => {
    const id = await makeRow(a, 'repa');
    const k = nextKey();
    expect((await post(id, sendBody(), k)).status).toBe(200);
    const other = await post(id, sendBody({ email: 'someone.else@example.com' }), k);
    expect(other.status).toBe(409);
    expect(other.body).toEqual({ error: SEND_KEY_REUSED });
    for (const bad of [null, 'short', 'has space in it', 'x'.repeat(201)]) {
      const res = await post(id, sendBody(), bad);
      expect(res.status, String(bad)).toBe(400);
      expect(res.body).toEqual({ error: BAD_REQUEST_KEY });
    }
    expect(sent).toHaveLength(1);
  });

  it('refuses a bad address, a name or a message that cannot be used, sending nothing and using nothing up', async () => {
    const id = await makeRow(a, 'repa');
    for (const body of [sendBody({ email: 'nope' }), sendBody({ email: `${TO}\r\nBcc: x@example.com` }), sendBody({ email: `${TO}, x@example.com` }), sendBody({ customerName: 'Jo\r\nBcc: x@example.com' }), sendBody({ message: 'x'.repeat(1001) }), { ...sendBody(), from: 'boss@example.com' }, {}]) {
      const res = await post(id, body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(res.text).not.toContain(TO);
    }
    expect(await post(id, sendBody({ email: 'nope' }))).toMatchObject({ body: { error: BAD_EMAIL } });
    expect(sent).toHaveLength(0);
    expect(await usesOf(a, id)).toHaveLength(0);
  });

  it('escapes the personal message wherever it lands, and keeps it plain text', async () => {
    const id = await makeRow(a, 'repa');
    await post(id, sendBody({ message: '<img src=x onerror=alert(1)>\n<script>alert(2)</script>' }));
    const { html } = sent[0];
    expect(html).not.toMatch(/<img|<script/i);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;<br>&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  it('holds the daily limit for one report, even when the requests arrive together', async () => {
    const id = await makeRow(a, 'repa');
    caps = { perReport: 3, perCompany: 100 };
    h.as(a, 'repa');
    const answers = await Promise.all(Array.from({ length: 8 }, () => post(id, sendBody())));
    expect(answers.filter((r) => r.status === 200)).toHaveLength(3);
    const refused = answers.filter((r) => r.status === 429);
    expect(refused).toHaveLength(5);
    for (const r of refused) expect(r.body).toEqual({ error: SEND_REPORT_CAPPED });
    expect(sent).toHaveLength(3);
    expect((await rowOf(a, id)).emailSentCount).toBe(3);
  });

  it('holds the daily limit for a whole company, across reports, even when the requests arrive together', async () => {
    const ids = [await makeRow(a, 'repa'), await makeRow(a, 'repa'), await makeRow(a, 'repa')];
    caps = { perReport: 5, perCompany: (await liveSends(a)) + 4 };
    h.as(a, 'repa');
    const answers = await Promise.all(Array.from({ length: 9 }, (_, i) => post(ids[i % 3], sendBody())));
    expect(answers.filter((r) => r.status === 200)).toHaveLength(4);
    for (const r of answers.filter((x) => x.status === 429)) expect(r.body).toEqual({ error: SEND_COMPANY_CAPPED });
    expect(sent).toHaveLength(4);
  });

  it('counts the cap for a company from that company\'s own sends only', async () => {
    const idB = await makeRow(b, null);
    h.as(b, 'admin');
    caps = { perReport: 1, perCompany: 1 };
    expect((await post(idB, sendBody())).status).toBe(200);
    expect((await post(idB, sendBody())).status).toBe(429);
    // Company A is not held up by company B's day.
    const idA = await makeRow(a, 'repa');
    h.as(a, 'repa');
    caps = { perReport: 1, perCompany: (await liveSends(a)) + 1 };
    expect((await post(idA, sendBody())).status).toBe(200);
  });

  it('lets only a person who may see the report send it', async () => {
    const mine = await makeRow(a, 'repa', { jobExternalId: null });
    const theirs = await makeRow(a, 'repb', { jobExternalId: null });
    h.as(a, 'repa');
    expect((await post(mine, sendBody())).status).toBe(200);
    expect((await post(theirs, sendBody())).status).toBe(404);
    h.as(a, 'repb');
    expect((await post(mine, sendBody())).status).toBe(404);
    h.as(a, 'crew');
    expect((await post(mine, sendBody())).status).toBe(404);
    h.as(a, 'csr');
    expect((await post(mine, sendBody())).status).toBe(200);
    h.as(a, 'admin');
    expect((await post(theirs, sendBody())).status).toBe(200);
    expect(sent).toHaveLength(3);
    expect((await rowOf(a, theirs)).emailSentCount).toBe(1);
  });

  it('answers another company\'s person "not found" and sends and changes nothing', async () => {
    const id = await makeRow(a, 'repa');
    h.as(b, 'admin');
    const res = await post(id, sendBody());
    expect(res.status).toBe(404);
    expect(res.text).not.toContain(TO);
    expect(sent).toHaveLength(0);
    expect((await rowOf(a, id)).emailSentCount).toBe(0);
    expect(await usesOf(a, id)).toHaveLength(0);
  });

  it('does not send a report that is not finished, is archived, or is not there', async () => {
    const making = await makeRow(a, 'repa', { status: 'generating', reportJson: null });
    const failed = await makeRow(a, 'repa', { status: 'failed', reportJson: null });
    const archived = await makeRow(a, 'repa', { status: 'archived' });
    for (const id of [making, failed]) {
      const res = await post(id, sendBody());
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: SEND_NOT_READY });
    }
    expect((await post(archived, sendBody())).status).toBe(404);
    expect((await post('00000000-0000-4000-8000-00000000dead', sendBody())).status).toBe(404);
    expect((await post('not-an-id', sendBody())).status).toBe(404);
    expect(sent).toHaveLength(0);
  });

  it('sends nothing by itself: making, opening, editing, linking and archiving a report never email', async () => {
    const id = await makeRow(a, 'repa');
    h.as(a, 'repa');
    await h.get(`/api/roof-reports/${id}`);
    await h.get(`/api/roof-reports/${id}/html`);
    await h.put(`/api/roof-reports/${id}`, { customerEmail: 'new.address@example.com', title: 'Changed' });
    await h.post(`/api/roof-reports/${id}/share-link`);
    await h.send('DELETE', `/api/roof-reports/${id}/share-link`);
    await h.post(`/api/roof-reports/${id}/archive`);
    expect(sent).toHaveLength(0);
    expect((await rowOf(a, id)).emailSentCount).toBe(0);
    expect(await usesOf(a, id)).toHaveLength(0);
  });

  it('is a bare 404 while the switch is off', async () => {
    const id = await makeRow(a, 'repa');
    process.env.ARCHIE_ROOF_REPORTS = 'off';
    try {
      const res = await post(id, sendBody());
      expect(res.status).toBe(404);
      expect(res.text).toBe('');
    } finally { process.env.ARCHIE_ROOF_REPORTS = 'on'; }
    expect(sent).toHaveLength(0);
  });

  it('slows a person who sends too many too fast, with a plain sentence and nothing sent', async () => {
    const id = await makeRow(a, 'repa');
    caps = { perReport: 1000, perCompany: 1000 };
    h.as(a, 'repa');
    const answers = [];
    for (let i = 0; i < 24; i++) answers.push(await post(id, sendBody()));
    const slowed = answers.filter((r) => r.status === 429);
    expect(slowed.length).toBeGreaterThan(0);
    for (const r of slowed) expect(r.body).toEqual({ error: SEND_TOO_FAST });
    expect(sent.length).toBeLessThan(24);
  });
});
