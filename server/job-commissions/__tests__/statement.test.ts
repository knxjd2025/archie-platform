import { describe, it, expect } from 'vitest';
import { commissionStatementFilename, commissionStatementLines } from '../statement';
import type { JobCommission } from '../../../shared/schema';

const record = (over: Partial<JobCommission> = {}): JobCommission => ({
  id: 1, jobExternalId: 'job-77', jobName: 'Whitfield — 1420 Sardis Rd', teamMemberId: 7, repName: 'Joven Mitchell',
  leadSource: 'self', jobType: 'retail', manualOverheadPct: null, overheadPct: '25.00',
  revenue: '24500.00', material: '6000.00', labor: '4000.00', other: '0.00', profit: null, commissionAmount: null,
  checks: { sold_confirmed: { by: 'joven@bestroofingnow.com', at: '2026-09-15T14:00:00Z' } },
  notes: null, status: 'open', createdBy: 'system:sync',
  approvedBy: null, approvedAt: null, paidBy: null, paidAt: null,
  createdAt: new Date('2026-09-01T12:00:00Z'), updatedAt: new Date('2026-09-16T12:00:00Z'),
  ...over,
} as JobCommission);

const rows = (r: JobCommission) => Object.fromEntries(
  commissionStatementLines(r).filter((l) => l.kind === 'row').map((l: any) => [l.label, l.value]),
);
const textOf = (r: JobCommission) => commissionStatementLines(r).map((l: any) => l.text ?? `${l.label} ${l.value}`).join('\n');

describe('the commission statement', () => {
  it('shows the figures and the commission worked out from them', () => {
    const out = rows(record());
    expect(out['Revenue (final contract price)']).toBe('$24,500.00');
    expect(out['Material']).toBe('$6,000.00');
    expect(out['Profit']).toBeDefined();
    expect(out['Commission earned (50% of profit)']).toBeDefined();
    expect(Object.keys(out).find((k) => k.startsWith('Overhead ('))).toContain('%');
  });

  it('says plainly when no commission can be worked out yet', () => {
    expect(textOf(record({ leadSource: null }))).toContain('No commission has been worked out yet');
    expect(rows(record({ leadSource: null }))['Commission earned (50% of profit)']).toBeUndefined();
  });

  it('marks the overhead rate when an admin set it by hand', () => {
    expect(Object.keys(rows(record({ manualOverheadPct: '18.00' }))).some((k) => k.includes('set by hand'))).toBe(true);
  });

  it('records who ticked each box and what is still outstanding', () => {
    const out = rows(record());
    expect(out['[x] Sold — signed contract / approved estimate is in JobTread']).toContain('joven');
    expect(out['[ ] Revenue is the final contract price']).toBe('not yet');
  });

  it('shows the approval and payout trail, and where it stops', () => {
    const open = rows(record());
    expect(open['Approved']).toBe('not yet');
    expect(open['Paid']).toBe('not yet');
    const paid = rows(record({
      status: 'paid', approvedBy: 'james@bestroofingnow.com', approvedAt: new Date('2026-09-16T12:00:00Z'),
      paidBy: 'james@bestroofingnow.com', paidAt: new Date('2026-09-18T12:00:00Z'),
    }));
    expect(paid['Approved']).toBe('james, September 16, 2026');
    expect(paid['Paid']).toBe('james, September 18, 2026');
  });

  it('names the file after the job and its status, without characters a filesystem would choke on', () => {
    expect(commissionStatementFilename(record())).toBe('Commission — Whitfield  1420 Sardis Rd (Open).pdf');
    expect(commissionStatementFilename(record({ jobName: 'A/B: "quoted"', status: 'paid' }))).toBe('Commission — AB quoted (Paid).pdf');
    expect(commissionStatementFilename(record({ jobName: null }))).toBe('Commission — job-77 (Open).pdf');
  });

  it('settles up against the draws the rep already took', () => {
    // 24,500 revenue, self-generated retail: 10% overhead = 2,450, costs
    // 10,000, profit 12,050, so the rep earned 6,025 and has had 2,000 of it.
    const out = rows(record({ advancesPaid: '2000.00' } as Partial<JobCommission>));
    expect(out['Commission earned (50% of profit)']).toBe('$6,025.00');
    expect(out['Less: already paid to the rep during the job']).toBe('-$2,000.00');
    expect(out['Balance still owed to the rep']).toBe('$4,025.00');
  });

  it('leaves the settlement off a job with no draws, rather than printing a zero', () => {
    const out = rows(record());
    expect(out['Less: already paid to the rep during the job']).toBeUndefined();
    expect(out['Balance still owed to the rep']).toBeUndefined();
  });

  it('names an overpayment instead of showing a negative balance owed', () => {
    const out = rows(record({ advancesPaid: '9000.00' } as Partial<JobCommission>));
    expect(out['Overpaid — to recover from a later job']).toBe('$2,975.00');
    expect(out['Balance still owed to the rep']).toBeUndefined();
  });

  it('shows which documents a figure was built from', () => {
    const out = rows(record({
      material: '5340.65',
      sources: {
        material: [
          { id: 'a', kind: 'doc', label: 'ABC Supply PO #221', amount: 4210.55, docId: 'd1' },
          { id: 'b', kind: 'manual', label: 'Ridge vent — picked up', amount: 1130.10 },
        ],
      },
    } as Partial<JobCommission>));
    expect(out['    JobTread — ABC Supply PO #221']).toBe('$4,210.55');
    expect(out['    Entered — Ridge vent — picked up']).toBe('$1,130.10');
    // And the line itself is the sum of them, not the stored column.
    expect(out['Material']).toBe('$5,340.65');
  });

  it('omits the breakdown entirely when nothing was itemised', () => {
    expect(textOf(record())).not.toContain('How these figures were built');
  });
});
