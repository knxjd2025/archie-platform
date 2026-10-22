import { describe, it, expect, vi, beforeEach } from 'vitest';

const ownsLead = vi.fn();
const teamMemberIdByEmail = vi.fn();
vi.mock('../../access/rep-scope', () => ({
  ownsLead: (...a: unknown[]) => ownsLead(...a),
  teamMemberIdByEmail: (...a: unknown[]) => teamMemberIdByEmail(...a),
}));

import { mayHearCall, seesEveryCall } from '../call-access';

const rep = { email: 'rep@bestroofingnow.com', name: 'Rep', role: 'sales' as const };
const cs = { email: 'cs@bestroofingnow.com', name: 'CS', role: 'customer_service' as const };

beforeEach(() => {
  ownsLead.mockReset();
  teamMemberIdByEmail.mockReset();
});

describe('who may hear a call recording', () => {
  it('lets the roles that see every call hear any of them', async () => {
    for (const role of ['admin', 'sales_director', 'manager'] as const) {
      expect(seesEveryCall(role)).toBe(true);
      expect(await mayHearCall({ ...rep, role }, { leadExternalId: null, teamMemberId: null })).toBe(true);
    }
    expect(ownsLead).not.toHaveBeenCalled();
  });

  it('refuses a rep a call with no client attached that they did not handle', async () => {
    // The stream skipped the ownership check whenever leadExternalId was null,
    // so any signed-in rep could play these by id.
    teamMemberIdByEmail.mockResolvedValue(7);
    expect(await mayHearCall(rep, { leadExternalId: null, teamMemberId: 9 })).toBe(false);
    expect(await mayHearCall(rep, { leadExternalId: null, teamMemberId: null })).toBe(false);
  });

  it('refuses customer service a call with no client, as the calls list does', async () => {
    teamMemberIdByEmail.mockResolvedValue(3);
    expect(await mayHearCall(cs, { leadExternalId: null, teamMemberId: null })).toBe(false);
  });

  it('lets the team member who handled the call hear it', async () => {
    teamMemberIdByEmail.mockResolvedValue(7);
    expect(await mayHearCall(rep, { leadExternalId: null, teamMemberId: 7 })).toBe(true);
  });

  it('follows lead ownership when the call has a client', async () => {
    ownsLead.mockResolvedValue(true);
    expect(await mayHearCall(rep, { leadExternalId: 'job-1', teamMemberId: null })).toBe(true);
    ownsLead.mockResolvedValue(false);
    teamMemberIdByEmail.mockResolvedValue(7);
    expect(await mayHearCall(rep, { leadExternalId: 'job-2', teamMemberId: 8 })).toBe(false);
    expect(ownsLead).toHaveBeenCalledWith(rep, 'job-2');
  });
});
