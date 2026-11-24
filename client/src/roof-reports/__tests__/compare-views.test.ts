import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComparisonView, type ComparisonViewProps } from '../Comparison';
import { ReportListView, type ReportListViewProps } from '../ReportList';
import { buildComparison } from '../compare-model';
import type { ReportRow } from '../list-view';
import type { ReportSummary } from '../../../../shared/roof-reports';
import { COMPARE_NOT_FOUND } from '../../../../shared/roof-reports';

const noop = () => {};
const s = (over: Partial<ReportSummary> = {}): ReportSummary => ({
  id: '11111111-1111-4111-8111-111111111111', title: null, address: '12 Elm Street', city: 'Cedar Falls', createdAt: '2026-11-18T15:00:00.000Z',
  condition: { score: 72, grade: 'C', severity: 'medium' }, findings: [{ title: 'Missing shingles', severity: 'high' }],
  storm: { events: 15, hail: 8, wind: 7, largestHailInches: 1.5, risk: 'medium', claimPotential: 'medium' }, cost: 340,
  measurements: { squares: 24, pitch: '6/12', stories: 2, material: 'asphalt_shingle', ageYears: 12 }, ...over,
});
const comparison = buildComparison(s(), s({ id: '22222222-2222-4222-8222-222222222222', address: '40 Birch Lane', condition: { score: 44, grade: 'D', severity: 'high' }, cost: 9000 }));
const view = (over: Partial<ComparisonViewProps> = {}) => renderToStaticMarkup(createElement(ComparisonView, { phase: 'ready', comparison, message: null, onBack: noop, onRetry: noop, ...over }));

describe('the comparison screen', () => {
  it('shows both reports in columns with their address and date, a row for each fact, and the words for each difference', () => {
    const h = view();
    for (const w of ['Compare two reports', 'Report A', 'Report B', '12 Elm Street, Cedar Falls', '40 Birch Lane, Cedar Falls', 'Nov 18, 2026',
      'Condition score', '72 out of 100', '44 out of 100', 'Report A is higher by 28 points', 'Estimated repair cost', '$9,000', 'Report B is higher by $8,660', 'Same', 'Back to reports']) expect(h, w).toContain(w);
    // A real table, with headers a screen reader can read, and the note is a column of its own, not a colour.
    expect(h).toContain('<table');
    expect(h).toContain('scope="col"');
    expect(h).toContain('scope="row"');
    expect(h).toContain('>What differs<');
  });

  it('shows the findings in both, only in one, and only in the other', () => {
    const h = view();
    expect(h).toContain('In both');
    expect(h).toContain('Only in report A');
    expect(h).toContain('Only in report B');
  });

  it('says it is looking the moment it starts', () => {
    const h = view({ phase: 'loading', comparison: null });
    expect(h).toContain('Comparing the two reports...');
    expect(h).toContain('role="status"');
    expect(h).not.toContain('<table');
  });

  it('says plainly when one report could not be found, and shows nothing of either', () => {
    const h = view({ phase: 'notfound', comparison: null, message: COMPARE_NOT_FOUND });
    expect(h).toContain(COMPARE_NOT_FOUND);
    expect(h).toContain('role="alert"');
    expect(h).toContain('Back to reports');
    expect(h).not.toContain('<table');
    expect(h).not.toContain('Try again');
  });

  it('offers to try again when the comparison failed for another reason', () => {
    const h = view({ phase: 'failed', comparison: null, message: 'The reports could not be compared. Please try again.' });
    expect(h).toContain('The reports could not be compared. Please try again.');
    expect(h).toContain('Try again');
    expect(h).not.toContain('<table');
  });

  it('uses no long dash, no sparkle and no wand', () => {
    expect(view()).not.toMatch(/—|✨|🪄|sparkle/iu);
  });
});

const row = (id: string, over: Partial<ReportRow> = {}): ReportRow => ({
  id, title: null, address: `${id.slice(0, 2)} Elm Street`, city: 'Cedar Falls', status: 'ready', problem: null, reportTypes: ['inspection'], template: 'full',
  createdAt: '2026-11-18T15:00:00.000Z', customerName: 'Dana Whitfield', jobExternalId: null, totalEstimate: null, ...over,
});
const list = (over: Partial<ReportListViewProps> = {}) => renderToStaticMarkup(createElement(ReportListView, {
  role: 'admin', filters: { search: '', kind: '', status: '', page: 1 },
  reports: [row('11111111-1111-4111-8111-111111111111'), row('22222222-2222-4222-8222-222222222222', { status: 'generating' }), row('33333333-3333-4333-8333-333333333333')],
  paging: { page: 1, pageSize: 25, total: 3, hasMore: false }, phase: 'ready', loadError: null, busyIds: {}, confirmId: null, rowErrors: {},
  selected: [], onToggleSelect: noop, onCompare: noop,
  onSearch: noop, onKind: noop, onStatus: noop, onPage: noop, onRetry: noop, onOpen: noop, onAskArchive: noop, onCancelArchive: noop, onArchive: noop, ...over,
}));

describe('picking two reports in the list', () => {
  it('has a labelled checkbox on each finished report only, and a Compare button that waits for two', () => {
    const h = list();
    expect(h.match(/type="checkbox"/g)).toHaveLength(2);
    expect(h).toContain('aria-label="Pick the report for 11 Elm Street to compare"');
    expect(h).toContain('Pick two finished reports to compare them.');
    expect(h).toMatch(/<button[^>]*disabled[^>]*>Compare<\/button>|<button[^>]*>Compare<\/button>/);
    expect(h).toMatch(/disabled=""[^>]*>Compare</);
  });

  it('asks for one more after one pick, and turns Compare on after two', () => {
    const one = list({ selected: ['11111111-1111-4111-8111-111111111111'] });
    expect(one).toContain('Pick one more report to compare.');
    expect(one).toMatch(/disabled=""[^>]*>Compare</);
    const two = list({ selected: ['11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333'] });
    expect(two).toContain('Two reports picked.');
    expect(two).not.toMatch(/disabled=""[^>]*>Compare</);
    // With two picked, the other boxes wait.
    expect(two).toContain('checked=""');
  });
});
