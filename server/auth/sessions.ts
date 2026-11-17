/**
 * Ending a person's sessions in the session store (connect-pg-simple's
 * `session` table, migrations/0002). Each row's `sess` JSON carries the
 * signed-in user, so one statement finds them all by email.
 */
import { pool } from '../db';
import { clearSessionRevalidationCache } from './middleware';

/**
 * Sign `email` out everywhere: every stored session for that person is
 * deleted. Call it before starting the session that should survive. The
 * session table is global (no row level security), and email is unique across
 * Archie, so this reaches exactly that person.
 */
export async function endSessionsFor(email: string): Promise<number> {
  const who = email.trim().toLowerCase();
  clearSessionRevalidationCache(who);
  const res = await pool.query(`DELETE FROM "session" WHERE lower(sess->'user'->>'email') = $1`, [who]);
  return res.rowCount ?? 0;
}

/**
 * Sign everyone in one company out everywhere, for a company that has been
 * paused or closed. The roster re-check would refuse each of them within
 * half a minute anyway (server/auth/middleware.ts); this ends it at once.
 */
export async function endSessionsForCompany(companyId: string): Promise<number> {
  clearSessionRevalidationCache();
  const res = await pool.query(`DELETE FROM "session" WHERE sess->'user'->>'companyId' = $1`, [companyId]);
  return res.rowCount ?? 0;
}
