/**
 * PERMANENT. Never delete, skip or weaken this file.
 *
 * Roof Lee's exact requests, answered by Archie's own door. The Roof Lee
 * repository writes down, in docs/sisters/golden-requests.json, the request its
 * own client sends for every Archie endpoint in the agreement (built by that
 * client itself, and compared with the file by a test there). That file is
 * pasted here, byte for byte, as fixtures/roofli-golden-requests.json. It is
 * never edited by hand: when Roof Lee's file changes, it is pasted again.
 *
 * Each request is signed here the way Roof Lee signs it (the first form for
 * the three version 1 endpoints, the second for everything else), sent through
 * the real door against the real test database, and the answer is checked for
 * the status and for every field Roof Lee's parsers read. A failure is a real
 * mismatch between the two sides: fix the side the agreement says is wrong.
 *
 * The fixed ids in the file (the company and the four team members) are
 * replaced with fresh ones on every run, so the test can be run again against
 * the same database. The ids Archie hands out (JOB_ID, LEAD_ID, PHOTO_ID in the
 * file) are filled in from the answers that give them.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dropSecret, localDb, sisterSend, startSisterApp, useSecret } from './helpers';

vi.mock('../../seed', () => ({ seedCompany: async () => {}, seedAll: async () => {}, SEED_JOB: 'seed-company', seedVersion: () => 'test' }));
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

// The same way quiet.test.ts pretends that one of Archie's own messaging features
// was switched on for a company, to see what Archie then says.
const pretend = vi.hoisted(() => ({ loudFor: null as string | null }));
vi.mock('../quiet', async (original) => {
  const real = await original<typeof import('../quiet')>();
  return { ...real, isQuiet: (c: any) => (pretend.loudFor && c?.id === pretend.loudFor ? false : real.isQuiet(c)) };
});

interface Golden {
  name: string;
  version: 1 | 2;
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  idempotencyKey?: string;
  expect: { status: number | number[]; shape?: Record<string, string>; when?: string };
}

const file = JSON.parse(readFileSync(new URL('./fixtures/roofli-golden-requests.json', import.meta.url), 'utf8')) as { company: string; requests: Golden[] };

/** The kind a field must be, as the golden file names it. */
function kindOk(value: unknown, kind: string): boolean {
  if (kind === 'string') return typeof value === 'string';
  if (kind === 'nonEmptyString') return typeof value === 'string' && value.length >= 1 && value.length <= 200;
  if (kind === 'boolean') return typeof value === 'boolean';
  if (kind === 'list') return Array.isArray(value);
  if (kind.startsWith('oneOf:')) return typeof value === 'string' && kind.slice(6).split('|').includes(value);
  throw new Error(`the golden file names a kind this test does not know: ${kind}`);
}

/** Every value a path names ("jobs[].id" is the id of each item of "jobs"). */
function valuesAt(root: unknown, path: string): unknown[] {
  let at: unknown[] = [root];
  for (const part of path.split('.')) {
    const each = part.endsWith('[]');
    const key = each ? part.slice(0, -2) : part;
    at = at.flatMap((one) => {
      const next = one !== null && typeof one === 'object' ? (one as Record<string, unknown>)[key] : undefined;
      if (each) return Array.isArray(next) ? next : [];
      return [next];
    });
  }
  return at;
}

describe.skipIf(!localDb)("Roof Lee's exact requests, answered by Archie's door", async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { inArray } = await import('drizzle-orm');
  const { runAsSystem } = await import('../../tenant/context');

  const tag = `pair-${process.pid}-${Date.now()}`;
  let server: Server;
  let base = '';
  const made: string[] = [];
  /** The ids in the file, each replaced by a fresh one for this run. */
  const fresh = new Map<string, string>();
  /** What Archie handed out, to fill into the later requests. */
  const given: Record<string, string> = {};
  /** What each request in the file was answered with. */
  const answers = new Map<string, { status: number; body: any }>();

  beforeAll(async () => { ({ server, base } = await startSisterApp()); });
  afterAll(async () => {
    server?.close();
    await runAsSystem('test cleanup', async () => {
      if (made.length) await db.delete(schema.teamMembers).where(inArray(schema.teamMembers.companyId, made));
    });
  });
  beforeEach(() => useSecret());
  afterEach(() => { dropSecret(); delete process.env.SISTERS_ARCHIE_READY; pretend.loudFor = null; });

  /** The request as the file has it, with this run's ids and Archie's ids put in. */
  function prepared(entry: Golden): { path: string; json: unknown } {
    const swap = (text: string): string => {
      let out = text;
      for (const [was, now] of fresh) out = out.split(was).join(now);
      out = out.split('@golden.example.test').join(`@${tag}.example.test`);
      for (const [token, value] of Object.entries(given)) out = out.split(token).join(value);
      return out;
    };
    return { path: swap(entry.path), json: entry.body === null ? undefined : JSON.parse(swap(JSON.stringify(entry.body))) };
  }

  /** Sends one request from the file and checks the answer. */
  async function send(name: string): Promise<{ status: number; body: any }> {
    const entry = file.requests.find((one) => one.name === name);
    if (!entry) throw new Error(`the file has no request called ${name}`);
    const { path, json } = prepared(entry);
    const got = await sisterSend(base, {
      method: entry.method,
      path,
      ...(json === undefined ? {} : { json }),
      version: entry.version,
      headers: entry.idempotencyKey ? { 'idempotency-key': `${tag}-${entry.idempotencyKey}` } : {},
    });
    const allowed = Array.isArray(entry.expect.status) ? entry.expect.status : [entry.expect.status];
    expect(allowed, `${name} answered ${got.status}: ${got.text.slice(0, 200)}`).toContain(got.status);
    for (const [field, kind] of Object.entries(entry.expect.shape ?? {})) {
      const found = valuesAt(got.body, field);
      // A list's own items are checked wherever it has any; the list itself must be there.
      if (!field.includes('[]')) expect(found.length, `${name}: ${field} is missing`).toBe(1);
      for (const value of found) expect(kindOk(value, kind), `${name}: ${field} is not a ${kind} (${JSON.stringify(value)})`).toBe(true);
    }
    answers.set(name, { status: got.status, body: got.body });
    return { status: got.status, body: got.body };
  }

  it('has a request for every Archie endpoint, each with something to check', () => {
    expect(file.requests.length).toBeGreaterThanOrEqual(19);
    for (const entry of file.requests) {
      expect(entry.expect.status, entry.name).toBeDefined();
      expect(entry.version === 1 || entry.version === 2, entry.name).toBe(true);
    }
  });

  it('the company is made, its team replaced, and Archie says whether it is ready', async () => {
    // This run's ids for the company and the four people in the file.
    const text = JSON.stringify(file);
    for (const id of new Set(text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [])) fresh.set(id, randomUUID());

    const first = await send('company_made');
    made.push(first.body.companyId);
    // The same company again is brought up to date, not made twice.
    const again = await send('company_made');
    expect(again.body.companyId).toBe(first.body.companyId);
    await send('members_replaced');

    // Not ready until the owner says so, ready once he does: the same question, both answers.
    delete process.env.SISTERS_ARCHIE_READY;
    expect((await send('ready')).body.ready).toBe(false);
    process.env.SISTERS_ARCHIE_READY = 'true';
    expect((await send('ready')).body.ready).toBe(true);

    const status = await send('company_status');
    expect(status.body).toMatchObject({ companyId: first.body.companyId, status: 'active' });
    const capabilities = await send('capabilities');
    expect(capabilities.body.capabilities).toEqual(expect.arrayContaining(['messages.quiet', 'jobs.native']));
  });

  it('a lead is refused until Archie says it sends the company\'s customers nothing by itself, then made once', async () => {
    // Archie's own messaging switched on for this company: Roof Lee must not add a lead.
    pretend.loudFor = answers.get('company_made')?.body.companyId;
    await send('lead_before_quiet');
    pretend.loudFor = null;

    const lead = await send('lead_made');
    given.LEAD_ID = String(lead.body.leadId);
    given.JOB_ID = String(lead.body.leadId);
    // PHOTO_ID is any photo id: the job has none and no consent, so it is simply not found.
    given.PHOTO_ID = 'photo1';
    // The same key again is the same lead.
    const sameKey = await send('lead_made');
    expect(sameKey.body.leadId).toBe(lead.body.leadId);
  });

  it('what each person may see is Archie\'s own rule, and the fields Roof Lee reads are there', async () => {
    const owner = await send('jobs_as_owner');
    expect(owner.body.jobs.length).toBeGreaterThan(0);
    expect(owner.body.jobs.map((job: any) => job.id)).toContain(given.JOB_ID);
    const office = await send('jobs_as_office_search');
    expect(Array.isArray(office.body.jobs)).toBe(true);
    // Crew and a salesperson are asked for as themselves: Archie shows crew no leads, and a salesperson only their own.
    expect((await send('jobs_as_crew')).body.jobs).toEqual([]);
    expect((await send('jobs_as_salesperson')).body.jobs).toEqual([]);

    const one = await send('job_as_office');
    expect(one.body.job.id).toBe(given.JOB_ID);
    const forTheRun = await send('job_for_the_run');
    expect(forTheRun.body.job.photoConsent).toBe(false);
  });

  it('a lead is changed, a note added and the job moved, each once', async () => {
    await send('lead_changed');
    await send('note_added');
    const moved = await send('job_moved');
    expect(moved.body.stage).toBe('approved');
    // The photo of a job whose customer has not agreed is not found.
    await send('photo_without_consent');
  });

  it('pausing, paying again and closing change where the company stands and delete nothing', async () => {
    const before = await runAsSystem('test', () => db.select().from(schema.teamMembers).where(inArray(schema.teamMembers.companyId, made)));
    const paused = await send('company_paused');
    expect(paused.body.status).toBe('paused');
    expect((await sisterSend(base, { path: prepared(file.requests.find((one) => one.name === 'company_status')!).path, version: 2 })).body.status).toBe('paused');

    const back = await send('company_back');
    expect(back.body.companyId).toBe(answers.get('company_made')?.body.companyId);
    expect((await sisterSend(base, { path: prepared(file.requests.find((one) => one.name === 'company_status')!).path, version: 2 })).body.status).toBe('active');

    const closed = await send('company_closed');
    expect(closed.body.status).toBe('closed');
    const after = await runAsSystem('test', () => db.select().from(schema.teamMembers).where(inArray(schema.teamMembers.companyId, made)));
    expect(after.length).toBe(before.length);
  });

  it('refuses a request signed the other way, and one signed with another secret, with nothing said', async () => {
    const entry = file.requests.find((one) => one.name === 'company_status')!;
    const { path } = prepared(entry);
    const wrongForm = await sisterSend(base, { path, version: 1 });
    expect(wrongForm.status).toBe(401);
    const wrongSecret = await sisterSend(base, { path, version: 2, secret: 'not-the-pair-secret' });
    expect(wrongSecret.status).toBe(401);
    expect(wrongSecret.text).toBe('');
  });
});
