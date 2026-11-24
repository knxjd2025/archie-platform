import { describe, expect, it } from 'vitest';
import { listPath, pagingText, rowView, statusOptions, KIND_FILTERS, type ReportRow } from '../list-view';
import { ALL_ROLES, type TeamRole } from '../../../../shared/rbac';

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  id: '11111111-1111-4111-8111-111111111111', title: null, address: '12 Elm Street', city: 'Cedar Falls', status: 'ready', problem: null,
  reportTypes: ['inspection', 'storm'], template: 'full', createdAt: '2026-11-18T15:00:00.000Z', customerName: 'Dana Whitfield',
  jobExternalId: null, totalEstimate: 8400, ...over,
});

describe('asking the server for the list', () => {
  it('sends only what was chosen, newest first being the server\'s own order', () => {
    expect(listPath({ search: '', kind: '', status: '', page: 1 })).toBe('/api/roof-reports');
    expect(listPath({ search: ' Elm ', kind: 'storm', status: 'ready', page: 3 })).toBe('/api/roof-reports?search=Elm&kind=storm&status=ready&page=3');
    expect(listPath({ search: 'a&b=c', kind: '', status: '', page: 1 })).toBe('/api/roof-reports?search=a%26b%3Dc');
  });

  it('never asks for a page below one', () => {
    expect(listPath({ search: '', kind: '', status: '', page: 0 })).toBe('/api/roof-reports');
    expect(listPath({ search: '', kind: '', status: '', page: -4 })).toBe('/api/roof-reports');
    expect(listPath({ search: '', kind: '', status: '', page: 2.7 })).toBe('/api/roof-reports?page=2');
  });

  it('offers the kinds the server knows, in plain words', () => {
    expect(KIND_FILTERS.map((k) => k.label)).toEqual(['All kinds', 'Inspection', 'Measurements', 'Storm history']);
  });
});

describe('the status filter', () => {
  it('offers Archived only to a role that sees archived reports', () => {
    for (const role of ALL_ROLES as TeamRole[]) {
      const labels = statusOptions(role).map((o) => o.label);
      expect(labels.slice(0, 4), role).toEqual(['All', 'Being made', 'Ready', 'Could not finish']);
      expect(labels.includes('Archived'), role).toBe(role === 'admin' || role === 'sales_director' || role === 'customer_service');
    }
  });
});

describe('one row of the list', () => {
  it('shows the address, customer, kinds, status and date', () => {
    const v = rowView(row(), 'admin');
    expect(v).toMatchObject({
      headline: '12 Elm Street', place: 'Cedar Falls', customer: 'Dana Whitfield', kinds: 'Inspection, Storm history',
      statusLabel: 'Ready', date: 'Nov 18, 2026', note: null,
    });
  });

  it('says plainly when nobody is named and when there is no city', () => {
    const v = rowView(row({ customerName: null, city: null }), 'admin');
    expect(v.customer).toBe('No customer named');
    expect(v.place).toBe('');
  });

  it('opens only a ready report, and archives only one that is finished or failed, as the access table allows', () => {
    expect(rowView(row({ status: 'ready' }), 'admin')).toMatchObject({ canOpen: true, canArchive: true });
    expect(rowView(row({ status: 'failed' }), 'admin')).toMatchObject({ canOpen: false, canArchive: true });
    expect(rowView(row({ status: 'generating' }), 'admin')).toMatchObject({ canOpen: false, canArchive: false });
    expect(rowView(row({ status: 'archived' }), 'admin')).toMatchObject({ canOpen: false, canArchive: false });
  });

  it('gives crew no actions at all (the server shows them nothing anyway)', () => {
    expect(rowView(row(), 'production')).toMatchObject({ canOpen: false, canArchive: false });
  });

  it('gives a sales rep and a sales leader the actions their rows allow', () => {
    expect(rowView(row(), 'sales')).toMatchObject({ canOpen: true, canArchive: true });
    expect(rowView(row(), 'manager')).toMatchObject({ canOpen: true, canArchive: true });
  });

  it('explains a report still being made and one that could not finish, in a plain sentence', () => {
    expect(rowView(row({ status: 'generating' }), 'admin').note).toBe('Still being made. This takes a minute or two.');
    expect(rowView(row({ status: 'failed', problem: 'We couldn\'t find that address on the map. Check the street, city and ZIP.' }), 'admin').note)
      .toBe('We couldn\'t find that address on the map. Check the street, city and ZIP.');
    expect(rowView(row({ status: 'failed', problem: null }), 'admin').note).toBe('The report could not be finished.');
    expect(rowView(row({ status: 'failed', problem: 'ECONNRESET {"code":500}' }), 'admin').note).toBe('The report could not be finished.');
  });

  it('picks a tone for each status so the badge is not the only signal', () => {
    expect(rowView(row({ status: 'ready' }), 'admin').tone).toBe('good');
    expect(rowView(row({ status: 'generating' }), 'admin').tone).toBe('busy');
    expect(rowView(row({ status: 'failed' }), 'admin').tone).toBe('bad');
    expect(rowView(row({ status: 'archived' }), 'admin').tone).toBe('quiet');
  });

  it('builds the address of the report page from the id only', () => {
    expect(rowView(row(), 'admin').openHref).toBe('/api/roof-reports/11111111-1111-4111-8111-111111111111/html');
  });
});

describe('paging', () => {
  it('says which rows are on the page', () => {
    expect(pagingText({ page: 1, pageSize: 25, total: 90 })).toBe('Showing 1 to 25 of 90');
    expect(pagingText({ page: 2, pageSize: 25, total: 90 })).toBe('Showing 26 to 50 of 90');
    expect(pagingText({ page: 4, pageSize: 25, total: 90 })).toBe('Showing 76 to 90 of 90');
    expect(pagingText({ page: 1, pageSize: 25, total: 1 })).toBe('Showing 1 of 1');
    expect(pagingText({ page: 1, pageSize: 25, total: 0 })).toBe('');
  });
});

describe('which reports can be picked for a comparison', () => {
  const r = (status: string) => ({ id: '11111111-1111-4111-8111-111111111111', title: null, address: '12 Elm Street', city: 'Cedar Falls', status, problem: null, reportTypes: ['inspection'], template: 'full', createdAt: '2026-11-18T15:00:00.000Z', customerName: null, jobExternalId: null, totalEstimate: null });
  it('is a finished report, for a role that may see reports', () => {
    expect(rowView(r('ready'), 'admin').canCompare).toBe(true);
    expect(rowView(r('ready'), 'sales').canCompare).toBe(true);
    for (const status of ['generating', 'failed', 'archived']) expect(rowView(r(status), 'admin').canCompare, status).toBe(false);
    expect(rowView(r('ready'), 'production').canCompare).toBe(false);
  });
});
