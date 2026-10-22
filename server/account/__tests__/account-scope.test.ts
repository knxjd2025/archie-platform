import { describe, it, expect } from 'vitest';
import { resolveScope, WINDOW_DAYS, isActiveStage, DONE_STAGES } from '../routes';

describe('resolveScope', () => {
  it('defaults to the signed-in person\'s own book', () => {
    for (const role of ['admin', 'manager', 'sales', 'production']) {
      expect(resolveScope(undefined, role).effective).toBe('mine');
    }
  });

  it('lets manager and admin ask for the whole company', () => {
    expect(resolveScope('all', 'manager').effective).toBe('all');
    expect(resolveScope('all', 'admin').effective).toBe('all');
  });

  it('refuses a rep asking for everyone, and says so', () => {
    // Silently returning their own book would look like the company has almost
    // no jobs — worse than telling them the request was denied.
    const r = resolveScope('all', 'sales');
    expect(r.effective).toBe('mine');
    expect(r.denied).toBe(true);
  });

  it('refuses production too', () => {
    expect(resolveScope('all', 'production').effective).toBe('mine');
    expect(resolveScope('all', 'production').denied).toBe(true);
  });

  it('treats anything unrecognised as "mine" without granting access', () => {
    for (const junk of ['ALL ', 'everyone', '', null, 0, {}, ['all']]) {
      const r = resolveScope(junk, 'sales');
      expect(r.effective).toBe('mine');
    }
  });

  it('is case-insensitive for the allowed value', () => {
    expect(resolveScope('ALL', 'admin').effective).toBe('all');
  });

  it('looks back 30 days', () => {
    expect(WINDOW_DAYS).toBe(30);
  });
});

describe('isActiveStage', () => {
  it('keeps jobs that are still in flight', () => {
    for (const s of ['New Lead', 'Estimating', 'Permitting', 'Roof Construction']) {
      expect(isActiveStage(s), s).toBe(true);
    }
  });

  it('drops finished jobs', () => {
    for (const s of DONE_STAGES) expect(isActiveStage(s), s).toBe(false);
  });

  it('keeps a job with no stage set', () => {
    // SQL's `NULL NOT IN (...)` is NULL, so an unstaged job silently disappears
    // unless it is allowed back in explicitly — and a brand new lead is exactly
    // what this page exists to surface.
    expect(isActiveStage(null)).toBe(true);
    expect(isActiveStage(undefined)).toBe(true);
  });
});
