import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportListView, type ReportListViewProps } from '../ReportList';
import type { ReportRow } from '../list-view';

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  id: '11111111-1111-4111-8111-111111111111', title: null, address: '12 Elm Street', city: 'Cedar Falls', status: 'ready', problem: null,
  reportTypes: ['inspection'], template: 'full', createdAt: '2026-11-18T15:00:00.000Z', customerName: 'Dana Whitfield',
  jobExternalId: null, totalEstimate: null, ...over,
});

const base = (over: Partial<ReportListViewProps> = {}): ReportListViewProps => ({
  role: 'admin', filters: { search: '', kind: '', status: '', page: 1 }, reports: [row()], paging: { page: 1, pageSize: 25, total: 1, hasMore: false },
  phase: 'ready', loadError: null, busyIds: {}, confirmId: null, rowErrors: {},
  selected: [], onToggleSelect: () => {}, onCompare: () => {},
  onSearch: () => {}, onKind: () => {}, onStatus: () => {}, onPage: () => {}, onRetry: () => {},
  onOpen: () => {}, onAskArchive: () => {}, onCancelArchive: () => {}, onArchive: () => {}, ...over,
});
const html = (over: Partial<ReportListViewProps> = {}) => renderToStaticMarkup(createElement(ReportListView, base(over)));

describe('the list of roof reports', () => {
  it('shows each report\'s address, customer, kind, status and date, with Open and Archive', () => {
    const h = html();
    for (const word of ['12 Elm Street', 'Cedar Falls', 'Dana Whitfield', 'Inspection', 'Ready', 'Nov 18, 2026', 'Open', 'Archive']) expect(h).toContain(word);
    // Open is a button that opens the editor here, not a link to the page in a new tab.
    expect(h).not.toContain('/html"');
    expect(h).not.toContain('target="_blank"');
  });

  it('labels every control for a screen reader, including which report a button is about', () => {
    const h = html();
    expect(h).toContain('aria-label="Search reports"');
    expect(h).toContain('>Status<');
    expect(h).toContain('>Kind<');
    expect(h).toContain('aria-label="Open the report for 12 Elm Street"');
    expect(h).toContain('aria-label="Archive the report for 12 Elm Street"');
    expect(h).not.toMatch(/<input(?![^>]*(aria-label|id=))[^>]*>/);
  });

  it('says there are none yet, and what to do', () => {
    const h = html({ reports: [], paging: { page: 1, pageSize: 25, total: 0, hasMore: false } });
    expect(h).toContain('No roof reports yet.');
    expect(h).toContain('Make one from an address, with or without photos.');
  });

  it('says a search found nothing, in different words from "none yet"', () => {
    const h = html({ reports: [], filters: { search: 'oak', kind: '', status: '', page: 1 }, paging: { page: 1, pageSize: 25, total: 0, hasMore: false } });
    expect(h).toContain('No reports match that search.');
    expect(h).not.toContain('No roof reports yet.');
  });

  it('shows placeholder rows only for the very first load, never a full page spinner', () => {
    const h = html({ phase: 'first', reports: [] });
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain('animate-pulse');
    expect(h).not.toContain('No roof reports yet.');
  });

  it('keeps the old rows, dimmed and marked busy, while a new page loads', () => {
    const h = html({ phase: 'reloading' });
    expect(h).toContain('12 Elm Street');
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain('opacity-60');
  });

  it('says the list could not load in a plain sentence, with a way to try again', () => {
    const h = html({ phase: 'failed', reports: [], loadError: 'The reports could not be loaded. Please try again.' });
    expect(h).toContain('The reports could not be loaded. Please try again.');
    expect(h).toContain('Try again');
  });

  it('dims the row at once and says Archiving... while the archive is waiting', () => {
    const h = html({ busyIds: { '11111111-1111-4111-8111-111111111111': true } });
    expect(h).toContain('Archiving...');
    expect(h).toContain('opacity-50');
    expect(h).toContain('aria-busy="true"');
    // Nothing on the row can be pressed twice.
    expect(h).not.toContain('aria-label="Archive the report for 12 Elm Street"');
  });

  it('asks before archiving, because there is no way to take it back here', () => {
    const h = html({ confirmId: '11111111-1111-4111-8111-111111111111' });
    expect(h).toContain('Archive this report? It leaves this list and can&#x27;t be opened again here.');
    expect(h).toContain('Yes, archive');
    expect(h).toContain('Keep it');
  });

  it('shows a failed archive as a plain sentence on that row', () => {
    const h = html({ rowErrors: { '11111111-1111-4111-8111-111111111111': 'The report could not be archived. Please try again.' } });
    expect(h).toContain('The report could not be archived. Please try again.');
    expect(h).toContain('role="alert"');
  });

  it('offers no Archive while a report is still being made, and no Open until it is ready', () => {
    const h = html({ reports: [row({ status: 'generating' })] });
    expect(h).toContain('Still being made. This takes a minute or two.');
    expect(h).not.toContain('>Open<');
    expect(h).not.toContain('>Archive<');
  });

  it('offers the Archived filter only to a role that may see archived reports', () => {
    expect(html({ role: 'admin' })).toContain('>Archived<');
    expect(html({ role: 'sales' })).not.toContain('>Archived<');
  });

  it('pages: says which rows, and disables Previous on the first page and Next on the last', () => {
    const h = html({ reports: [row()], paging: { page: 1, pageSize: 25, total: 60, hasMore: true } });
    expect(h).toContain('Showing 1 to 25 of 60');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Previous page<\/button>/);
    expect(h).not.toMatch(/<button[^>]*disabled=""[^>]*>Next page<\/button>/);
    const last = html({ paging: { page: 3, pageSize: 25, total: 60, hasMore: false } });
    expect(last).toMatch(/<button[^>]*disabled=""[^>]*>Next page<\/button>/);
  });

  it('shows a visible focus ring on what can be pressed', () => {
    expect(html()).toContain('focus-visible:ring-2');
  });

  it('uses no long dash, sparkle or wand', () => {
    expect(html()).not.toMatch(/\u2014|✨|🪄/u);
  });
});
