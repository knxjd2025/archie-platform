import { describe, it, expect } from 'vitest';
import { verifyStripeSignature } from '../signature';
import { toForm } from '../stripe';
import { signStripe } from './fake-stripe';

const secret = 'whsec_unit';
const body = Buffer.from('{"id":"evt_1","type":"invoice.paid"}');
const now = 1_800_000_000;

describe('Stripe signature', () => {
  it('accepts a signature over the exact bytes', () => {
    expect(verifyStripeSignature(body, signStripe(body.toString(), secret, now), secret, now)).toEqual({ ok: true });
    // Several v1 values (a secret being rolled): any match is enough.
    const header = `t=${now},v1=${'0'.repeat(64)},${signStripe(body.toString(), secret, now).split(',')[1]}`;
    expect(verifyStripeSignature(body, header, secret, now).ok).toBe(true);
  });

  it('refuses another secret, other bytes, an old timestamp, and junk', () => {
    expect(verifyStripeSignature(body, signStripe(body.toString(), 'whsec_other', now), secret, now).ok).toBe(false);
    expect(verifyStripeSignature(Buffer.from(`${body} `), signStripe(body.toString(), secret, now), secret, now).ok).toBe(false);
    expect(verifyStripeSignature(body, signStripe(body.toString(), secret, now - 301), secret, now).ok).toBe(false);
    expect(verifyStripeSignature(body, undefined, secret, now).ok).toBe(false);
    expect(verifyStripeSignature(body, 't=abc,v1=zz', secret, now).ok).toBe(false);
    expect(verifyStripeSignature(body, signStripe(body.toString(), secret, now), '', now).ok).toBe(false);
  });
});

describe('Stripe form encoding', () => {
  it('nests objects and arrays the way Stripe reads them', () => {
    const form = toForm({ mode: 'subscription', line_items: [{ price: 'p_1', quantity: 2 }], subscription_data: { metadata: { archie_company_id: 'x y' } } });
    expect(decodeURIComponent(form).split('&')).toEqual([
      'mode=subscription', 'line_items[0][price]=p_1', 'line_items[0][quantity]=2', 'subscription_data[metadata][archie_company_id]=x y',
    ]);
    expect(toForm({ items: [{ id: 'si_1', deleted: true }] })).toBe(`${encodeURIComponent('items[0][id]')}=si_1&${encodeURIComponent('items[0][deleted]')}=true`);
  });
});
