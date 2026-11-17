/**
 * Doing a write from Roof Lee once, however many times it arrives.
 *
 * Every write new in contract version 2 carries an `idempotency-key` header.
 * The key is unique per company: the same key for the same company a second
 * time must not do the work again, and is answered as it was the first time.
 * (Roof Lee sends a request again whenever it did not get a clear answer.)
 *
 * The key is claimed in the database BEFORE the work starts, so two copies
 * arriving together cannot both do it. Rows live in sister_idempotency, behind
 * the same row level security as everything else: one company's key can never
 * answer for another's.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { sisterIdempotency } from '../../shared/schema';
import { runAsCompany } from '../tenant/context';

export interface SisterAnswer { status: number; body: unknown }

/** Stored while the work is still going on. Never sent to anyone. */
const IN_HAND: SisterAnswer = { status: 0, body: null };
/** A claim this old with no answer was abandoned (the process died), and may be taken over. */
const ABANDONED_AFTER_SECONDS = 60;
const BUSY: SisterAnswer = { status: 409, body: { error: 'This request is already being handled. Send it again in a minute.' } };

/** A key Roof Lee could have sent: visible characters, 1 to 200 of them. */
export function isIdempotencyKey(key: unknown): key is string {
  return typeof key === 'string' && /^[\x21-\x7e]{1,200}$/.test(key);
}

/**
 * Runs `work` for this company unless this key has been seen for it before,
 * in which case the first answer is returned and nothing is done. With no key
 * the work simply runs (only for writes that are safe to repeat anyway).
 *
 * An answer of 500 or more, or a thrown error, is not remembered: the work
 * did not finish, so the next copy may try again.
 */
export async function once(companyId: string, key: string | undefined, work: () => Promise<SisterAnswer>): Promise<SisterAnswer> {
  if (key === undefined) return work();
  const mine = and(eq(sisterIdempotency.companyId, companyId), eq(sisterIdempotency.key, key));

  const claimed = await runAsCompany(companyId, async () => {
    const fresh = await db.insert(sisterIdempotency).values({ key, response: IN_HAND }).onConflictDoNothing().returning({ key: sisterIdempotency.key });
    if (fresh[0]) return { mine: true as const };
    const [seen] = await db.select().from(sisterIdempotency).where(mine);
    if (seen && seen.response.status !== 0) return { mine: false as const, answer: seen.response };
    // Still in hand. Take it over only if whoever claimed it has plainly gone.
    const taken = await db.update(sisterIdempotency).set({ createdAt: sql`now()` })
      .where(sql`${mine} AND (${sisterIdempotency.response}->>'status')::int = 0 AND ${sisterIdempotency.createdAt} < now() - make_interval(secs => ${ABANDONED_AFTER_SECONDS})`)
      .returning({ key: sisterIdempotency.key });
    return taken[0] ? { mine: true as const } : { mine: false as const, answer: BUSY };
  }, { loadProfile: false });
  if (!claimed.mine) return claimed.answer;

  const release = () => runAsCompany(companyId, () => db.delete(sisterIdempotency).where(mine), { loadProfile: false }).catch(() => {});
  let answer: SisterAnswer;
  try {
    answer = await work();
  } catch (e) {
    await release();
    throw e;
  }
  if (answer.status >= 500) { await release(); return answer; }
  await runAsCompany(companyId, () => db.update(sisterIdempotency).set({ response: answer }).where(mine), { loadProfile: false });
  return answer;
}
