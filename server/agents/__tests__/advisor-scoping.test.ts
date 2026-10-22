import { describe, it, expect } from 'vitest';
import { scopeInvoices } from '../team-agents';
import { viewerCanSeeLead } from '../sales-tools';
import { advisorRowDiffers } from '../team-advisors';

describe('scopeInvoices', () => {
  const invoices = [
    { id: '1', jobId: 'Lee Residence', amountDue: 1200 },
    { id: '2', jobId: 'Smith Roof', amountDue: 800 },
    { id: '3', jobId: ' lee residence ', amountDue: 50 },
  ];

  it('keeps everything, with the full total, for an unrestricted viewer', () => {
    expect(scopeInvoices(invoices, null)).toEqual({ invoices, totalDue: 2050 });
  });

  it('keeps only jobs in the viewer\'s book and re-totals them', () => {
    const r = scopeInvoices(invoices, new Set(['lee residence']));
    expect(r.invoices.map((i) => i.id)).toEqual(['1', '3']);
    expect(r.totalDue).toBe(1250);
  });

  it('shows nothing to a viewer with an empty book', () => {
    expect(scopeInvoices(invoices, new Set())).toEqual({ invoices: [], totalDue: 0 });
  });
});

// The no-session paths (no DB lookups): the voice agent passes repNames only.
describe('viewerCanSeeLead without a signed-in session', () => {
  const lead = { externalId: 'job1', jtSalesRep: 'Riley Carter' };

  it('denies when there is no viewer at all', async () => {
    expect(await viewerCanSeeLead(undefined, lead)).toBe(false);
  });

  it('allows an unrestricted viewer', async () => {
    expect(await viewerCanSeeLead({ repNames: null }, lead)).toBe(true);
  });

  it('allows only the viewer\'s own reps otherwise', async () => {
    expect(await viewerCanSeeLead({ repNames: ['riley carter'] }, lead)).toBe(true);
    expect(await viewerCanSeeLead({ repNames: ['morgan lee'] }, lead)).toBe(false);
    expect(await viewerCanSeeLead({ repNames: ['riley carter'] }, { externalId: 'x', jtSalesRep: null })).toBe(false);
  });
});

describe('advisorRowDiffers', () => {
  const def = { name: 'Sam', title: 'Sales Manager', avatar: '📈', persona: 'p', systemPrompt: 's', tools: ['a', 'b'], status: 'active' };

  it('is false for an identical row, so cold starts skip the write', () => {
    expect(advisorRowDiffers({ ...def, tools: ['a', 'b'] }, def)).toBe(false);
  });

  it('is true when any synced field changed', () => {
    expect(advisorRowDiffers({ ...def, systemPrompt: 'old' }, def)).toBe(true);
    expect(advisorRowDiffers({ ...def, tools: ['a'] }, def)).toBe(true);
    expect(advisorRowDiffers({ ...def, status: 'paused' }, def)).toBe(true);
    expect(advisorRowDiffers({ ...def, avatar: null }, def)).toBe(true);
  });
});
