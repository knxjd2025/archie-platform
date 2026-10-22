import { describe, it, expect } from 'vitest';
import { shapeDeal, shapeInvoice, shapeAppointment, shapeLead } from '../reports';

describe('report shapers', () => {
  it('shapeDeal converts decimal string amount to number', () => {
    const out = shapeDeal({ customer: 'Acme', amount: '12500.00', type: 'Retail Roofing Proposal', status: 'pending', issueDate: '2026-08-01', signedAt: null });
    expect(out).toMatchObject({ customer: 'Acme', amount: 12500, type: 'Retail Roofing Proposal', status: 'pending', issueDate: '2026-08-01' });
  });
  it('shapeInvoice flags overdue from dueDate + positive balance', () => {
    const out = shapeInvoice({ kind: 'ar', party: 'Jones', amount: '5000.00', balance: '5000.00', dueDate: '2000-01-01', status: 'sent' });
    expect(out.balance).toBe(5000);
    expect(out.isOverdue).toBe(true);
  });
  it('shapeInvoice is not overdue when balance is zero', () => {
    const out = shapeInvoice({ kind: 'ar', party: 'Jones', amount: '5000.00', balance: '0', dueDate: '2000-01-01', status: 'paid' });
    expect(out.isOverdue).toBe(false);
  });
  it('shapeAppointment keeps ISO timestamps and title', () => {
    const start = new Date('2026-09-01T15:00:00Z');
    const out = shapeAppointment({ title: 'Inspection', start, end: null, address: '123 Main', kind: 'inspection' });
    expect(out).toMatchObject({ title: 'Inspection', address: '123 Main', kind: 'inspection' });
    expect(out.start).toBe(start.toISOString());
  });
  it('shapeLead joins name and passes status/source', () => {
    const out = shapeLead({ firstName: 'Dana', lastName: 'Lee', status: 'new', source: 'jobtread', serviceType: 'replacement', city: 'Charlotte', state: 'NC' });
    expect(out).toMatchObject({ name: 'Dana Lee', status: 'new', source: 'jobtread', serviceType: 'replacement', city: 'Charlotte' });
  });
});
