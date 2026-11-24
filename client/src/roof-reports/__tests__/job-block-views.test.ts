import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JobReportsView, jobBlockPhase, type JobReportsViewProps } from '../JobRoofReports';
import type { ReportRow } from '../list-view';
import { NOT_FOUND } from '../../../../shared/roof-reports';

const BANNED = new RegExp(`${String.fromCharCode(0x2014)}|✨|🪄`, 'u');
const noop = () => {};
const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  id: '11111111-1111-4111-8111-111111111111', title: null, address: '12 Elm Street', city: 'Cedar Falls', status: 'ready', problem: null,
  reportTypes: ['inspection', 'storm'], template: 'full', createdAt: '2026-11-18T15:00:00.000Z', customerName: 'Dana Whitfield', jobExternalId: 'job-77', totalEstimate: null, ...over,
});
const view = (over: Partial<JobReportsViewProps> = {}) => renderToStaticMarkup(createElement(JobReportsView, {
  role: 'admin', phase: 'ready', reports: [row()], error: null, onMake: noop, onOpen: noop, onRetry: noop, ...over,
}));

describe('what the job page decides about the roof report block', () => {
  it('asks nothing while the app has not said roof reports are on for this person, and draws nothing', () => {
    expect(jobBlockPhase({ allowed: false, answer: 'none' })).toBe('hidden');
    expect(jobBlockPhase({ allowed: false, answer: 'ok' })).toBe('hidden');
  });
  it('shows the block only once the server has answered for this job', () => {
    expect(jobBlockPhase({ allowed: true, answer: 'none' })).toBe('looking');
    expect(jobBlockPhase({ allowed: true, answer: 'ok' })).toBe('ready');
  });
  it('hides the block when the server says this job\'s reports are not the person\'s to see, and says a plain sentence for any other failure', () => {
    expect(jobBlockPhase({ allowed: true, answer: 'error', message: NOT_FOUND })).toBe('hidden');
    expect(jobBlockPhase({ allowed: true, answer: 'error', message: 'HTTP 500' })).toBe('failed');
  });
});

describe('the roof report block on a job', () => {
  it('has its own title, so it is not mistaken for the older Roof reports block', () => {
    const h = view();
    expect(h).toContain('Roof inspection reports');
    expect(h).toContain('Inspections, measurements and storm history made from this job&#x27;s address.');
  });

  it('lists this job\'s reports with their address, kinds, status and date, each with an Open that names the report', () => {
    const h = view();
    for (const word of ['12 Elm Street', 'Inspection, Storm history', 'Ready', 'Nov 18, 2026']) expect(h).toContain(word);
    expect(h).toContain('aria-label="Open the report for 12 Elm Street"');
  });

  it('offers Make a roof report to a role that may make one, and not to one that may not', () => {
    expect(view()).toContain('Make a roof report');
    expect(view({ role: 'production' })).not.toContain('Make a roof report');
  });

  it('says there are none yet', () => {
    expect(view({ reports: [] })).toContain('No roof reports for this job yet.');
  });

  it('shows a report still being made without an Open, as Being made', () => {
    const h = view({ reports: [row({ status: 'generating' })] });
    expect(h).toContain('Being made');
    expect(h).not.toContain('>Open<');
  });

  it('shows that it is looking, on the block itself', () => {
    const h = view({ phase: 'looking', reports: [] });
    expect(h).toContain('Looking...');
    expect(h).toContain('aria-busy="true"');
  });

  it('says in a plain sentence when the reports could not be loaded, with Try again', () => {
    const h = view({ phase: 'failed', error: 'The roof reports could not be loaded. Please try again.' });
    expect(h).toContain('The roof reports could not be loaded. Please try again.');
    expect(h).toContain('>Try again<');
  });

  it('draws nothing at all when hidden', () => {
    expect(view({ phase: 'hidden' })).toBe('');
  });

  it('has a focus ring on its buttons and uses no long dash, sparkle or wand', () => {
    const h = view();
    expect(h).toContain('focus-visible:ring-2');
    expect(h).not.toMatch(BANNED);
  });
});
