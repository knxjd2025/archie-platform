import { describe, it, expect } from 'vitest';
import { applyDraft, isEmptyDraft } from '../draft';

const base = () => ({
  title: 'Roof Inspection',
  inspectorNotes: 'original notes',
  damageAnalysis: {
    aiSummary: 'The roof shows creasing.',
    photos: [
      { id: 'p1', url: 'https://cdn/1.jpg', caption: 'North', damages: [{ id: 'd1', label: 'Creased tabs', description: 'old desc' }], aiSummary: 'Analysis complete.' },
      { id: 'p2', url: 'https://cdn/2.jpg', caption: 'South', damages: [], aiSummary: 'Analysis complete.' },
    ],
  },
  repairEstimate: { lineItems: [{ repairName: 'Shingle repair', quantity: 2, unit: 'sq', finalCostPerUnit: 500, totalFinalCost: 1000 }], subtotal: 1000, total: 1000 },
});

describe('applyDraft', () => {
  it('is a no-op for an empty draft', () => {
    const out = applyDraft(base(), {});
    expect(out.changes).toEqual([]);
  });

  it('edits the title', () => {
    const out = applyDraft(base(), { title: 'Storm Damage Inspection' });
    expect(out.data.title).toBe('Storm Damage Inspection');
    expect(out.changes).toContain('title');
  });

  it('writes the summary where the report actually renders it', () => {
    // The document prints damageAnalysis.aiSummary. Writing only
    // `executiveSummary` reports success while the page is unchanged.
    const out = applyDraft(base(), { executiveSummary: 'Rewritten summary.' });
    expect(out.data.damageAnalysis.aiSummary).toBe('Rewritten summary.');
    expect(out.data.executiveSummary).toBe('Rewritten summary.');
  });

  it('edits a finding by id, leaving its severity alone', () => {
    const out = applyDraft(base(), { findings: { d1: { description: 'new desc' } } });
    const d = out.data.damageAnalysis.photos[0].damages[0];
    expect(d.description).toBe('new desc');
    expect(d.label).toBe('Creased tabs');
    expect(out.changes).toContain('1 finding');
  });

  it('ignores a finding id that is not on the report', () => {
    expect(applyDraft(base(), { findings: { nope: { label: 'x' } } }).changes).toEqual([]);
  });

  it('edits captions and swaps photos', () => {
    const out = applyDraft(base(), { photos: [{ id: 'p2', caption: 'South slope — granule loss' }] });
    expect(out.data.damageAnalysis.photos[1].caption).toBe('South slope — granule loss');
  });

  it('reports cleared findings when a photo is swapped', () => {
    const out = applyDraft(base(), { photos: [{ id: 'p1', url: 'https://cdn/new.jpg' }] });
    expect(out.clearedFindings).toEqual(['p1']);
    expect(out.data.damageAnalysis.photos[0].damages).toEqual([]);
  });

  it('replaces the estimate and reports the price movement', () => {
    // The rep is approving a change to what a customer pays — the old and new
    // totals are the part that must be visible before saving.
    const out = applyDraft(base(), { lines: [{ name: 'Full replacement', quantity: 30, unit: 'sq', unitPrice: 699.99 }] });
    expect(out.data.repairEstimate.total).toBe(20999.7);
    expect(out.changes.some((c) => c.includes('$1,000') && c.includes('$20,999.7'))).toBe(true);
  });

  it('applies several kinds of change in one pass', () => {
    const out = applyDraft(base(), {
      title: 'New title',
      executiveSummary: 'New summary.',
      photos: [{ id: 'p2', caption: 'Updated' }],
      lines: [{ name: 'Repair', quantity: 1, unit: 'ea', unitPrice: 250 }],
    });
    expect(out.changes.length).toBeGreaterThanOrEqual(4);
    expect(out.data.title).toBe('New title');
    expect(out.data.repairEstimate.total).toBe(250);
  });

  it('does not mutate the original report', () => {
    // Preview applies a draft to the stored data on every keystroke; mutating
    // it would corrupt the report without anyone saving.
    const original = base();
    applyDraft(original, { title: 'X', lines: [], photos: [{ id: 'p1', remove: true }] });
    expect(original.title).toBe('Roof Inspection');
    expect(original.damageAnalysis.photos).toHaveLength(2);
    expect(original.repairEstimate.total).toBe(1000);
  });

  it('distinguishes clearing a field from leaving it alone', () => {
    // undefined = untouched; empty string = the rep cleared it.
    expect(applyDraft(base(), {}).data.inspectorNotes).toBe('original notes');
    expect(applyDraft(base(), { inspectorNotes: '' }).data.inspectorNotes).toBe('');
  });

  it('survives a report with nothing on it', () => {
    const out = applyDraft({}, { title: 'X', lines: [{ name: 'A', unitPrice: 10 }] });
    expect(out.data.title).toBe('X');
    expect(out.data.repairEstimate.total).toBe(10);
  });
});

describe('isEmptyDraft', () => {
  it('knows when there is nothing to approve', () => {
    expect(isEmptyDraft(null)).toBe(true);
    expect(isEmptyDraft({})).toBe(true);
    expect(isEmptyDraft({ findings: {}, photos: [] })).toBe(true);
  });

  it('counts an empty line list as a real change', () => {
    // "Clear the estimate" is a deliberate edit, not an absent one.
    expect(isEmptyDraft({ lines: [] })).toBe(false);
  });

  it('spots each kind of change', () => {
    expect(isEmptyDraft({ title: 'x' })).toBe(false);
    expect(isEmptyDraft({ photos: [{ id: 'p1', caption: 'x' }] })).toBe(false);
    expect(isEmptyDraft({ findings: { d1: { label: 'x' } } })).toBe(false);
  });
});

describe('applyDraft — layout, photos, findings, tiers', () => {
  const rich = () => ({
    ...base(),
    replacementOptions: [
      { tier: 'good', product: { name: 'Landmark' }, squares: 30, ratePerSquare: 400, total: 12000 },
      { tier: 'better', product: { name: 'Landmark Pro' }, squares: 30, ratePerSquare: 450, total: 13500 },
      { tier: 'best', product: { name: 'Presidential' }, squares: 30, ratePerSquare: 600, total: 18000 },
    ],
    selectedTier: 'better',
    roofDetails: { squares: 30 },
  });

  it('saves a section layout and reports it', () => {
    const out = applyDraft(base(), { layout: { order: ['storm', 'photos'], hidden: ['age'] } });
    expect(out.data.layout).toEqual({ order: ['storm', 'photos'], hidden: ['age'] });
    expect(out.changes).toEqual(['section layout (1 hidden)']);
  });
  it('drops malformed layout keys and is a no-op when the layout is unchanged', () => {
    const first = applyDraft(base(), { layout: { order: ['a b', 'storm'] } });
    expect(first.data.layout).toEqual({ order: ['storm'] });
    expect(applyDraft(first.data, { layout: { order: ['storm'] } }).changes).toEqual([]);
  });
  it('clears the layout with null', () => {
    const withLayout = applyDraft(base(), { layout: { hidden: ['age'] } }).data;
    const out = applyDraft(withLayout, { layout: null });
    expect(out.data.layout).toBeNull();
    expect(out.changes).toEqual(['section layout']);
  });

  it('adds photos from the pool without findings, then orders them', () => {
    const out = applyDraft(base(), { addPhotos: [{ url: 'https://cdn/3.jpg', caption: 'Ridge' }, { url: 'https://cdn/1.jpg' }], photoOrder: ['p2'] });
    const ids = out.data.damageAnalysis.photos.map((p: any) => p.id);
    expect(ids[0]).toBe('p2');
    expect(ids).toHaveLength(3); // the duplicate of 1.jpg was ignored
    const added = out.data.damageAnalysis.photos.find((p: any) => p.url === 'https://cdn/3.jpg');
    expect(added.damages).toEqual([]);
    expect(added.caption).toBe('Ridge');
    expect(out.changes).toEqual(['added 1 photo', 'photo order']);
  });
  it('reports no change when the order is already right', () => {
    expect(applyDraft(base(), { photoOrder: ['p1', 'p2'] }).changes).toEqual([]);
  });

  it('removes a finding and reorders the rest', () => {
    const data = base();
    data.damageAnalysis.photos[0].damages.push({ id: 'd2', label: 'Granule loss', description: 'x' }, { id: 'd3', label: 'Lifted tab', description: 'y' });
    const out = applyDraft(data, { findings: { d1: { remove: true } }, findingOrder: { p1: ['d3'] } });
    expect(out.data.damageAnalysis.photos[0].damages.map((d: any) => d.id)).toEqual(['d3', 'd2']);
    expect(out.changes).toEqual(['removed 1 finding', 'finding order on 1 photo']);
  });

  it('re-prices a tier from rate and squares and changes the opening tier', () => {
    const out = applyDraft(rich(), { tiers: { selectedTier: 'best', rates: { good: { ratePerSquare: 420 }, best: { squares: 32 } } } });
    const [good, , best] = out.data.replacementOptions;
    expect(good.total).toBe(12600);
    expect(best.total).toBe(19200);
    expect(out.data.selectedTier).toBe('best');
    expect(out.changes).toEqual(['tier pricing (2 tiers)', 'opens on best']);
  });
  it('ignores a negative rate or a zero squares', () => {
    const out = applyDraft(rich(), { tiers: { rates: { good: { ratePerSquare: -5, squares: 0 } } } });
    expect(out.changes).toEqual([]);
  });
  it('treats the new fields as content for isEmptyDraft', () => {
    expect(isEmptyDraft({ layout: null })).toBe(false);
    expect(isEmptyDraft({ photoOrder: ['p1'] })).toBe(false);
    expect(isEmptyDraft({ tiers: { selectedTier: 'good' } })).toBe(false);
    expect(isEmptyDraft({ findingOrder: {} })).toBe(true);
  });
});
