/**
 * The one seam for "which system keeps this job" (server/production/native-jobs.ts).
 * Pure: no database.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db', () => ({ db: {} }));

import { isNativeJobId, jobBackendFor, keepsOwnJobs, newJobKey, NATIVE_JOB_PREFIX } from '../native-jobs';

const roofLeeMade = { roofliCompanyId: '0b9f6d0e-5c56-4a8e-9d55-2f1f5a3c7e11' };
const original = { roofliCompanyId: null };

describe('a job key Archie makes itself', () => {
  it('is archie- and 32 hex characters, so every check that reads a key knows it', () => {
    const key = newJobKey();
    expect(key.startsWith(NATIVE_JOB_PREFIX)).toBe(true);
    expect(key).toMatch(/^archie-[0-9a-f]{32}$/);
    expect(isNativeJobId(key)).toBe(true);
  });

  it('is a new one every time', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newJobKey()));
    expect(keys.size).toBe(200);
  });
});

describe('which system keeps a job', () => {
  it('is Archie for a key Archie made, in any company', () => {
    expect(jobBackendFor({ externalId: newJobKey() }, roofLeeMade)).toBe('archie');
    expect(jobBackendFor({ externalId: newJobKey() }, original)).toBe('archie');
    expect(jobBackendFor({ externalId: newJobKey() }, null)).toBe('archie');
  });

  it('is Archie for a job with no key yet in a company that keeps its own jobs', () => {
    expect(keepsOwnJobs(roofLeeMade)).toBe(true);
    expect(jobBackendFor({ externalId: null }, roofLeeMade)).toBe('archie');
    expect(jobBackendFor({ externalId: undefined }, roofLeeMade)).toBe('archie');
    expect(jobBackendFor({ externalId: '' }, roofLeeMade)).toBe('archie');
  });

  it('stays JobTread for every other company, keyed or not, exactly as before', () => {
    expect(jobBackendFor({ externalId: 'jt-22PvT7pGxKfQ' }, original)).toBe('jobtread');
    expect(jobBackendFor({ externalId: null }, original)).toBe('jobtread');
    expect(jobBackendFor({ externalId: null }, null)).toBe('jobtread');
    expect(jobBackendFor({ externalId: null }, undefined)).toBe('jobtread');
  });

  it('leaves a job another system keeps with that system, even in a company that keeps its own', () => {
    expect(jobBackendFor({ externalId: 'jt-22PvT7pGxKfQ' }, roofLeeMade)).toBe('jobtread');
    // Close to a key of Archie's own, but not one.
    expect(jobBackendFor({ externalId: 'archie-1' }, roofLeeMade)).toBe('jobtread');
    expect(jobBackendFor({ externalId: `archie-${'A'.repeat(32)}` }, roofLeeMade)).toBe('jobtread');
  });
});
