/**
 * Migration 0021 and the metered call, against the real local test database
 * as the app's own role. Every paid model call writes one cost row for the
 * company that caused it; the call never fails because of the row.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';

// A role whose provider is outside the United States, to prove the refusal.
vi.mock('../../lib/roof-reports/models.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/roof-reports/models.js')>();
  return { ...real, ROOF_REPORT_MODELS: { ...real.ROOF_REPORT_MODELS, rogue: { provider: 'siliconflow', id: 'some-rogue-model' } } };
});

const url = process.env.DATABASE_URL || '';
const local = process.env.ARCHIE_REHEARSAL === '1' || /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
const sqlState = (p: Promise<unknown>): Promise<string | null> => p.then(() => null, (e) => e?.cause?.code ?? e?.code ?? 'no-code');

describe.skipIf(!local)('the metered model call', async () => {
  const { db } = await import('../../db');
  const schema = await import('../../../shared/schema');
  const { runAsCompany } = await import('../../tenant/context');
  const { createCompany } = await import('../../tenant/companies');
  const { meteredModelCall, meteredModelCaller, NotUsProviderError } = await import('../metered');
  const { ModelCallError } = await import('../../lib/roof-reports/model-call.js');

  const tag = `rr21-${process.pid}-${Date.now()}`;
  let a = '';
  let b = '';
  beforeAll(async () => {
    a = (await createCompany({ slug: `${tag}-a`, name: 'Summit Ridge Roofing', status: 'active' })).id;
    b = (await createCompany({ slug: `${tag}-b`, name: 'Cedar Falls Roofing Two', status: 'active' })).id;
  });
  afterEach(() => vi.restoreAllMocks());

  const rowsFor = (company: string, ref: string) =>
    runAsCompany(company, async () => (await db.execute(sql`select * from model_costs where ref = ${ref} order by created_at`)).rows as any[]);

  it('writes one row for a call that succeeded, with the real cost and the company', async () => {
    const ref = `${tag}-ok`;
    const value = await runAsCompany(a, () => meteredModelCall(
      { operation: 'narrative', role: 'narrative', ref },
      async () => ({ value: 'the finding', usage: { input: 1_000_000, output: 100_000 } })));
    expect(value).toBe('the finding');
    const rows = await rowsFor(a, ref);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ company_id: a, operation: 'narrative', provider: 'anthropic', model: 'claude-sonnet-5', input_tokens: 1_000_000, output_tokens: 100_000, priced: true });
    expect(Number(rows[0].cents)).toBe(300);
  });

  it('writes one row for a call that threw, then throws the same error', async () => {
    const ref = `${tag}-throw`;
    const boom = new ModelCallError(500);
    const caught = await runAsCompany(a, () => meteredModelCall({ operation: 'photo_labels', role: 'labels', ref }, async () => { throw boom; })).then(() => null, (e) => e);
    expect(caught).toBe(boom);
    const rows = await rowsFor(a, ref);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ operation: 'photo_labels', provider: 'anthropic', model: 'claude-haiku-4-5', priced: true, input_tokens: null });
    expect(Number(rows[0].cents)).toBe(0);
  });

  it('records a failed call the provider still billed, from the usage the error carries', async () => {
    const ref = `${tag}-billed`;
    const billed = Object.assign(new Error('unreadable answer'), { usage: { inputTokens: 2_000, outputTokens: 500 } });
    await runAsCompany(a, () => meteredModelCall({ operation: 'narrative', role: 'narrative', ref }, async () => { throw billed; })).catch(() => {});
    const rows = await rowsFor(a, ref);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ input_tokens: 2_000, output_tokens: 500, priced: true });
    expect(Number(rows[0].cents)).toBeCloseTo(0.9, 4);
  });

  it('records the usage of a provider whose price is not confirmed as unpriced, never as a guessed number', async () => {
    const ref = `${tag}-unpriced`;
    await runAsCompany(a, () => meteredModelCall({ operation: 'photo_analysis', role: 'vision', ref }, async () => ({ value: 1, usage: { input: 5_000, output: 900 } })));
    await runAsCompany(a, () => meteredModelCall({ operation: 'photo_analysis', role: 'visionFallback', ref }, async () => ({ value: 1, usage: { input: 4_000, output: 100 } })));
    await runAsCompany(a, () => meteredModelCall({ operation: 'satellite_image', role: 'staticMap', ref }, async () => ({ value: 1 })));
    const rows = await rowsFor(a, ref);
    expect(rows.map((r) => [r.provider, r.priced, Number(r.cents)])).toEqual([
      ['groq', false, 0], ['google', false, 0], ['google', false, 0],
    ]);
    expect(rows[0]).toMatchObject({ input_tokens: 5_000, output_tokens: 900, model: 'meta-llama/llama-4-scout-17b-16e-instruct' });
  });

  it('records a call that reported no token counts as unpriced', async () => {
    const ref = `${tag}-nousage`;
    await runAsCompany(a, () => meteredModelCall({ operation: 'narrative', role: 'narrative', ref }, async () => ({ value: 1 })));
    const [row] = await rowsFor(a, ref);
    expect(row).toMatchObject({ input_tokens: null, output_tokens: null, priced: false });
    expect(Number(row.cents)).toBe(0);
  });

  it('refuses a provider that is not on the United States list before calling it, and writes nothing', async () => {
    const ref = `${tag}-rogue`;
    const call = vi.fn(async () => ({ value: 1 }));
    const err = await runAsCompany(a, () => meteredModelCall({ operation: 'narrative', role: 'rogue' as any, ref }, call)).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(NotUsProviderError);
    expect(call).not.toHaveBeenCalled();
    expect(await rowsFor(a, ref)).toEqual([]);
  });

  it('writes the row as the current company, invisible to another', async () => {
    const ref = `${tag}-iso`;
    await runAsCompany(a, () => meteredModelCall({ operation: 'rewrite', role: 'rewrite', ref }, async () => ({ value: 1, usage: { input: 10, output: 10 } })));
    expect(await rowsFor(b, ref)).toEqual([]);
    expect(await rowsFor(a, ref)).toHaveLength(1);
    const joinedByB = await runAsCompany(b, async () => (await db.execute(sql`
      select c.id from model_costs c join companies k on k.id = c.company_id where c.ref = ${ref}`)).rows);
    expect(joinedByB).toEqual([]);
    // And another company's cost row cannot be changed or planted.
    const touched = await runAsCompany(b, async () => (await db.execute(sql`update model_costs set cents = 0 where ref = ${ref} returning id`)).rows);
    expect(touched).toEqual([]);
    expect(await sqlState(runAsCompany(b, () => db.execute(sql`insert into model_costs (company_id, operation, provider, priced) values (${a}, 'narrative', 'anthropic', true)`)))).toBe('42501');
  });

  it('does not fail the call when the row cannot be written, and logs only the kind of failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    // No company in context: the insert is refused by the database.
    const value = await meteredModelCall({ operation: 'narrative', role: 'narrative', ref: `${tag}-nowrite` }, async () => ({ value: 'kept', usage: { input: 1, output: 1 } }));
    expect(value).toBe('kept');
    const said = JSON.stringify([...warn.mock.calls, ...error.mock.calls, ...log.mock.calls]);
    expect(said).toContain('a cost row could not be written');
    // Only the kind of failure: no message text, no column or table names, no values.
    expect(said).not.toMatch(/company_id|model_costs|violates|null value|Failed query|insert into|nowrite/i);
  });

  it('still throws the call\'s own error when it threw and the row could not be written either', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const boom = new Error('provider said something private');
    const caught = await meteredModelCall({ operation: 'narrative', role: 'narrative', ref: null }, async () => { throw boom; }).then(() => null, (e) => e);
    expect(caught).toBe(boom);
  });

  describe('as the seam the narrative and the labels already use', () => {
    it('writes one row per ModelCaller call, with its tokens, and passes the answer through', async () => {
      const ref = `${tag}-seam`;
      const base = vi.fn(async () => ({ text: 'a label', usage: { inputTokens: 3_000, outputTokens: 200 } }));
      const caller = meteredModelCaller(base, { operation: 'photo_labels', ref });
      const result = await runAsCompany(a, () => caller({ role: 'labels', prompt: 'p', maxTokens: 10 }));
      expect(result).toEqual({ text: 'a label', usage: { inputTokens: 3_000, outputTokens: 200 } });
      const rows = await rowsFor(a, ref);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ operation: 'photo_labels', model: 'claude-haiku-4-5', input_tokens: 3_000, output_tokens: 200 });
    });

    it('records the failure of a caller and rethrows it', async () => {
      const ref = `${tag}-seamfail`;
      const caller = meteredModelCaller(async () => { throw new ModelCallError(529); }, { operation: 'narrative', ref });
      const err = await runAsCompany(a, () => caller({ role: 'narrative', prompt: 'p', maxTokens: 10 })).then(() => null, (e) => e);
      expect(err).toBeInstanceOf(ModelCallError);
      expect(await rowsFor(a, ref)).toHaveLength(1);
    });
  });

  describe('migration 0021', () => {
    it('refuses a provider outside the list and defaults cents to zero', async () => {
      expect(await sqlState(runAsCompany(a, () => db.execute(sql`insert into model_costs (operation, provider, priced) values ('narrative', 'siliconflow', true)`)))).toBe('23514');
      const { rows } = await runAsCompany(a, () => db.execute(sql`insert into model_costs (operation, provider, priced) values ('narrative', 'groq', false) returning cents`));
      expect(Number((rows[0] as any).cents)).toBe(0);
    });

    it('is described by the Drizzle table the app uses', async () => {
      const [row] = await runAsCompany(a, () => db.insert(schema.modelCosts).values({ operation: 'narrative', provider: 'anthropic', priced: true }).returning());
      expect(row.companyId).toBe(a);
    });
  });
});
