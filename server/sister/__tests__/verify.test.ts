/**
 * The signing code pasted from Roof Lee (packages/sisters/src/sign.ts) must
 * give exactly the answers the written contract's worked examples give
 * (docs/sisters/contract-v2.md in the Roof Lee repository). If one of these
 * fails, Archie and Roof Lee no longer agree and nothing will verify live.
 */
import { describe, expect, it } from 'vitest';
import { sign, signRequest, verify, verifyRequest } from '../verify';

const SECRET = 'test-secret-not-a-real-one';
const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const MINUTE = 60_000;

describe('the written contract\'s worked examples', () => {
  it('version 1: timestamp.body', () => {
    const signature = 'fc7620ccbe77d041b81c37eee5284f273baf6e47ce3067b52a22c23197168737';
    expect(sign('{"hello":"world"}', 1794916800000, 'example-secret')).toBe(signature);
    expect(verify('{"hello":"world"}', 1794916800000, signature, 'example-secret', 1794916800000)).toBe(true);
  });

  it('version 2: a read with a query and no body', () => {
    const path = '/api/sister/v1/companies/0b9f6d0e-5c56-4a8e-9d55-2f1f5a3c7e11/leads?status=new';
    const signature = '5db01d414c2dd91b7e46cc0433805b58f1f30a9ca66345fd4b741555fe6a5665';
    expect(signRequest('GET', path, '', 1794916800000, 'example-pair-secret')).toBe(signature);
    expect(verifyRequest('GET', path, '', 1794916800000, signature, 'example-pair-secret', 1794916800000)).toBe(true);
  });

  it('version 2: an event going back to Roof Lee, with a body', () => {
    const body = '{"id":"evt_0001","product":"archie","roofliCompanyId":"0b9f6d0e-5c56-4a8e-9d55-2f1f5a3c7e11","type":"lead.created","occurredAt":"2026-11-17T12:00:00.000Z","data":{}}';
    const signature = '6cd35c28e8f5aeb435794757368b73b5f3328e9f84bdfa5e2c8cad0e943da2f9';
    expect(signRequest('POST', '/api/sister/v1/events', body, 1794916800000, 'example-pair-secret')).toBe(signature);
    expect(verifyRequest('POST', '/api/sister/v1/events', body, 1794916800000, signature, 'example-pair-secret', 1794916800000)).toBe(true);
  });
});

describe('version 1 signatures', () => {
  const BODY = JSON.stringify({ roofliCompanyId: 'abc', name: 'Summit Ridge Roofing' });

  it('a changed body, timestamp, secret or signature fails', () => {
    const signature = sign(BODY, NOW, SECRET);
    expect(verify(BODY, NOW, signature, SECRET, NOW + 4 * MINUTE)).toBe(true);
    expect(verify(BODY.replace('Summit', 'Sunset'), NOW, signature, SECRET, NOW)).toBe(false);
    expect(verify(BODY, NOW + 1, signature, SECRET, NOW)).toBe(false);
    expect(verify(BODY, NOW, signature, 'another-secret', NOW)).toBe(false);
    expect(verify(BODY, NOW, signature.slice(0, -2), SECRET, NOW)).toBe(false);
    expect(verify(BODY, NOW, 'not hex at all', SECRET, NOW)).toBe(false);
    expect(verify(BODY, Number.NaN, signature, SECRET, NOW)).toBe(false);
  });

  it('refuses a timestamp more than five minutes off, either way', () => {
    for (const then of [NOW - 6 * MINUTE, NOW + 6 * MINUTE]) {
      expect(verify(BODY, then, sign(BODY, then, SECRET), SECRET, NOW)).toBe(false);
    }
  });

  it('never verifies without a secret', () => {
    expect(() => sign(BODY, NOW, '')).toThrow();
    expect(verify(BODY, NOW, sign(BODY, NOW, SECRET), '', NOW)).toBe(false);
  });
});

describe('version 2 signatures cover the method and the address', () => {
  const A = '/api/sister/v1/companies/company-a';
  const B = '/api/sister/v1/companies/company-b';

  it('headers from one company\'s read do not open another company\'s', () => {
    const signature = signRequest('GET', A, '', NOW, SECRET);
    expect(verifyRequest('GET', A, '', NOW, signature, SECRET, NOW)).toBe(true);
    expect(verifyRequest('GET', B, '', NOW, signature, SECRET, NOW)).toBe(false);
    expect(verifyRequest('DELETE', A, '', NOW, signature, SECRET, NOW)).toBe(false);
    expect(verifyRequest('GET', `${A}?x=1`, '', NOW, signature, SECRET, NOW)).toBe(false);
  });

  it('the two forms never pass for each other', () => {
    expect(verifyRequest('GET', A, '', NOW, sign('', NOW, SECRET), SECRET, NOW)).toBe(false);
    expect(verify('', NOW, signRequest('GET', A, '', NOW, SECRET), SECRET, NOW)).toBe(false);
  });

  it('the address and the body cannot be slid into one another', () => {
    const signature = signRequest('POST', '/api/sister/v1/x', 'y', NOW, SECRET);
    expect(verifyRequest('POST', '/api/sister/v1/x.y', '', NOW, signature, SECRET, NOW)).toBe(false);
    expect(verifyRequest('POST', '/api/sister/v1/x', '\ny', NOW, signature, SECRET, NOW)).toBe(false);
  });

  it('refuses an address that is not in its sent form', () => {
    for (const path of ['', 'api/sister/v1/ready', 'https://x.test/api', '/a b', '/a\nb', '/a#b', '/a/../b', '/a/./b', '/a/..', '/a/%2e%2e/b', '/a/.%2E']) {
      expect(() => signRequest('GET', path, '', NOW, SECRET), path).toThrow();
      expect(verifyRequest('GET', path, '', NOW, 'a'.repeat(64), SECRET, NOW), path).toBe(false);
    }
  });

  it('keeps the five minute rule and needs a secret', () => {
    const then = NOW - 6 * MINUTE;
    expect(verifyRequest('GET', A, '', then, signRequest('GET', A, '', then, SECRET), SECRET, NOW)).toBe(false);
    expect(verifyRequest('GET', A, '', NOW, signRequest('GET', A, '', NOW, SECRET), '', NOW)).toBe(false);
  });
});
