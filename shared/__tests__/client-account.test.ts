import { describe, it, expect } from 'vitest';
import { parseAccountEdit, jobFieldWrites, ACCOUNT_JOB_FIELDS } from '../client-account';

describe('parseAccountEdit', () => {
  it('accepts a name, job name and address, trimmed', () => {
    const r = parseAccountEdit({ customer: '  Jane Doe ', jobName: 'Doe Roof', address: '1 Main St, Charlotte, NC 28209' });
    expect(r).toEqual({ ok: true, edit: { customer: 'Jane Doe', jobName: 'Doe Roof', address: '1 Main St, Charlotte, NC 28209' } });
  });

  it('refuses an empty body and a body with nothing in it', () => {
    expect(parseAccountEdit(null).ok).toBe(false);
    expect(parseAccountEdit({}).ok).toBe(false);
    expect(parseAccountEdit({ fields: {} }).ok).toBe(false);
  });

  it('refuses a blank customer name rather than wiping it', () => {
    expect(parseAccountEdit({ customer: '   ' })).toEqual({ ok: false, error: "Customer name can't be blank." });
  });

  it('refuses unknown keys, top level and in fields', () => {
    expect(parseAccountEdit({ repName: 'x' })).toEqual({ ok: false, error: 'Unknown field "repName".' });
    expect(parseAccountEdit({ fields: { projectedValue: '1' } })).toEqual({ ok: false, error: 'Unknown field "projectedValue".' });
  });

  it('turns a blank field into null so it clears in JobTread', () => {
    const r = parseAccountEdit({ fields: { carrier: '  ', claimNumber: null } });
    expect(r).toEqual({ ok: true, edit: { fields: { carrier: null, claimNumber: null } } });
  });

  it('checks emails, dates, phones and the claim flag', () => {
    expect(parseAccountEdit({ fields: { adjusterEmail: 'not-an-email' } }).ok).toBe(false);
    expect(parseAccountEdit({ fields: { dateOfLoss: '05/01/2026' } }).ok).toBe(false);
    expect(parseAccountEdit({ fields: { adjusterPhone: 'call me' } }).ok).toBe(false);
    expect(parseAccountEdit({ fields: { isClaim: 'yes' } }).ok).toBe(false);
    expect(parseAccountEdit({ fields: { adjusterEmail: 'a@b.co', dateOfLoss: '2026-05-01', adjusterPhone: '(704) 555-0100', isClaim: true } }))
      .toEqual({ ok: true, edit: { fields: { adjusterEmail: 'a@b.co', dateOfLoss: '2026-05-01', adjusterPhone: '(704) 555-0100', isClaim: true } } });
  });

  it('caps length', () => {
    expect(parseAccountEdit({ jobName: 'x'.repeat(129) }).ok).toBe(false);
    expect(parseAccountEdit({ fields: { carrier: 'x'.repeat(201) } }).ok).toBe(false);
  });
});

describe('jobFieldWrites', () => {
  it('maps keys to their JobTread field names', () => {
    expect(jobFieldWrites({ projectManager: 'Sam', isClaim: false, carrier: null }))
      .toEqual({ 'Project Manager': 'Sam', 'Insurance Claim': false, 'Insurance Carrier': null });
  });

  it('has a distinct JobTread field for every key', () => {
    expect(new Set(ACCOUNT_JOB_FIELDS.map((f) => f.jtName)).size).toBe(ACCOUNT_JOB_FIELDS.length);
  });
});
