/**
 * Matching a phone number against a stored, human-formatted one.
 *
 * Leads keep their phone the way someone typed it — "(704) 555-1234",
 * "704.555.1234", "+1 704 555 1234" — while Twilio and GHL hand us
 * +17045551234. Comparing those exactly never matches, which is how an
 * existing customer texting in became a new "Unknown" lead and got the
 * new-lead welcome text. The rule is the last ten digits on both sides.
 */
import { sql, type SQL, type AnyColumn } from 'drizzle-orm';
import { isFinalStatus } from '../../shared/twilio-voice';
import { last10Digits } from '../../shared/comms';

export { last10Digits };

/**
 * `column` holds the same number as `phone`, compared on the last ten digits.
 *
 * The backslash is doubled on purpose: inside a JS template literal `'\D'`
 * cooks to `'D'`, so the regex stripped the letter D instead of non-digits,
 * every stored "(704) 555-1234" kept its punctuation, and no call or text was
 * ever matched to its lead.
 *
 * A number with no digits matches nothing — otherwise '' would equal every
 * lead whose phone is blank.
 */
export function samePhone(column: AnyColumn | SQL, phone: unknown): SQL {
  const tail = last10Digits(phone);
  if (!tail) return sql`false`;
  return sql`right(regexp_replace(${column}, '\\D', '', 'g'), 10) = ${tail}`;
}

/**
 * Statuses a status callback may not replace. Twilio does not promise to
 * deliver callbacks in order, so a late "ringing" landing after "completed"
 * would reopen a finished call on every dashboard.
 */
export const FINAL_CALL_STATUSES = ['completed', 'busy', 'no-answer', 'canceled', 'failed'] as const;

/**
 * The extra WHERE for a status update: a non-final status only lands on a
 * call that is not already final. A final status always lands, so a
 * "completed" that follows "no-answer" from a retried leg still records.
 */
export function statusMayReplace(statusColumn: AnyColumn, incoming: string | null): SQL | undefined {
  if (incoming && isFinalStatus(incoming)) return undefined;
  const finals = sql.join(FINAL_CALL_STATUSES.map((s) => sql`${s}`), sql`, `);
  return sql`coalesce(${statusColumn}, '') not in (${finals})`;
}
