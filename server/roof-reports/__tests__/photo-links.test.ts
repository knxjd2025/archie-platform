/**
 * The short-lived signed link a report page uses to show a photo. Made only
 * after the access rules have passed (the html route), it names the company,
 * the report, the photo and the copy, and runs out after ten minutes. No
 * database here: only the signing.
 */
import { describe, it, expect } from 'vitest';
import { LINK_TTL_SECONDS, signPhotoLink, verifyPhotoLink } from '../photo-links';

const input = {
  companyId: '0b9f6a52-6c1e-4d55-9a57-3c0a8c2f1e11',
  reportId: 'a1b2c3d4-0000-4000-8000-000000000001',
  photoId: '7d3e2c10-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
  variant: 'working' as const,
};
const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
const SECRET = 'a-test-secret';

describe('a signed photo link', () => {
  it('reads back exactly what was signed, until it runs out', () => {
    const token = signPhotoLink(input, T0, SECRET);
    expect(verifyPhotoLink(token, T0, SECRET)).toEqual(input);
    expect(verifyPhotoLink(token, T0 + (LINK_TTL_SECONDS - 1) * 1000, SECRET)).toEqual(input);
  });

  it('lives ten minutes and no longer', () => {
    expect(LINK_TTL_SECONDS).toBe(600);
    const token = signPhotoLink(input, T0, SECRET);
    expect(verifyPhotoLink(token, T0 + LINK_TTL_SECONDS * 1000 + 1000, SECRET)).toBeNull();
    expect(verifyPhotoLink(token, T0 + 3600_000, SECRET)).toBeNull();
  });

  it('is refused when any part has been changed', () => {
    const token = signPhotoLink(input, T0, SECRET);
    const [payload, sig] = token.split('.');
    const edit = (patch: object) => Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), ...patch })).toString('base64url');
    expect(verifyPhotoLink(`${edit({ p: '00000000-0000-4000-8000-000000000009' })}.${sig}`, T0, SECRET)).toBeNull();
    expect(verifyPhotoLink(`${edit({ c: '00000000-0000-4000-8000-000000000009' })}.${sig}`, T0, SECRET)).toBeNull();
    expect(verifyPhotoLink(`${edit({ v: 'thumb' })}.${sig}`, T0, SECRET)).toBeNull();
    expect(verifyPhotoLink(`${edit({ e: Math.floor(T0 / 1000) + 99999 })}.${sig}`, T0, SECRET)).toBeNull();
    expect(verifyPhotoLink(`${payload}.${sig.slice(0, -2)}AA`, T0, SECRET)).toBeNull();
  });

  it('is refused under another secret, and for anything that is not a token', () => {
    const token = signPhotoLink(input, T0, SECRET);
    expect(verifyPhotoLink(token, T0, 'another-secret')).toBeNull();
    for (const junk of ['', 'abc', 'a.b', '.', '..', `${token}.x`, 'x'.repeat(5000), null as unknown as string, undefined as unknown as string]) {
      expect(verifyPhotoLink(junk, T0, SECRET), String(junk).slice(0, 20)).toBeNull();
    }
  });

  it('refuses to sign for anything that is not a company, a report and a photo id', () => {
    expect(() => signPhotoLink({ ...input, photoId: '../x' }, T0, SECRET)).toThrow();
    expect(() => signPhotoLink({ ...input, companyId: 'x' }, T0, SECRET)).toThrow();
    expect(() => signPhotoLink({ ...input, variant: 'original' as any }, T0, SECRET)).toThrow();
  });
});
