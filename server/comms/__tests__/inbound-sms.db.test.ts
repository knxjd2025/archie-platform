import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Runs only against the local e2e database — the dedupe is the unique
// provider_sid on comm_messages, so only a real insert can prove it.
//   DATABASE_URL=postgres://postgres@localhost:5432/bra_e2e npx vitest run server/comms
const onE2eDb = (process.env.DATABASE_URL ?? '').includes('bra_e2e');

describe.skipIf(!onE2eDb)('inbound SMS is recorded once (bra_e2e)', () => {
  const tag = `SMtest${Date.now()}`;
  // A number no seeded lead could have.
  const phoneDigits = `555${String(Date.now()).slice(-7)}`;
  let sms: typeof import('../inbound-sms');
  let db: typeof import('../../db').db;
  let schema: typeof import('../../../shared/schema');
  let orm: typeof import('drizzle-orm');
  let leadId: number | null = null;

  beforeAll(async () => {
    sms = await import('../inbound-sms');
    ({ db } = await import('../../db'));
    schema = await import('../../../shared/schema');
    orm = await import('drizzle-orm');
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.commMessages).where(orm.like(schema.commMessages.providerSid, `${tag}%`));
    if (leadId) await db.delete(schema.leads).where(orm.eq(schema.leads.id, leadId));
  });

  it('a retried delivery of the same MessageSid inserts nothing the second time', async () => {
    const payload = { MessageSid: `${tag}-a`, From: `+1${phoneDigits}`, To: '+17043683951', Body: 'is my roof done?' };
    const first = await sms.claimInboundSms(payload);
    const retry = await sms.claimInboundSms(payload);
    expect(first).toEqual(expect.any(Number));
    expect(retry).toBeNull();

    const rows = await db.select().from(schema.commMessages).where(orm.eq(schema.commMessages.providerSid, `${tag}-a`));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'twilio', direction: 'inbound', channel: 'sms', fromAddr: `+1${phoneDigits}`, body: 'is my roof done?' });
  });

  it('finds the lead whose phone was typed with punctuation', async () => {
    const formatted = `(${phoneDigits.slice(0, 3)}) ${phoneDigits.slice(3, 6)}-${phoneDigits.slice(6)}`;
    const [lead] = await db.insert(schema.leads).values({ firstName: 'Dedupe', phone: formatted, source: 'test', status: 'new' })
      .returning({ id: schema.leads.id });
    leadId = lead.id;

    const found = await sms.findLeadByPhone(`+1${phoneDigits}`);
    expect(found?.id).toBe(lead.id);

    const id = await sms.claimInboundSms({ MessageSid: `${tag}-b`, From: `+1${phoneDigits}`, To: '+17043683951', Body: 'hi' });
    await sms.linkInboundSms(id!, found!);
    const [row] = await db.select().from(schema.commMessages).where(orm.eq(schema.commMessages.id, id!));
    expect(row.leadId).toBe(lead.id);
  });
});
