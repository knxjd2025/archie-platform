import { describe, it, expect } from 'vitest';
import {
  isSoldJob, computeJobCommission, missingJobCommissionChecks, jobCommissionBlockers,
  canEditJobCommissionMoney, canTickJobCommissionCheck, JOB_COMMISSION_CHECKS, JOB_COMMISSION_STATUS_LABEL, SOLD_STAGES,
  isDue, isSettled, payoutAmount, payoutTotal, payoutsByRep,
  resolveLine, isItemised, isAdjusted, sanitizeSources, hasDoc, MAX_SOURCES_PER_LINE, type CommissionSources,
  splitCommission, sharesBlocker, evenShares, computeCommissionSplit, rollUpCommissionStatus, rollUpColumns,
} from '../job-commission';
import { OVERHEAD_RATES } from '../commission';

const allChecked = () => Object.fromEntries(JOB_COMMISSION_CHECKS.map((c) => [c.key, { by: 'x@y', at: '2026-09-14T00:00:00Z' }]));

describe('isSoldJob', () => {
  it('is sold when JobTread status maps to won', () => {
    expect(isSoldJob({ status: 'won', stage: 'Estimating' })).toBe(true);
  });
  it('is sold once the pipeline stage is past the sale, even before status catches up', () => {
    for (const s of SOLD_STAGES) expect(isSoldJob({ status: 'new', stage: s })).toBe(true);
  });
  it('is not sold while still estimating, lost, or unknown', () => {
    expect(isSoldJob({ status: 'contacted', stage: 'Estimating' })).toBe(false);
    expect(isSoldJob({ status: 'lost', stage: 'Lost' })).toBe(false);
    expect(isSoldJob({ status: null, stage: null })).toBe(false);
  });
});

describe('computeJobCommission', () => {
  const base = { jobType: 'retail' as const, revenue: 20000, material: 6000, labor: 4000, other: 0, manualOverheadPct: null };
  it('refuses to compute until the lead source is known', () => {
    expect(computeJobCommission({ ...base, leadSource: null })).toBeNull();
  });
  it('takes overhead off revenue, then material and labor, and pays half the profit', () => {
    const r = computeJobCommission({ ...base, leadSource: 'self' })!;
    expect(r.overheadPct).toBe(OVERHEAD_RATES['self-retail']);
    expect(r.overheadAmount).toBe(2000);
    expect(r.profit).toBe(8000);
    expect(r.commission).toBe(4000);
  });
  it('uses the insurance rate for an insurance job on a company lead', () => {
    const r = computeJobCommission({ ...base, leadSource: 'company', jobType: 'insurance' })!;
    expect(r.overheadPct).toBe(OVERHEAD_RATES['company-insurance']);
  });
  it('honours an admin overhead override', () => {
    const r = computeJobCommission({ ...base, leadSource: 'self', manualOverheadPct: 25 })!;
    expect(r.overheadPct).toBe(25);
    expect(r.overheadAmount).toBe(5000);
  });
});

describe('checklist and readiness', () => {
  it('lists every box as missing on a fresh record', () => {
    expect(missingJobCommissionChecks({}).map((c) => c.key)).toEqual(JOB_COMMISSION_CHECKS.map((c) => c.key));
    expect(missingJobCommissionChecks(null)).toHaveLength(JOB_COMMISSION_CHECKS.length);
  });
  it('has no blockers once the source is set, revenue is in, and every box is ticked', () => {
    expect(jobCommissionBlockers({ leadSource: 'self', jobType: 'retail', revenue: 1000, material: 0, labor: 0, other: 0, manualOverheadPct: null, checks: allChecked() })).toEqual([]);
  });
  it('names each thing still in the way', () => {
    const b = jobCommissionBlockers({ leadSource: null, jobType: 'retail', revenue: 0, material: 0, labor: 0, other: 0, manualOverheadPct: null, checks: {} });
    expect(b).toContain('Lead source not set');
    expect(b).toContain('Revenue is zero');
    expect(b.some((s) => s.includes('unchecked'))).toBe(true);
  });
});

describe('permissions', () => {
  it('only an admin edits money, approves, or pays', () => {
    expect(canEditJobCommissionMoney('admin')).toBe(true);
    expect(canEditJobCommissionMoney('sales_director')).toBe(false);
    expect(canEditJobCommissionMoney('manager')).toBe(false);
    expect(canEditJobCommissionMoney('sales')).toBe(false);
  });
  it('a rep ticks rep boxes but not admin boxes; admin ticks any', () => {
    const rep = JOB_COMMISSION_CHECKS.find((c) => c.who === 'rep')!;
    const adm = JOB_COMMISSION_CHECKS.find((c) => c.who === 'admin')!;
    expect(canTickJobCommissionCheck('sales', rep)).toBe(true);
    expect(canTickJobCommissionCheck('sales', adm)).toBe(false);
    expect(canTickJobCommissionCheck('admin', rep)).toBe(true);
    expect(canTickJobCommissionCheck('admin', adm)).toBe(true);
  });
});

describe('payouts', () => {
  const row = (id: number, repName: string | null, teamMemberId: number | null, status: 'open' | 'approved' | 'paid', commissionAmount: string | null) =>
    ({ id, repName, teamMemberId, status, commissionAmount });

  it('counts only approved-and-unpaid as due', () => {
    expect(isDue({ status: 'approved' })).toBe(true);
    expect(isDue({ status: 'open' })).toBe(false);
    expect(isDue({ status: 'paid' })).toBe(false);
  });

  it('treats an uncomputed commission as zero rather than NaN', () => {
    expect(payoutAmount({ commissionAmount: null })).toBe(0);
    expect(payoutAmount({ commissionAmount: 'not a number' })).toBe(0);
    expect(payoutAmount({ commissionAmount: '1250.50' })).toBe(1250.5);
    expect(payoutTotal([{ commissionAmount: '100' }, { commissionAmount: null }, { commissionAmount: 25 }])).toBe(125);
  });

  it('groups by the rep who gets paid, biggest owed first', () => {
    const groups = payoutsByRep([
      row(1, 'Joven Mitchell', 7, 'approved', '2180.00'),
      row(2, 'James Turner', 1, 'approved', '900.00'),
      row(3, 'Joven Mitchell', 7, 'approved', '2050.00'),
    ]);
    expect(groups.map((g) => [g.repName, g.total, g.rows.length])).toEqual([
      ['Joven Mitchell', 4230, 2], ['James Turner', 900, 1],
    ]);
  });

  it('keeps the same person together by team member id, whatever the name on the job says', () => {
    const groups = payoutsByRep([
      row(1, 'Joven Mitchell', 7, 'approved', '100'),
      row(2, 'Joven M.', 7, 'approved', '100'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].total).toBe(200);
  });

  it('sorts unassigned last however much it is worth — nobody can be paid until the job has a rep', () => {
    const groups = payoutsByRep([
      row(1, null, null, 'approved', '9000'),
      row(2, 'James Turner', 1, 'approved', '100'),
    ]);
    expect(groups.map((g) => g.repName)).toEqual(['James Turner', 'Unassigned']);
  });
});

describe('itemised money lines', () => {
  const at = '2026-09-21T10:00:00Z';

  it('adds up every attached source, so two suppliers and two crews both count', () => {
    const sources: CommissionSources = {
      material: [
        { id: 'a', kind: 'doc', label: 'ABC Supply PO', amount: 4210.55, docId: 'd1' },
        { id: 'b', kind: 'doc', label: 'Beacon PO', amount: 1130.10, docId: 'd2' },
      ],
      labor: [
        { id: 'c', kind: 'doc', label: 'Crew A work order', amount: 3000, docId: 'd3' },
        { id: 'd', kind: 'manual', label: 'Crew B cash', amount: 900 },
      ],
    };
    expect(resolveLine('material', sources, 0)).toBe(5340.65);
    expect(resolveLine('labor', sources, 0)).toBe(3900);
  });

  it('rounds to cents rather than carrying float dust into a payout', () => {
    const sources: CommissionSources = {
      material: [
        { id: 'a', kind: 'manual', label: 'one', amount: 0.1 },
        { id: 'b', kind: 'manual', label: 'two', amount: 0.2 },
      ],
    };
    expect(resolveLine('material', sources, 0)).toBe(0.3);
  });

  it('falls back to the typed figure only while a line has nothing attached', () => {
    expect(resolveLine('revenue', {}, 18500)).toBe(18500);
    expect(resolveLine('revenue', { revenue: [] }, 18500)).toBe(18500);
    // Attached sources win: a stale typed number must not override the arithmetic.
    expect(resolveLine('revenue', { revenue: [{ id: 'a', kind: 'doc', label: 'Proposal', amount: 20000, docId: 'd' }] }, 18500)).toBe(20000);
  });

  it('knows which lines are itemised', () => {
    expect(isItemised({ labor: [{ id: 'a', kind: 'manual', label: 'x', amount: 1 }] }, 'labor')).toBe(true);
    expect(isItemised({ labor: [] }, 'labor')).toBe(false);
    expect(isItemised(null, 'labor')).toBe(false);
  });

  it('refuses the same document twice on one line', () => {
    const cleaned = sanitizeSources({
      material: [
        { kind: 'doc', label: 'ABC Supply PO', amount: 100, docId: 'd1' },
        { kind: 'doc', label: 'ABC Supply PO again', amount: 100, docId: 'd1' },
      ],
    }, 'admin@x', at);
    expect(cleaned.material).toHaveLength(1);
  });

  it('allows the same document on two different lines', () => {
    // A single "Labor w/ Materials" work order legitimately splits across both.
    const cleaned = sanitizeSources({
      material: [{ kind: 'doc', label: 'Combined order', amount: 100, docId: 'd1' }],
      labor: [{ kind: 'doc', label: 'Combined order', amount: 250, docId: 'd1' }],
    }, 'admin@x', at);
    expect(cleaned.material).toHaveLength(1);
    expect(cleaned.labor).toHaveLength(1);
  });

  it('drops rows that would land as a silent zero', () => {
    const cleaned = sanitizeSources({
      labor: [
        { kind: 'manual', label: 'fine', amount: 500 },
        { kind: 'manual', label: 'no amount' },
        { kind: 'manual', label: 'negative', amount: -50 },
        { kind: 'doc', label: 'no doc id', amount: 10 },
        { kind: 'nonsense', label: 'bad kind', amount: 10 },
        null,
      ],
    }, 'admin@x', at);
    expect(cleaned.labor).toHaveLength(1);
    expect(cleaned.labor![0].amount).toBe(500);
  });

  it('ignores lines that are not money lines', () => {
    const cleaned = sanitizeSources({ commission: [{ kind: 'manual', label: 'nice try', amount: 9999 }] }, 'admin@x', at);
    expect(cleaned).toEqual({});
  });

  it('stamps who attached a source and when, and gives it an id', () => {
    const cleaned = sanitizeSources({ labor: [{ kind: 'manual', label: 'Crew B', amount: 900 }] }, 'admin@x', at);
    const s = cleaned.labor![0];
    expect(s.addedBy).toBe('admin@x');
    expect(s.addedAt).toBe(at);
    expect(s.id).toBeTruthy();
  });

  it('caps a line rather than accepting an unbounded list', () => {
    const many = Array.from({ length: MAX_SOURCES_PER_LINE + 10 }, (_, i) => ({ kind: 'manual', label: `x${i}`, amount: 1 }));
    expect(sanitizeSources({ labor: many }, 'admin@x', at).labor).toHaveLength(MAX_SOURCES_PER_LINE);
  });

  it('an empty array clears a line back to typed entry', () => {
    expect(sanitizeSources({ material: [] }, 'admin@x', at)).toEqual({ material: [] });
  });

  it('spots a document already on the line', () => {
    const list = [{ id: 'a', kind: 'doc' as const, label: 'PO', amount: 1, docId: 'd1' }];
    expect(hasDoc(list, 'd1')).toBe(true);
    expect(hasDoc(list, 'd2')).toBe(false);
  });
});

describe('draws already paid to the rep', () => {
  // 20k revenue, self-generated retail: 10% overhead = 2,000, costs 10,000,
  // so profit is 8,000 — 4,000 to the company and 4,000 earned by the rep.
  const base = { leadSource: 'self' as const, jobType: 'retail' as const, revenue: 20000, material: 6000, labor: 4000, other: 0, manualOverheadPct: null };

  it('takes the draws out of the rep half and leaves the company half alone', () => {
    const r = computeJobCommission({ ...base, advancesPaid: 1500 })!;
    expect(r.profit).toBe(8000);          // the company's half of this is unchanged
    expect(r.commission).toBe(4000);      // what the rep earned on the job
    expect(r.advancesPaid).toBe(1500);
    expect(r.balanceDue).toBe(2500);      // what is still owed
  });

  it('is the whole commission when no draws were taken', () => {
    const r = computeJobCommission({ ...base })!;
    expect(r.advancesPaid).toBe(0);
    expect(r.balanceDue).toBe(r.commission);
  });

  it('shows an overpaid rep as a negative balance rather than a tidy zero', () => {
    // Draws are 10% of payments collected, so a thin job can easily pay out
    // more than it finally earns. Hiding that would lose real money.
    const r = computeJobCommission({ ...base, advancesPaid: 5000 })!;
    expect(r.balanceDue).toBe(-1000);
  });

  it('never lets a negative draw inflate what is owed', () => {
    expect(computeJobCommission({ ...base, advancesPaid: -5000 })!.balanceDue).toBe(4000);
  });

  it('does not change the profit split, only the settlement', () => {
    const withDraws = computeJobCommission({ ...base, advancesPaid: 3000 })!;
    const without = computeJobCommission({ ...base })!;
    expect(withDraws.profit).toBe(without.profit);
    expect(withDraws.overheadAmount).toBe(without.overheadAmount);
    expect(withDraws.commission).toBe(without.commission);
  });
});

describe('payouts after draws', () => {
  it('owes the balance, not the commission over again', () => {
    expect(payoutAmount({ commissionAmount: '4000.00', balanceDue: '2500.00' })).toBe(2500);
  });
  it('falls back to the commission on a record written before draws existed', () => {
    expect(payoutAmount({ commissionAmount: '4000.00' })).toBe(4000);
    expect(payoutAmount({ commissionAmount: '4000.00', balanceDue: null })).toBe(4000);
  });
  it('totals and groups on the balance', () => {
    const rows = [
      { repName: 'Ann', teamMemberId: 1, status: 'approved' as const, commissionAmount: '4000.00', balanceDue: '2500.00' },
      { repName: 'Ann', teamMemberId: 1, status: 'approved' as const, commissionAmount: '1000.00', balanceDue: '1000.00' },
    ];
    expect(payoutTotal(rows)).toBe(3500);
    expect(payoutsByRep(rows)[0].total).toBe(3500);
  });
  it('counts a paid record at what went out, not at its zero balance', () => {
    // Paid means the balance is zero, so the Paid tab and "Paid to date"
    // used to read $0.00 off every paid job.
    expect(payoutAmount({ status: 'paid', commissionAmount: '4000.00', balanceDue: '0.00' })).toBe(4000);
    expect(payoutAmount({ status: 'paid', commissionAmount: '4000.00', balanceDue: null })).toBe(4000);
    expect(payoutAmount({ status: 'approved', commissionAmount: '4000.00', balanceDue: '0.00' })).toBe(0);
    const paid = [
      { repName: 'Ann', teamMemberId: 1, status: 'paid' as const, commissionAmount: '4000.00', balanceDue: '0.00' },
      { repName: 'Ann', teamMemberId: 1, status: 'paid' as const, commissionAmount: '1250.50', balanceDue: '0.00' },
    ];
    expect(payoutsByRep(paid)[0].total).toBe(5250.5);
  });
});

describe('a commission written in by hand', () => {
  const base = { leadSource: 'self' as const, jobType: 'retail' as const, revenue: 20000, material: 6000, labor: 4000, other: 0, manualOverheadPct: null };

  it('pays the agreed figure and still reports what the formula would have paid', () => {
    const r = computeJobCommission({ ...base, manualCommission: 2500 })!;
    expect(r.commission).toBe(2500);
    expect(r.calculatedCommission).toBe(4000);
    expect(r.isManual).toBe(true);
    // The job picture is untouched — the costs are still the costs.
    expect(r.profit).toBe(8000);
  });

  it('leaves the formula alone when nothing was written in', () => {
    const r = computeJobCommission({ ...base })!;
    expect(r.isManual).toBe(false);
    expect(r.commission).toBe(r.calculatedCommission);
  });

  it('settles an agreed figure against the draws like any other', () => {
    const r = computeJobCommission({ ...base, manualCommission: 2500, advancesPaid: 1000 })!;
    expect(r.balanceDue).toBe(1500);
  });

  it('never pays a negative agreed figure', () => {
    expect(computeJobCommission({ ...base, manualCommission: -500 })!.commission).toBe(0);
  });

  it('lets a job with no revenue be settled on an agreed figure', () => {
    // Revenue is normally a blocker; a figure someone agreed does not come
    // from revenue, so insisting on it would strand the record.
    const checks = allChecked();
    expect(jobCommissionBlockers({ ...base, revenue: 0, leadSource: 'self', manualCommission: 750, checks })).toEqual([]);
    expect(jobCommissionBlockers({ ...base, revenue: 0, leadSource: 'self', manualCommission: null, checks })).toContain('Revenue is zero');
  });
});

describe('denied commissions', () => {
  it('is a settled state, like paid', () => {
    expect(isSettled('denied')).toBe(true);
    expect(isSettled('paid')).toBe(true);
    expect(isSettled('open')).toBe(false);
    expect(isSettled('approved')).toBe(false);
  });
  it('is never counted as owed', () => {
    expect(isDue({ status: 'denied' })).toBe(false);
  });
  it('has a label of its own', () => {
    expect(JOB_COMMISSION_STATUS_LABEL.denied).toBe('Denied');
  });
});

describe('correcting an attached row', () => {
  const at = '2026-09-21T10:00:00Z';

  it('keeps what the document said when the amount is typed over', () => {
    const cleaned = sanitizeSources({
      material: [{ kind: 'doc', label: 'ABC Supply PO #11', amount: 2600, docId: 'd1', docAmount: 2760, editedBy: 'james@x', editedAt: at }],
    }, 'admin@x', at);
    const s = cleaned.material![0];
    expect(s.amount).toBe(2600);
    expect(s.docAmount).toBe(2760);
    expect(s.editedBy).toBe('james@x');
    expect(isAdjusted(s)).toBe(true);
  });

  it('is not "adjusted" when the amount still matches the document', () => {
    const [s] = sanitizeSources({ material: [{ kind: 'doc', label: 'PO', amount: 2760, docId: 'd1', docAmount: 2760 }] }, 'admin@x', at).material!;
    expect(isAdjusted(s)).toBe(false);
  });

  it('never calls a hand-entered row adjusted — there is nothing to differ from', () => {
    const [s] = sanitizeSources({ labor: [{ kind: 'manual', label: 'Crew B', amount: 900 }] }, 'admin@x', at).labor!;
    expect(isAdjusted(s)).toBe(false);
  });

  it('ignores a nonsense document amount rather than storing it', () => {
    const [s] = sanitizeSources({ material: [{ kind: 'doc', label: 'PO', amount: 100, docId: 'd1', docAmount: -5 }] }, 'admin@x', at).material!;
    expect(s.docAmount).toBeUndefined();
    expect(isAdjusted(s)).toBe(false);
  });

  it('an edited row still counts at its edited amount', () => {
    const sources: CommissionSources = {
      material: [
        { id: 'a', kind: 'doc', label: 'PO', amount: 2600, docId: 'd1', docAmount: 2760 },
        { id: 'b', kind: 'manual', label: 'extra', amount: 400 },
      ],
    };
    expect(resolveLine('material', sources, 0)).toBe(3000);
  });
});

describe('splits — more than one rep on a job', () => {
  const pool = 9200;
  it('divides the pool by share, and lets a rep be settled on a figure instead', () => {
    expect(splitCommission(pool, { sharePct: 60 })).toBe(5520);
    expect(splitCommission(pool, { sharePct: 40 })).toBe(3680);
    expect(splitCommission(pool, { sharePct: 100 })).toBe(pool);
    // An agreed figure ignores the share rather than fighting with it.
    expect(splitCommission(pool, { sharePct: 40, manualAmount: 4000 })).toBe(4000);
    expect(splitCommission(pool, { sharePct: 40, manualAmount: 0 })).toBe(0);
    // A share out of range can only be a mistake; it is clamped, not trusted.
    expect(splitCommission(pool, { sharePct: 140 })).toBe(pool);
    expect(splitCommission(pool, { sharePct: -10 })).toBe(0);
  });

  it('insists the shares come to the whole pool', () => {
    expect(sharesBlocker([{ sharePct: 60 }, { sharePct: 40 }])).toBeNull();
    expect(sharesBlocker([{ sharePct: 100 }])).toBeNull();
    expect(sharesBlocker([{ sharePct: 60 }, { sharePct: 30 }])).toMatch(/add 10%/);
    expect(sharesBlocker([{ sharePct: 60 }, { sharePct: 60 }])).toMatch(/take 20%/);
    expect(sharesBlocker([])).toMatch(/Nobody is on this job/);
    // A rep on an agreed figure isn't claiming a share, so they're not counted.
    expect(sharesBlocker([{ sharePct: 100 }, { sharePct: 0, manualAmount: 1500 }])).toBeNull();
    expect(sharesBlocker([{ sharePct: 0, manualAmount: 1500 }])).toBeNull();
  });

  it('evens shares out so they still total 100 when it does not divide', () => {
    expect(evenShares(2)).toEqual([50, 50]);
    expect(evenShares(4)).toEqual([25, 25, 25, 25]);
    const three = evenShares(3);
    expect(three.reduce((a, b) => a + b, 0)).toBe(100);
    expect(three).toEqual([33.33, 33.33, 33.34]);
    expect(evenShares(0)).toEqual([]);
  });

  it('evens out only what is left when somebody already holds a share', () => {
    // A rep paid on 50% keeps it; the two added after split the other half.
    expect(evenShares(2, 50)).toEqual([25, 25]);
    const rest = evenShares(3, 40);
    expect(rest.reduce((a, b) => a + b, 0)).toBeCloseTo(40, 10);
    expect(rest).toEqual([13.33, 13.33, 13.34]);
    // Nothing left to hand out is nothing, never a negative share.
    expect(evenShares(2, -10)).toEqual([0, 0]);
  });

  it('reads the ledger for what is paid, drawn and still owed', () => {
    const r = computeCommissionSplit(pool, { sharePct: 60 }, [
      { amount: 920, kind: 'draw' }, { amount: 780, kind: 'draw' },
    ]);
    expect(r.commission).toBe(5520);
    expect(r.drawn).toBe(1700);
    expect(r.paid).toBe(1700);
    expect(r.balanceDue).toBe(3820);
    expect(r.settled).toBe(false);

    const done = computeCommissionSplit(pool, { sharePct: 60 }, [
      { amount: 920, kind: 'draw' }, { amount: 780, kind: 'draw' }, { amount: 3820, kind: 'balance' },
    ]);
    expect(done.paid).toBe(5520);
    expect(done.drawn).toBe(1700);   // the settle-up is not a draw
    expect(done.balanceDue).toBe(0);
    expect(done.settled).toBe(true);
  });

  it('shows an overpaid rep as overpaid rather than flooring it to zero', () => {
    const r = computeCommissionSplit(1000, { sharePct: 100 }, [{ amount: 1500, kind: 'draw' }]);
    expect(r.balanceDue).toBe(-500);
    expect(r.settled).toBe(false);
  });

  it('a job is only finished when everybody on it is', () => {
    expect(rollUpCommissionStatus([])).toBe('open');
    expect(rollUpCommissionStatus([{ status: 'paid' }, { status: 'paid' }])).toBe('paid');
    expect(rollUpCommissionStatus([{ status: 'paid' }, { status: 'approved' }])).toBe('approved');
    // One rep paid and another still open is an open job, not a paid one.
    expect(rollUpCommissionStatus([{ status: 'paid' }, { status: 'open' }])).toBe('open');
    expect(rollUpCommissionStatus([{ status: 'approved' }, { status: 'approved' }])).toBe('approved');
    expect(rollUpCommissionStatus([{ status: 'denied' }, { status: 'denied' }])).toBe('denied');
    // A denied rep doesn't hold the job open for the one who is getting paid.
    expect(rollUpCommissionStatus([{ status: 'denied' }, { status: 'paid' }])).toBe('paid');
    expect(rollUpCommissionStatus([{ status: 'denied' }, { status: 'approved' }])).toBe('approved');
    expect(rollUpCommissionStatus([{ status: 'denied' }, { status: 'open' }])).toBe('open');
  });
});

describe('rolling a job up from its reps', () => {
  it('keeps null meaning "no pool yet" instead of turning it into zero', () => {
    // A record whose rep has not said where the lead came from has no overhead
    // rate, so no commission — recomputedColumns() writes nulls for exactly
    // this reason, and the roll-up must not then stamp 0.00 over them. The
    // payouts board's coalesce(balance_due, commission_amount) relies on it.
    expect(rollUpColumns(null, 0)).toEqual({ commissionAmount: null, advancesPaid: '0.00', balanceDue: null });
    expect(rollUpColumns(null, 250)).toEqual({ commissionAmount: null, advancesPaid: '250.00', balanceDue: null });
  });

  it('a pool that really is zero still reads as zero', () => {
    expect(rollUpColumns(0, 0)).toEqual({ commissionAmount: '0.00', advancesPaid: '0.00', balanceDue: '0.00' });
  });

  it('takes everything paid off the pool, and shows an overpay as negative', () => {
    expect(rollUpColumns(9050, 1533)).toEqual({ commissionAmount: '9050.00', advancesPaid: '1533.00', balanceDue: '7517.00' });
    expect(rollUpColumns(9050, 9050)).toEqual({ commissionAmount: '9050.00', advancesPaid: '9050.00', balanceDue: '0.00' });
    expect(rollUpColumns(1000, 1500).balanceDue).toBe('-500.00');
    // Float noise must not reach the column.
    expect(rollUpColumns(198.46024999999997, 0).commissionAmount).toBe('198.46');
  });
});
