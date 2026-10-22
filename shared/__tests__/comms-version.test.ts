import { describe, it, expect } from 'vitest';
import { evaluateReadiness, blockedReason, isCommsVersion } from '../comms-version';

const FULL = {
  twilioAccountSid: 'AC123', twilioAuthToken: 'tok', numbersConfigured: 4,
  callsTableReady: true, a2pRegistered: true, voiceAgentConfigured: true,
};

describe('evaluateReadiness', () => {
  it('is ready only when the things a rep touches hourly are in place', () => {
    expect(evaluateReadiness(FULL).ready).toBe(true);
  });

  it('is still usable without the AI answer service — that is inbound only', () => {
    const r = evaluateReadiness({ ...FULL, voiceAgentConfigured: false });
    expect(r.ready).toBe(true);
    expect(r.missing).toContain('AI answer service rebuilt');
    expect(blockedReason(r)).toBeNull();
  });

  it('refuses when texts would silently go nowhere', () => {
    for (const broken of [
      { twilioAccountSid: '' },
      { twilioAuthToken: '' },
      { numbersConfigured: 0 },
      { callsTableReady: false },
      { a2pRegistered: false },
    ]) {
      const r = evaluateReadiness({ ...FULL, ...broken });
      expect(r.ready, JSON.stringify(broken)).toBe(false);
      expect(blockedReason(r)).toBeTruthy();
    }
  });

  it('today — nothing set up — names every blocker', () => {
    const r = evaluateReadiness({});
    expect(r.ready).toBe(false);
    expect(r.requirements.filter((x) => !x.ready)).toHaveLength(5);
    expect(blockedReason(r)).toContain('4 more things');
    // Every blocker carries a fix, so the screen never just says "no".
    for (const req of r.requirements) expect(req.fix.length).toBeGreaterThan(10);
  });

  it('counts a half-set credential as missing, not present', () => {
    expect(evaluateReadiness({ ...FULL, twilioAuthToken: null }).ready).toBe(false);
  });
});

describe('isCommsVersion', () => {
  it('accepts only the two versions that exist', () => {
    expect(isCommsVersion('v1')).toBe(true);
    expect(isCommsVersion('v2')).toBe(true);
    for (const bad of ['V1', 'v3', '', null, undefined, 1]) expect(isCommsVersion(bad)).toBe(false);
  });
});
