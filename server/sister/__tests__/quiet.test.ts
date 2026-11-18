/**
 * No messages of Archie's own for a company Roof Lee made, and no second lead
 * for a contact Roof Lee made (docs/archie/02-roof-lee-link.md, "No messages
 * of its own"; the agreement is `messages.quiet` under "Archie" in
 * docs/sisters/contract-v2.md in the Roof Lee repository).
 *
 * What must hold: a new lead for a Roof Lee company, however it arrives,
 * sends nobody anything; the same lead for any other company is handled as it
 * always was; a contact tagged `roofli` creates nothing; and `messages.quiet`
 * is said only while that is all true, from the same switch the features ask.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { companyBody, dropSecret, localDb, member, sisterSend, startSisterApp, useSecret, type TestMember } from './helpers';
import { OWN_MESSAGE_KEYS, isQuiet, isRoofLeeContact, ownMessageOn } from '../quiet';

vi.mock('../../seed', () => ({ seedCompany: async () => {}, seedAll: async () => {}, SEED_JOB: 'seed-company', seedVersion: () => 'test' }));
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }));

// A way to pretend one of the features was switched on for a company, to see
// what Archie then says and does. Everything else is the real module.
const pretend = vi.hoisted(() => ({ loudFor: null as string | null }));
vi.mock('../quiet', async (original) => {
  const real = await original<typeof import('../quiet')>();
  return { ...real, isQuiet: (c: any) => (pretend.loudFor && c?.id === pretend.loudFor ? false : real.isQuiet(c)) };
});

describe('the switch', () => {
  const roofLee = { roofliCompanyId: randomUUID() };
  const own = { roofliCompanyId: null };

  it('is off, for every kind of message, for a company Roof Lee made', () => {
    for (const kind of OWN_MESSAGE_KEYS) expect(ownMessageOn(roofLee, kind)).toBe(false);
    expect(isQuiet(roofLee)).toBe(true);
  });

  it('is on, as it always was, for every other company', () => {
    for (const kind of OWN_MESSAGE_KEYS) expect(ownMessageOn(own, kind)).toBe(true);
    expect(isQuiet(own)).toBe(false);
  });

  it('is off when the company is not known', () => {
    for (const kind of OWN_MESSAGE_KEYS) {
      expect(ownMessageOn(null, kind)).toBe(false);
      expect(ownMessageOn(undefined, kind)).toBe(false);
    }
  });

  it('knows a contact Roof Lee made by its tag, however the tags arrive', () => {
    expect(isRoofLeeContact({ tags: ['roofli'] })).toBe(true);
    expect(isRoofLeeContact({ tags: ['Repair', ' RoofLi '] })).toBe(true);
    expect(isRoofLeeContact({ tags: 'repair, roofli' })).toBe(true);
    expect(isRoofLeeContact({ contact: { tags: ['roofli'] } })).toBe(true);
    expect(isRoofLeeContact({ tags: ['roofline', 'not-roofli'] })).toBe(false);
    expect(isRoofLeeContact({ tags: [7, null, {}] })).toBe(false);
    expect(isRoofLeeContact({ firstName: 'roofli' })).toBe(false);
    expect(isRoofLeeContact({})).toBe(false);
    expect(isRoofLeeContact(null)).toBe(false);
  });
});

/**
 * Every file that hands a text or an email to a provider, and which kind of
 * sending it is. A file that starts sending and is not here fails this test:
 * decide which kind it is before it ships.
 *
 *   asks     nobody pressed send, so it asks maySendOwnMessage first
 *   person   a signed-in person wrote or chose this message and pressed send
 *   receipt  goes to a customer because of a document a person sent them
 *   staff    goes to the company's own people, never to a customer
 */
const SENDERS: Record<string, 'asks' | 'person' | 'receipt' | 'staff'> = {
  'server/agents/cmo-agent.ts': 'asks',
  'server/agents/cfo-agent.ts': 'asks',
  'server/routes.ts': 'person',
  'server/writes/routes.ts': 'person',
  'server/contact-actions/routes.ts': 'person',
  'server/certificates/routes.ts': 'person',
  'server/insurance-letters/routes.ts': 'person',
  'server/signatures/routes.ts': 'receipt',
  'server/auth/password-mail.ts': 'staff',
  'server/canvass/daily-reminder.ts': 'staff',
};
const SENDS = /\b(sendSms|sendGhlSms|sendGhlEmail|sendEmail|sendCompanyEmail|sendAsMailbox|sendAsMailboxWithAttachments|sendInvoiceReminder)\s*\(/;

describe('everything that sends', () => {
  const root = join(__dirname, '..', '..', '..');
  const files: string[] = [];
  (function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        // The providers themselves live in integrations; tests send nothing.
        if (name !== '__tests__' && name !== 'node_modules' && full !== join(root, 'server', 'integrations')) walk(full);
      } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
        files.push(full);
      }
    }
  })(join(root, 'server'));
  const sending = files
    .filter((f) => readFileSync(f, 'utf8').split('\n').some((line) => SENDS.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line) && !/^\s*(export\s+)?(async\s+)?function\s/.test(line)))
    .map((f) => relative(root, f).split(sep).join('/'))
    .sort();

  it('is known, each file by the kind of sending it does', () => {
    expect(sending).toEqual(Object.keys(SENDERS).sort());
  });

  it('asks first wherever nobody pressed send', () => {
    for (const [file, kind] of Object.entries(SENDERS)) {
      if (kind !== 'asks') continue;
      expect(readFileSync(join(root, file), 'utf8'), file).toMatch(/await maySendOwnMessage\(/);
    }
  });
});

describe.skipIf(!localDb)('no messages of its own', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { runAsCompany } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { CMOAgent } = await import('../../agents/cmo-agent');
  const { CFOAgent } = await import('../../agents/cfo-agent');
  const { toAgentConfig } = await import('../../agents/base-agent');
  const { GoHighLevelClient } = await import('../../integrations/gohighlevel');
  const { JobTreadClient } = await import('../../integrations/jobtread');
  const { handleGhlNewContact } = await import('../../integrations/ghl/new-contact');

  const tag = `sis-quiet-${process.pid}-${Date.now()}`;
  const companies = '/api/sister/v1/companies';
  let server: Server;
  let base = '';
  let outside: string[] = [];
  let texts: Array<{ phone: string; message: string }> = [];
  let reminders: string[] = [];

  beforeAll(async () => { ({ server, base } = await startSisterApp()); });
  afterAll(() => { server?.close(); });
  // An advisor will not start without a model key. These are not keys: no
  // model is ever called here, and any outside request is refused below.
  const MODEL_KEYS = ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY'];
  const hadKey = new Map(MODEL_KEYS.map((k) => [k, process.env[k]]));
  beforeEach(() => {
    useSecret();
    for (const k of MODEL_KEYS) process.env[k] = 'not-a-key-for-tests';
    pretend.loudFor = null;
    const real = globalThis.fetch;
    outside = []; texts = []; reminders = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: any, init?: any) => {
      const url = String(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (!url.startsWith(base)) { outside.push(url); return Promise.reject(new Error('no outside calls in tests')); }
      return real(input, init);
    });
    // The provider itself: what would have gone to a customer's phone.
    vi.spyOn(GoHighLevelClient.prototype, 'sendSms').mockImplementation(async (phone: string, message: string) => {
      texts.push({ phone, message });
      return { success: true, messageId: `msg-${texts.length}` };
    });
    vi.spyOn(JobTreadClient.prototype, 'createTask').mockImplementation(async () => ({ success: true, taskId: 't1' }) as any);
    vi.spyOn(JobTreadClient.prototype, 'getInvoices').mockImplementation(async () => ({ invoices: [{ id: 'inv-1', number: '1001', amountDue: 1200 }] }) as any);
    vi.spyOn(JobTreadClient.prototype, 'sendInvoiceReminder').mockImplementation(async (id: string) => { reminders.push(id); return { success: true }; });
  });
  afterEach(() => {
    dropSecret(); pretend.loudFor = null; vi.restoreAllMocks();
    for (const k of MODEL_KEYS) { if (hadKey.get(k) === undefined) delete process.env[k]; else process.env[k] = hadKey.get(k); }
  });

  interface Made { id: string; roofliId: string; owner: TestMember }
  async function roofLeeCompany(): Promise<Made> {
    const owner = member(tag, 'owner', 'Dana Whitfield');
    const body = companyBody(tag, { members: [owner] });
    const r = await sisterSend(base, { method: 'POST', path: companies, json: body, version: 1 });
    expect(r.status).toBe(201);
    return { id: r.body.companyId, roofliId: body.roofliCompanyId as string, owner };
  }
  /** A company Roof Lee did not make. */
  async function ownCompany(): Promise<string> {
    return (await createCompany({ slug: `${tag}-own-${randomUUID().slice(0, 8)}`, name: 'Summit Ridge Roofing' })).id;
  }
  async function advisor(companyId: string, role: 'cmo' | 'cfo') {
    const [row] = await runAsCompany(companyId, () => db.insert(schema.agents).values({
      name: role === 'cmo' ? 'Marketing' : 'Finance', role, title: role.toUpperCase(), persona: 'Test advisor', systemPrompt: 'Test.',
    } as any).returning());
    // Someone who may see every lead: this test is about sending, not about whose lead it is.
    return { ...toAgentConfig(row), viewer: { repNames: null } };
  }
  const leads = (companyId: string) => runAsCompany(companyId, () => db.select().from(schema.leads).orderBy(schema.leads.id));
  const sentLog = (companyId: string) => runAsCompany(companyId, () => db.select().from(schema.communicationLog));
  const pat = { firstName: 'Pat', lastName: 'Hollis', phone: '(319) 555-0142', email: 'pat@example.test', city: 'Cedar Falls', serviceType: 'replacement', source: 'gohighlevel' };
  const as = (m: TestMember) => ({ authUserId: m.authUserId, role: m.role });
  const write = (c: Made, method: string, path: string, json: Record<string, unknown>) =>
    sisterSend(base, { method, path: `${companies}/${c.roofliId}${path}`, json, version: 2, headers: { 'idempotency-key': randomUUID() } });

  it('sends a new lead nothing for a Roof Lee company, and still keeps the lead', async () => {
    const c = await roofLeeCompany();
    const config = await advisor(c.id, 'cmo');
    const result = await runAsCompany(c.id, () => new CMOAgent(config).handleNewLead(pat));
    expect(texts).toEqual([]);
    expect(outside).toEqual([]);
    expect(await sentLog(c.id)).toEqual([]);
    expect(await leads(c.id)).toHaveLength(1);
    expect(result.actionsTaken.join(' | ')).toMatch(/No message sent/);
    expect(result.actionsTaken.join(' | ')).not.toMatch(/SMS/);
  });

  it('handles the same lead for any other company as it always did', async () => {
    const id = await ownCompany();
    const config = await advisor(id, 'cmo');
    const result = await runAsCompany(id, () => new CMOAgent(config).handleNewLead(pat));
    expect(texts).toHaveLength(1);
    expect(texts[0].phone).toBe(pat.phone);
    expect(texts[0].message).toMatch(/^Hi Pat!/);
    expect(await sentLog(id)).toEqual([expect.objectContaining({ channel: 'sms', direction: 'outbound', status: 'sent', externalId: 'msg-1' })]);
    expect(result.actionsTaken.join(' | ')).toMatch(/SMS/);
    expect(result.actionsTaken.join(' | ')).not.toMatch(/No message sent/);
  });

  it('lets no advisor text a lead or chase a payment for a Roof Lee company', async () => {
    const c = await roofLeeCompany();
    const cmo = new CMOAgent(await advisor(c.id, 'cmo'));
    const cfo = new CFOAgent(await advisor(c.id, 'cfo'));
    const [lead] = await runAsCompany(c.id, () => db.insert(schema.leads).values({ source: 'manual', firstName: 'Pat', phone: pat.phone, status: 'new' } as any).returning());
    const tool = (agent: any, name: string) => agent.tools.get(name);
    await expect(runAsCompany(c.id, () => tool(cmo, 'send_sms_to_lead').execute({ leadId: lead.id, message: 'Hello from the advisor' })))
      .rejects.toThrow(/does not send customers messages by itself/);
    const reminder = await runAsCompany(c.id, () => tool(cfo, 'send_payment_reminder').execute({ invoiceId: 'inv-1' }));
    expect(reminder).toMatchObject({ success: false });
    expect(texts).toEqual([]);
    expect(reminders).toEqual([]);
    expect(await sentLog(c.id)).toEqual([]);

    // The same two for a company Roof Lee did not make go out as before.
    const id = await ownCompany();
    const cmo2 = new CMOAgent(await advisor(id, 'cmo'));
    const cfo2 = new CFOAgent(await advisor(id, 'cfo'));
    const [lead2] = await runAsCompany(id, () => db.insert(schema.leads).values({ source: 'manual', firstName: 'Pat', phone: pat.phone, status: 'new' } as any).returning());
    await runAsCompany(id, () => tool(cmo2, 'send_sms_to_lead').execute({ leadId: lead2.id, message: 'Hello from the advisor' }));
    expect(await runAsCompany(id, () => tool(cfo2, 'send_payment_reminder').execute({ invoiceId: 'inv-1' }))).toMatchObject({ success: true });
    expect(texts).toEqual([{ phone: pat.phone, message: 'Hello from the advisor' }]);
    expect(reminders).toEqual(['inv-1']);
  });

  it('creates nothing for a contact Roof Lee made, in any company', async () => {
    const c = await roofLeeCompany();
    await advisor(c.id, 'cmo');
    const contact = { id: 'ghl-contact-1', firstName: 'Pat', lastName: 'Hollis', phone: pat.phone, email: pat.email };
    expect(await runAsCompany(c.id, () => handleGhlNewContact({ ...contact, tags: ['roofli', 'replacement'] }))).toBe('roofli');
    expect(await leads(c.id)).toEqual([]);
    expect(texts).toEqual([]);

    const id = await ownCompany();
    await advisor(id, 'cmo');
    expect(await runAsCompany(id, () => handleGhlNewContact({ ...contact, tags: 'roofli' }))).toBe('roofli');
    expect(await leads(id)).toEqual([]);
    expect(texts).toEqual([]);
  });

  it('takes in a contact Roof Lee did not make: a lead either way, a text only outside Roof Lee', async () => {
    const contact = { id: `ghl-${randomUUID().slice(0, 8)}`, firstName: 'Pat', lastName: 'Hollis', phone: pat.phone, email: pat.email, city: 'Cedar Falls', tags: ['replacement'] };
    const c = await roofLeeCompany();
    await advisor(c.id, 'cmo');
    expect(await runAsCompany(c.id, () => handleGhlNewContact(contact))).toBe('lead');
    expect(await leads(c.id)).toEqual([expect.objectContaining({ source: 'gohighlevel', firstName: 'Pat', serviceType: 'replacement' })]);
    expect(texts).toEqual([]);

    const id = await ownCompany();
    await advisor(id, 'cmo');
    expect(await runAsCompany(id, () => handleGhlNewContact(contact))).toBe('lead');
    expect(await leads(id)).toHaveLength(1);
    expect(texts).toHaveLength(1);
  });

  it('says messages.quiet for a Roof Lee company, from the switch the features ask', async () => {
    const c = await roofLeeCompany();
    const r = await sisterSend(base, { path: `${companies}/${c.roofliId}/capabilities`, version: 2 });
    expect(r.body).toEqual({ capabilities: ['messages.quiet', 'jobs.native'] });
  });

  it('stops saying it, and takes no lead and moves no job, once one of them is on for the company', async () => {
    const c = await roofLeeCompany();
    const lead = await write(c, 'POST', '/leads', { name: 'Pat Hollis', acting: as(c.owner) });
    expect(lead.status).toBe(201);

    pretend.loudFor = c.id;
    const r = await sisterSend(base, { path: `${companies}/${c.roofliId}/capabilities`, version: 2 });
    expect(r.body.capabilities).not.toContain('messages.quiet');
    expect((await write(c, 'POST', '/leads', { name: 'Jo Later', acting: as(c.owner) })).status).toBe(409);
    expect((await write(c, 'PATCH', `/leads/${lead.body.leadId}`, { status: 'contacted', acting: as(c.owner) })).status).toBe(409);
    expect((await write(c, 'POST', `/jobs/${lead.body.leadId}/stage`, { stage: 'approved', acting: as(c.owner) })).status).toBe(409);
    expect(await leads(c.id)).toEqual([expect.objectContaining({ jobName: 'Pat Hollis', status: 'new', externalId: null })]);
    // Reading and adding a note are not held back.
    expect((await write(c, 'POST', `/leads/${lead.body.leadId}/notes`, { text: 'Called, no answer.', acting: as(c.owner) })).status).toBe(201);
    // Another company is not affected by this one.
    const d = await roofLeeCompany();
    expect((await write(d, 'POST', '/leads', { name: 'Pat Hollis', acting: as(d.owner) })).status).toBe(201);

    pretend.loudFor = null;
    expect((await write(c, 'POST', '/leads', { name: 'Jo Later', acting: as(c.owner) })).status).toBe(201);
  });
});
