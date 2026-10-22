import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { calls, leads } from '../../../shared/schema';
import { samePhone, statusMayReplace, FINAL_CALL_STATUSES } from '../phone-match';
import { isFinalStatus } from '../../../shared/twilio-voice';

const dialect = new PgDialect();
const render = (q: Parameters<PgDialect['sqlToQuery']>[0]) => dialect.sqlToQuery(q);

describe('samePhone', () => {
  it('sends Postgres a non-digit class, not the letter D', () => {
    // `'\D'` inside a sql`` template cooks to `'D'`: the regex then stripped
    // capital Ds and left every "(704) 555-1234" punctuated, so no call ever
    // matched its lead. The SQL text must carry the backslash.
    const q = render(samePhone(leads.phone, '+17045551234'));
    expect(q.sql).toContain(`regexp_replace("leads"."phone", '\\D', '', 'g')`);
    expect(q.sql).not.toContain(`'D'`);
    expect(q.params).toEqual(['7045551234']);
  });

  it('compares on the last ten digits of whatever it is given', () => {
    expect(render(samePhone(leads.phone, '(704) 555-1234')).params).toEqual(['7045551234']);
    expect(render(samePhone(leads.phone, '1-704-555-1234')).params).toEqual(['7045551234']);
  });

  it('matches nothing for a number with no digits', () => {
    // '' would otherwise equal every lead whose phone is blank.
    expect(render(samePhone(leads.phone, '')).sql).toBe('false');
    expect(render(samePhone(leads.phone, null)).sql).toBe('false');
  });
});

describe('statusMayReplace', () => {
  it('lists exactly the statuses Twilio treats as final', () => {
    for (const s of FINAL_CALL_STATUSES) expect(isFinalStatus(s), s).toBe(true);
    for (const s of ['queued', 'initiated', 'ringing', 'in-progress']) expect(isFinalStatus(s), s).toBe(false);
  });

  it('lets a final status land on anything', () => {
    expect(statusMayReplace(calls.status, 'completed')).toBeUndefined();
    expect(statusMayReplace(calls.status, 'no-answer')).toBeUndefined();
  });

  it('keeps a late non-final status off a finished call', () => {
    // Twilio does not deliver callbacks in order; a "ringing" arriving after
    // "completed" used to reopen the call.
    const q = render(statusMayReplace(calls.status, 'ringing')!);
    expect(q.sql).toBe(`coalesce("calls"."status", '') not in ($1, $2, $3, $4, $5)`);
    expect(q.params).toEqual([...FINAL_CALL_STATUSES]);
    expect(statusMayReplace(calls.status, null)).toBeDefined();
  });
});
