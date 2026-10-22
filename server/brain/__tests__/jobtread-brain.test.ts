import { describe, it, expect } from 'vitest';
import { isStaleEstimate, isUnpaidInvoice, staleEstimateToEvent, staleEstimateToLoop, unpaidInvoiceToLoop } from '../jobtread-brain';

const now = new Date('2026-07-18T12:00:00Z');

describe('jobtread rules', () => {
  it('flags pending customerOrder older than 3 days', () => {
    const doc = { id: 'd1', name: 'Residential Selections', type: 'customerOrder', status: 'pending', price: 7605.97, amountPaid: 0, issueDate: '2026-07-13' };
    expect(isStaleEstimate(doc, now)).toBe(true);
    expect(isStaleEstimate({ ...doc, issueDate: '2026-07-17' }, now)).toBe(false);
    expect(isStaleEstimate({ ...doc, status: 'approved' }, now)).toBe(false);
  });
  it('flags unpaid customerInvoice older than 7 days', () => {
    const inv = { id: 'i1', name: 'Invoice', type: 'customerInvoice', status: 'pending', price: 9343.33, amountPaid: 0, issueDate: '2026-07-02' };
    expect(isUnpaidInvoice(inv, now)).toBe(true);
    expect(isUnpaidInvoice({ ...inv, amountPaid: 9343.33 }, now)).toBe(false);
  });
  it('builds an event with job context', () => {
    const ev = staleEstimateToEvent(
      { id: 'd1', name: 'Residential Selections', type: 'customerOrder', status: 'pending', price: 7605.97, amountPaid: 0, issueDate: '2026-07-13' },
      'JUSTIN DRUM 0423',
    );
    expect(ev.source).toBe('jobtread');
    expect(ev.sourceRef).toBe('d1');
    expect(ev.text).toContain('JUSTIN DRUM 0423');
    expect(ev.text).toContain('7605.97');
  });
});

describe('jobtread findings go straight to loops (no LLM triage)', () => {
  const est = { id: 'd1', name: 'Residential Selections', type: 'customerOrder', status: 'pending', price: 7605.97, amountPaid: 0, issueDate: '2026-07-13' };
  const inv = { id: 'i1', name: 'Invoice', type: 'customerInvoice', status: 'pending', price: 9343.33, amountPaid: 0, issueDate: '2026-07-02' };

  it('a stale estimate is an estimate_stale loop keyed by the document', () => {
    const loop = staleEstimateToLoop(est, 'JUSTIN DRUM 0423');
    expect(loop).toMatchObject({ kind: 'estimate_stale', source: 'jobtread', sourceRef: 'd1', owner: 'james', urgency: 'normal' });
    expect(loop.summary).toContain('JUSTIN DRUM 0423');
  });

  it('dates the finding from when the document went stale, not from now', () => {
    // So a loop someone closed stays closed while the same document stays pending.
    expect(staleEstimateToLoop(est, 'J').occurredAt?.toISOString()).toBe('2026-07-16T00:00:00.000Z');
    expect(unpaidInvoiceToLoop(inv, 'J').occurredAt?.toISOString()).toBe('2026-07-09T00:00:00.000Z');
    expect(unpaidInvoiceToLoop(inv, 'J').kind).toBe('invoice_unpaid');
  });
});
