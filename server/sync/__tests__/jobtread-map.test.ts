import { describe, it, expect } from 'vitest';
import { mapDeal, mapInvoice } from '../jobtread-map';

const order = { id: 'doc1', type: 'customerOrder', status: 'pending', name: 'Retail Roofing Proposal', toName: 'John Glynn', price: 31652.38, balance: 0, issueDate: '2026-07-28', signedAt: null, job: { name: 'J Glynn 0441' } };
const arInv = { id: 'inv1', type: 'customerInvoice', status: 'pending', name: 'Invoice', toName: 'Crystal Ferragut', price: 9343.33, balance: 9688.81, dueDate: '2026-07-14', issueDate: '2026-07-14', job: { name: 'C Ferragut 0398' } };
const apBill = { id: 'bill1', type: 'vendorBill', status: 'pending', toName: 'James Phillips', price: 0, balance: 1300, dueDate: '2026-07-17', job: { name: 'S Current 0255' } };

describe('mapDeal', () => {
  it('maps a customerOrder to a deal row', () => {
    const r = mapDeal(order as any);
    expect(r.sourceId).toBe('doc1');
    expect(r.customer).toBe('John Glynn');
    expect(r.amount).toBe('31652.38');
    expect(r.status).toBe('pending');
    expect(r.jobRef).toBe('J Glynn 0441');
    expect(r.signedAt).toBeNull();
  });
});

describe('mapInvoice', () => {
  it('maps a customerInvoice to an AR invoice row', () => {
    const r = mapInvoice(arInv as any);
    expect(r.kind).toBe('ar');
    expect(r.party).toBe('Crystal Ferragut');
    expect(r.amount).toBe('9343.33');
    expect(r.balance).toBe('9688.81');
    expect(r.dueDate).toBe('2026-07-14');
  });
  it('maps a vendorBill to an AP invoice row', () => {
    const r = mapInvoice(apBill as any);
    expect(r.kind).toBe('ap');
    expect(r.party).toBe('James Phillips');
    expect(r.amount).toBe('0');
    expect(r.balance).toBe('1300');
  });
});
