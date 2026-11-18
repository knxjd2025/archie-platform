/**
 * Operator scripts that do company or system work (create-company,
 * seed-companies) must connect the way the app does: as archie_app. Run with
 * the owner's URL, system work is refused ("permission denied to set role",
 * the owner is not a member of archie_system) and company work runs as a
 * different role than the app's. Say so up front, with what to do instead.
 */
export const APP_ROLE = 'archie_app';

export function wrongRoleMessage(role: string): string {
  return `This script must use the app's DATABASE_URL (user ${APP_ROLE}), but it is connected as "${role}".\n`
    + `Set DATABASE_URL to the same URL the app uses (Supabase: user archie_app.<project ref>, session pooler port 5432).\n`
    + `The owner's URL (postgres) is only for scripts/migrate.ts and the SQL in scripts/sql/.`;
}

/** Throws with wrongRoleMessage unless the pool's connections log in as archie_app. */
export async function requireAppRole(pool: { query: (sql: string) => Promise<{ rows: Array<{ role?: string }> }> }): Promise<void> {
  const { rows } = await pool.query('select session_user::text as role');
  const role = rows[0]?.role ?? '(unknown)';
  if (role !== APP_ROLE) throw new Error(wrongRoleMessage(role));
}
