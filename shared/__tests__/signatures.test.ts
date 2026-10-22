import { describe, it, expect } from 'vitest';
import {
  CONSENT_TEXT, describeDevice, describeDistance, describeGeo, describeProximity,
  haversineMeters, isOpen, outstandingSigners, requestStatusFrom, signatureBlockHtml, signedAtProperty,
  type SignerGeo, type SignerView,
} from '../signatures';

const signer = (over: Partial<SignerView> = {}): SignerView => ({
  id: 1, name: 'Dana Whitfield', email: 'dana@example.com', phone: '+19045550123', role: 'customer',
  signUrl: null, emailedAt: null, emailError: null, textedAt: null, textError: null,
  remindedAt: null, remindCount: 0, firstViewedAt: null, lastViewedAt: null, viewCount: 0,
  signedAt: null, signedName: null, signatureKind: null, signatureImage: null,
  declinedAt: null, declineReason: null, ip: null, userAgent: null, geo: null, viewGeo: null,
  ...over,
});

const geo = (over: Partial<SignerGeo> = {}): SignerGeo => ({
  source: 'gps', lat: 30.3322, lng: -81.6557, accuracyM: 12,
  address: '1420 Sardis Rd, Jacksonville, FL', city: 'Jacksonville', region: 'Florida', country: 'United States',
  distanceFromPropertyM: 18, capturedAt: '2026-09-18T15:04:00.000Z',
  ...over,
});

describe('requestStatusFrom', () => {
  it('is signed only when every signer has signed', () => {
    const both = [signer({ signedAt: '2026-09-18T15:00:00Z' }), signer({ id: 2, signedAt: '2026-09-18T16:00:00Z' })];
    expect(requestStatusFrom(both, 'sent')).toBe('signed');
    expect(requestStatusFrom([both[0], signer({ id: 2, emailedAt: '2026-09-18T14:00:00Z' })], 'sent')).toBe('sent');
  });

  it('lets one refusal decide the whole document', () => {
    const signers = [signer({ signedAt: '2026-09-18T15:00:00Z' }), signer({ id: 2, declinedAt: '2026-09-18T16:00:00Z' })];
    expect(requestStatusFrom(signers, 'sent')).toBe('declined');
  });

  it('stays draft until something actually went out', () => {
    expect(requestStatusFrom([signer()], 'draft')).toBe('draft');
    expect(requestStatusFrom([signer({ textedAt: '2026-09-18T14:00:00Z' })], 'draft')).toBe('sent');
  });

  it('never resurrects a voided document', () => {
    expect(requestStatusFrom([signer({ signedAt: '2026-09-18T15:00:00Z' })], 'voided')).toBe('voided');
  });
});

describe('who is still out', () => {
  it('counts the unsigned and undeclined', () => {
    const signers = [signer(), signer({ id: 2, signedAt: 'x' }), signer({ id: 3, declinedAt: 'y' })];
    expect(outstandingSigners(signers).map((s) => s.id)).toEqual([1]);
  });

  it('knows which statuses can still be worked', () => {
    expect(isOpen('sent')).toBe(true);
    expect(isOpen('draft')).toBe(true);
    expect(isOpen('signed')).toBe(false);
    expect(isOpen('voided')).toBe(false);
  });
});

describe('distance', () => {
  it('measures a short walk accurately', () => {
    // Two points ~111 m apart: 0.001° of latitude.
    expect(haversineMeters({ lat: 30.3322, lng: -81.6557 }, { lat: 30.3332, lng: -81.6557 })).toBe(111);
  });

  it('is zero for the same point', () => {
    expect(haversineMeters({ lat: 30.3322, lng: -81.6557 }, { lat: 30.3322, lng: -81.6557 })).toBe(0);
  });

  it('speaks feet up close and miles far away', () => {
    expect(describeDistance(18)).toBe('60 ft');
    expect(describeDistance(4000)).toBe('2.5 mi');
    expect(describeDistance(40000)).toBe('25 mi');
    expect(describeDistance(null)).toBe('');
  });
});

describe('describing where somebody signed', () => {
  it('never dresses a network guess up as a position', () => {
    const line = describeGeo(geo({ source: 'network', address: null, accuracyM: null }));
    expect(line).toContain('approximate');
    expect(line).toContain('Jacksonville');
    expect(line).not.toContain('30.33');
  });

  it('gives coordinates and accuracy for a real GPS fix', () => {
    const line = describeGeo(geo());
    expect(line).toContain('1420 Sardis Rd');
    expect(line).toContain('30.332200, -81.655700');
    expect(line).toContain('±12 m');
  });

  it('says so plainly when nothing was shared', () => {
    expect(describeGeo(null)).toBe('Location not shared');
    expect(describeGeo(geo({ source: 'none' }))).toBe('Location not shared');
  });

  it('calls it "at the property" only for a GPS fix that is actually close', () => {
    expect(signedAtProperty(geo({ distanceFromPropertyM: 18 }))).toBe(true);
    expect(describeProximity(geo({ distanceFromPropertyM: 18 }))).toBe('At the property');
    expect(signedAtProperty(geo({ distanceFromPropertyM: 900 }))).toBe(false);
    expect(describeProximity(geo({ distanceFromPropertyM: 900 }))).toBe('0.6 mi from the property');
    // A city-level guess sitting near the house is still a guess.
    expect(signedAtProperty(geo({ source: 'network', distanceFromPropertyM: 20 }))).toBe(false);
  });
});

describe('describeDevice', () => {
  it('names the phone a homeowner actually used', () => {
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'))
      .toBe('iPhone · Safari');
    expect(describeDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36'))
      .toBe('Android · Chrome');
    expect(describeDevice('')).toBe('Unknown device');
  });
});

describe('signatureBlockHtml', () => {
  it('shows a drawn signature as the image and a typed one as the name', () => {
    const html = signatureBlockHtml([
      signer({ signedAt: '2026-09-18T15:00:00Z', signedName: 'Dana Whitfield', signatureKind: 'drawn', signatureImage: 'AAAA', geo: geo() }),
      signer({ id: 2, name: 'Sam Reyes', role: 'company', signedAt: '2026-09-18T16:00:00Z', signedName: 'Sam Reyes', signatureKind: 'typed' }),
    ], 'Acme Test Roofing LLC');
    expect(html).toContain('data:image/jpeg;base64,AAAA');
    expect(html).toContain('Sam Reyes</b> — Acme Test Roofing LLC'); // the company signs under its own name
    expect(html).toContain('At the property');
  });

  it('names no company when none is given', () => {
    const html = signatureBlockHtml([signer({ role: 'company', signedAt: '2026-09-18T16:00:00Z', signedName: 'Sam Reyes' })]);
    expect(html).not.toContain(' — ');
  });

  it('says who has not signed rather than leaving a blank line', () => {
    expect(signatureBlockHtml([signer()])).toContain('Not yet signed');
  });

  it('escapes a name that contains markup', () => {
    const html = signatureBlockHtml([signer({ name: '<script>alert(1)</script>' })]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('the consent sentence', () => {
  it('carries intent, consent to sign electronically, and that the mark is their signature', () => {
    expect(CONSENT_TEXT).toMatch(/electronically/i);
    expect(CONSENT_TEXT).toMatch(/intend to be bound/i);
    expect(CONSENT_TEXT).toMatch(/is my signature/i);
  });
});
