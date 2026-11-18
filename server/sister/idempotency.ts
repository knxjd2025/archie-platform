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
import { BUSY_RETRY_AFTER_SECONDS } from '../lib/db-busy';

export interface SisterAnswer {
  status: number;
  body: unknown;
  /**
   * False for a refusal that did no work and may stop applying (the person
   * may not do this yet). It is not kept, so the same key can be tried again.
   */
  remember?: boolean;
  /** Seconds to wait before sending again; goes out as `Retry-After`. Never stored. */
  retryAfter?: number;
}

/** Stored while the work is still going on. Never sent to anyone. */
const IN_HAND: SisterAnswer = { status: 0, body: null };
/** A claim this old with no answer was abandoned (the process died), and may be taken over. */
const ABANDONED_AFTER_SECONDS = 60;
/**
 * Another copy of this request holds the key. That is "not yet", never "no":
 * the first copy may well succeed, or it may have failed with the database too
 * full to let go of the key (see `release`). So it is answered like a busy
 * database, 503 and when to come back. Roof Lee reads a 409 as a plain
 * refusal and would give the request up.
 */
const BUSY: SisterAnswer = {
  status: 503,
  body: { error: 'This request is already being handled. Send it again in a few seconds.' },
  retryAfter: BUSY_RETRY_AFTER_SECONDS,
};

/** A key Roof Lee could have sent: visible characters, 1 to 200 of them. */
export function isIdempotencyKey(key: unknown): key is string {
  return typeof key === 'string' && /^[\x21-\x7e]{1,200}$/.test(key);
}

/**
 * Runs `work` for this company unless this key has been seen for it before,
 * in which case the first answer is returned and nothing is done. With no key
 * the work simply runs (only for writes that are safe to repeat anyway).
 *
 * An answer of 500 or more, a thrown error, or an answer marked
 * `remember: false` is not remembered: the work was not done, so the next
 * copy may try again.
 *
 * Letting go of the key needs the database too. When the work failed because
 * the database was full, that can fail as well; the key then stays in hand
 * until it counts as abandoned, and copies arriving meanwhile are told to come
 * back (503), never refused.
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
  const { remember = true, retryAfter: _never, ...kept } = answer;
  if (kept.status >= 500 || !remember) { await release(); return kept; }
  await runAsCompany(companyId, () => db.update(sisterIdempotency).set({ response: kept }).where(mine), { loadProfile: false });
  return kept;
}

/** A transaction on Archie's database, as db.transaction hands one out. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Keeps the answer to a write in the SAME transaction as the write itself.
 *
 * `once` stores the answer after the work has finished. For work that makes a
 * new row, that leaves a gap: if the process dies between the two, the claim
 * is taken over a minute later and the row is made a second time. Calling
 * this inside the work's own transaction closes the gap: either the row and
 * its answer are both there, or neither is.
 */
export async function rememberWithin(tx: Tx, companyId: string, key: string | undefined, answer: SisterAnswer): Promise<void> {
  if (key === undefined) return;
  await tx.update(sisterIdempotency).set({ response: { status: answer.status, body: answer.body } })
    .where(and(eq(sisterIdempotency.companyId, companyId), eq(sisterIdempotency.key, key)));
}
