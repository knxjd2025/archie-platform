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
