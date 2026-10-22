import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { jpegBase64, normalizePhone } from '../routes';
import { htmlToText } from '../providers';
import { clientIp, networkGeo, resolveSignerGeo } from '../geo';

const req = (headers: Record<string, string>, ip = '10.0.0.1') => ({ headers, ip } as unknown as Request);

describe('normalizePhone', () => {
  it('takes the ways a rep actually types a number', () => {
    expect(normalizePhone('(904) 555-0123')).toBe('+19045550123');
    expect(normalizePhone('904.555.0123')).toBe('+19045550123');
    expect(normalizePhone('19045550123')).toBe('+19045550123');
    expect(normalizePhone('+1 904 555 0123')).toBe('+19045550123');
  });

  it('refuses what cannot be texted, instead of sending into the void', () => {
    expect(normalizePhone('555-0123')).toBeNull();     // no area code
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('not a phone')).toBeNull();
  });
});

describe('jpegBase64', () => {
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(400, 7),
    Buffer.from([0xff, 0xd9]),
  ]);
  const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;

  it('accepts what the signing page posts', () => {
    const out = jpegBase64(dataUrl);
    expect(out).toBe(jpeg.toString('base64'));
  });

  it('checks the bytes rather than the label the browser put on them', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(400, 3)]);
    expect(jpegBase64(`data:image/jpeg;base64,${png.toString('base64')}`)).toBeNull();
  });

  it('refuses anything that is not a JPEG data URL', () => {
    expect(jpegBase64(`data:image/png;base64,${jpeg.toString('base64')}`)).toBeNull();
    expect(jpegBase64('javascript:alert(1)')).toBeNull();
    expect(jpegBase64(jpeg.toString('base64'))).toBeNull();      // bare base64, no data URL
    expect(jpegBase64(undefined)).toBeNull();
  });

  it('caps what a public form can store', () => {
    expect(jpegBase64(`data:image/jpeg;base64,${'A'.repeat(500_000)}`)).toBeNull();
  });

  it('refuses a stub too small to be a signature', () => {
    expect(jpegBase64(`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`)).toBeNull();
  });
});

describe('the signer\'s IP', () => {
  it('takes the client hop, not the proxy', () => {
    expect(clientIp(req({ 'x-forwarded-for': '73.15.2.9, 10.1.1.1, 10.1.1.2' }))).toBe('73.15.2.9');
    expect(clientIp(req({}))).toBe('10.0.0.1');
  });
});

describe('networkGeo', () => {
  it('reads the edge headers and labels the result as approximate', () => {
    const geo = networkGeo(req({
      'x-vercel-ip-city': 'Jacksonville',
      'x-vercel-ip-country-region': 'FL',
      'x-vercel-ip-country': 'US',
      'x-vercel-ip-latitude': '30.3322',
      'x-vercel-ip-longitude': '-81.6557',
    }));
    expect(geo.source).toBe('network');
    expect(geo.city).toBe('Jacksonville');
    expect(geo.lat).toBeCloseTo(30.3322);
    expect(geo.accuracyM).toBeNull();
  });

  it('decodes the percent-encoding the edge uses for a city with a space', () => {
    expect(networkGeo(req({ 'x-vercel-ip-city': 'Ponte%20Vedra%20Beach' })).city).toBe('Ponte Vedra Beach');
  });

  it('says "none" rather than inventing a location off a bare request', () => {
    expect(networkGeo(req({})).source).toBe('none');
  });
});

describe('resolveSignerGeo', () => {
  const property = { lat: 30.3322, lng: -81.6557 };

  it('falls back to the network when the browser shared nothing', async () => {
    const geo = await resolveSignerGeo(req({ 'x-vercel-ip-city': 'Jacksonville' }), null, property);
    expect(geo.source).toBe('network');
    expect(geo.city).toBe('Jacksonville');
  });

  it('does not store coordinates that cannot be real', async () => {
    const headers = { 'x-vercel-ip-city': 'Jacksonville' };
    for (const bad of [{ lat: 900, lng: 4 }, { lat: 30, lng: -900 }, { lat: 0, lng: 0 }, { lat: 'x', lng: 'y' }]) {
      const geo = await resolveSignerGeo(req(headers), bad, property);
      expect(geo.source).toBe('network');
    }
  });
});

describe('htmlToText', () => {
  it('reads a document out the way it would be spoken', () => {
    const text = htmlToText('<h1>Certificate</h1><p>The roof at <b>1420 Sardis Rd</b> was completed.</p><ul><li>Nail sweep</li><li>Gutters</li></ul>');
    expect(text).toContain('Certificate');
    expect(text).toContain('The roof at 1420 Sardis Rd was completed.');
    expect(text).toContain('• Nail sweep');
    expect(text).not.toContain('<');
  });

  it('drops scripts and styles rather than reading them aloud', () => {
    expect(htmlToText('<style>p{color:red}</style><script>alert(1)</script><p>Hello</p>')).toBe('Hello');
  });

  it('turns entities back into the characters they stand for', () => {
    expect(htmlToText('<p>Tom &amp; Sons &quot;roofing&quot;</p>')).toBe('Tom & Sons "roofing"');
  });
});
