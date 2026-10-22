import { describe, it, expect } from 'vitest';
import { fitToChannel, VOICE_PROFILE } from '../voice';

describe('fitToChannel', () => {
  it('keeps short SMS on sms', () => {
    const r = fitToChannel('Quick reminder about your inspection tomorrow at 9am!', 'sms');
    expect(r.channel).toBe('sms');
  });
  it('switches >1200 char bodies to email', () => {
    const r = fitToChannel('x'.repeat(1300), 'sms');
    expect(r.channel).toBe('email');
  });
});

describe('VOICE_PROFILE', () => {
  it('encodes the non-negotiables', () => {
    expect(VOICE_PROFILE).toMatch(/friendly/i);
    expect(VOICE_PROFILE).toMatch(/professional/i);
    expect(VOICE_PROFILE).toMatch(/never.*(robotic|stiff)/i);
  });
});
