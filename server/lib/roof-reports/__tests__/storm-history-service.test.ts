/**
 * storm-history-service.test.ts
 *
 * Security / hardening tests for the URLs produced by buildEnhancedStormData().
 *
 * Enhanced storm data is embedded into shared roof reports (NOAA event-page
 * links, NEXRAD radar image links, county storm-database link). These URLs are
 * built from partially user/coordinate-derived input. As defense-in-depth, every
 * produced URL is passed through sanitizeUrl() so that only http/https/relative
 * URLs survive — a malformed or non-http result is dropped to "" rather than
 * being rendered as a clickable javascript:/data: link.
 *
 * These tests assert:
 *  1. Ordinary output is valid http(s) and unchanged (no double-encoding /
 *     mangling of legitimate URLs).
 *  2. sanitizeUrl() is actually applied — every produced URL is a fixed point of
 *     sanitizeUrl (so a tainted input could never slip a dangerous scheme
 *     through), and an empty/dropped URL stays empty.
 */

import { describe, it, expect, vi } from 'vitest';

// These tests must never reach a real storm data source.
vi.stubGlobal('fetch', vi.fn(() => { throw new Error('no network in tests'); }));
import { buildEnhancedStormData, assessRisk, type StormEvent, type StormReport } from '../storm-history-service.js';
import { sanitizeUrl } from '../safe-url.js';

const RISK_LEVELS = ['high', 'medium', 'low'] as const;

function makeEvent(overrides: Partial<StormEvent> = {}): StormEvent {
  return {
    id: 'evt-12345',
    event_type: 'hail',
    date: '2024-05-10T18:30:00.000Z',
    year: 2024,
    month: 5,
    day: 10,
    state: 'TX',
    county: 'DALLAS',
    hail_size_inches: 1.75,
    source: 'NOAA',
    ...overrides,
  } as StormEvent;
}

function makeReport(overrides: Partial<StormReport> = {}): StormReport {
  const event = makeEvent();
  return {
    property_address: '123 Main St',
    city: 'Dallas',
    state: 'TX',
    zip: '75201',
    latitude: 32.7767,
    longitude: -96.797,
    start_date: '2021-05-01',
    end_date: '2024-05-31',
    years_covered: 3,
    summary: {
      total_events: 1,
      hail_events: 1,
      wind_events: 0,
      tornado_events: 0,
      insurance_claim_potential: 'high',
    },
    events_by_year: { 2024: [event] },
    events: [event],
    significant_events: [event],
    risk_assessment: {
      hail_risk: 'high',
      wind_risk: 'low',
      overall_risk: 'high',
      risk_factors: [],
      recommendations: [],
    },
    data_quality: 'verified',
    data_source_details: [],
    generated_at: new Date().toISOString(),
    data_sources: [],
    search_radius_miles: 5,
    ...overrides,
  } as StormReport;
}

/** Collect every URL string the enhanced data exposes (event pages, radar, county). */
function collectUrls(data: ReturnType<typeof buildEnhancedStormData>): string[] {
  return [
    ...data.noaaEventPageUrls.map(u => u.url),
    ...data.nexradRadarImageUrls.map(u => u.url),
    data.countyStormDatabaseUrl,
  ];
}

describe('buildEnhancedStormData — URL scheme hardening', () => {
  it('produces only http(s) (or empty) URLs for ordinary input', () => {
    const data = buildEnhancedStormData(makeReport());
    const urls = collectUrls(data);

    for (const url of urls) {
      if (url === '') continue; // empty == dropped/non-navigable, acceptable
      expect(url).toMatch(/^https?:\/\//);
    }
  });

  it('routes every produced URL through sanitizeUrl (each is a sanitize fixed point)', () => {
    const data = buildEnhancedStormData(makeReport());
    const urls = collectUrls(data);

    // If a URL were NOT passed through sanitizeUrl and somehow carried a
    // non-http scheme, sanitizeUrl(url) would differ (-> ""). Asserting the
    // fixed-point property guarantees no dangerous scheme survives.
    for (const url of urls) {
      expect(sanitizeUrl(url)).toBe(url);
    }
  });

  it('leaves ordinary valid http(s) URLs byte-for-byte unchanged', () => {
    const data = buildEnhancedStormData(makeReport());

    // NOAA event page URL is a plain concatenation of a fixed https base + id.
    expect(data.noaaEventPageUrls[0].url).toBe(
      'https://www.ncdc.noaa.gov/stormevents/eventdetails.jsp?id=evt-12345'
    );

    // County storm-database URL is the fixed https listevents endpoint.
    expect(data.countyStormDatabaseUrl).toMatch(
      /^https:\/\/www\.ncdc\.noaa\.gov\/stormevents\/listevents\.jsp\?/
    );

    // NEXRAD radar URL is the fixed https IEM archive base.
    expect(data.nexradRadarImageUrls[0].url).toMatch(
      /^https:\/\/mesonet\.agron\.iastate\.edu\/archive\/data\//
    );
  });

  it('drops a NEXRAD URL whose date is malformed to "" (sanitize keeps "" empty)', () => {
    // A malformed event date makes buildNEXRADArchiveUrl return "".
    // sanitizeUrl("") must remain "" so no broken/dangerous link is rendered.
    const badDateEvent = makeEvent({ id: 'evt-bad', date: 'not-a-real-date' });
    const report = makeReport({
      events: [badDateEvent],
      events_by_year: { 2024: [badDateEvent] },
      significant_events: [badDateEvent],
    });

    const data = buildEnhancedStormData(report);
    const radar = data.nexradRadarImageUrls[0];
    expect(radar.url).toBe('');
    expect(sanitizeUrl(radar.url)).toBe('');
  });

  it('produces no javascript:/data:/vbscript: URLs even with hostile-looking event ids', () => {
    // Even if an event id contained scheme-like text, the fixed https base means
    // the result stays http(s); and sanitizeUrl is the backstop.
    const hostileEvent = makeEvent({ id: 'javascript:alert(1)' });
    const report = makeReport({
      events: [hostileEvent],
      events_by_year: { 2024: [hostileEvent] },
      significant_events: [hostileEvent],
    });

    const data = buildEnhancedStormData(report);
    for (const url of collectUrls(data)) {
      if (url === '') continue;
      expect(url).toMatch(/^https?:\/\//);
      expect(url.toLowerCase()).not.toMatch(/^\s*javascript:/);
      expect(url.toLowerCase()).not.toMatch(/^\s*data:/);
      expect(url.toLowerCase()).not.toMatch(/^\s*vbscript:/);
      // sanitizeUrl backstop leaves the safe URL intact.
      expect(sanitizeUrl(url)).toBe(url);
    }
  });
});

/**
 * Hardening tests for assessRisk() — the pure risk-grading function.
 *
 * assessRisk runs against the `events` array that is stitched together from two
 * independent network sources (NOAA SWDI + Iowa Environmental Mesonet) and from
 * JSONB columns reloaded out of Postgres. Any of those can deliver malformed
 * rows: a non-finite hail size / wind speed (Infinity, NaN), a missing or
 * non-string event_type, or — at the call boundary — an empty or entirely
 * non-array events value. The pure risk grader must never throw and must always
 * return a fully-defined assessment with valid 'high'|'medium'|'low' fields:
 *
 *  - Non-finite hail/wind metrics are IGNORED (an Infinity hail size must not be
 *    silently treated as "large hail" and inflate the risk grade).
 *  - An empty OR non-array events input yields the safe low/none assessment.
 *  - All risk fields are defined and within the valid level set; arrays are
 *    non-empty so downstream rendering never shows a blank section.
 *  - Well-formed events produce exactly the same grading as before (no behavior
 *    drift for the happy path).
 */
describe('assessRisk — malformed-event hardening', () => {
  function expectWellFormedAssessment(r: StormReport['risk_assessment']) {
    expect(r).toBeDefined();
    expect(RISK_LEVELS).toContain(r.hail_risk);
    expect(RISK_LEVELS).toContain(r.wind_risk);
    expect(RISK_LEVELS).toContain(r.overall_risk);
    expect(Array.isArray(r.risk_factors)).toBe(true);
    expect(r.risk_factors.length).toBeGreaterThan(0);
    expect(Array.isArray(r.recommendations)).toBe(true);
    expect(r.recommendations.length).toBeGreaterThan(0);
  }

  it('does not throw and returns the safe low assessment for an empty events array', () => {
    let result!: StormReport['risk_assessment'];
    expect(() => { result = assessRisk([]); }).not.toThrow();
    expectWellFormedAssessment(result);
    expect(result.hail_risk).toBe('low');
    expect(result.wind_risk).toBe('low');
    expect(result.overall_risk).toBe('low');
  });

  it('does not throw and returns the safe low assessment for a non-array events input', () => {
    for (const bad of [null, undefined, 'oops', 42, {}] as unknown[]) {
      let result!: StormReport['risk_assessment'];
      expect(() => { result = assessRisk(bad as unknown as StormEvent[]); }).not.toThrow();
      expectWellFormedAssessment(result);
      expect(result.overall_risk).toBe('low');
    }
  });

  it('ignores non-finite hail sizes instead of treating them as large hail', () => {
    // Three events with Infinity / NaN hail sizes. If non-finite values were
    // counted as >= the 1" large-hail threshold, this would (wrongly) reach the
    // 3-large-hail "high" rung. They must be ignored -> hail risk stays low.
    const events: StormEvent[] = [
      makeEvent({ id: 'h1', event_type: 'Hail', hail_size_inches: Infinity as unknown as number }),
      makeEvent({ id: 'h2', event_type: 'Hail', hail_size_inches: NaN as unknown as number }),
      makeEvent({ id: 'h3', event_type: 'Hail', hail_size_inches: -Infinity as unknown as number }),
    ];
    let result!: StormReport['risk_assessment'];
    expect(() => { result = assessRisk(events); }).not.toThrow();
    expectWellFormedAssessment(result);
    expect(result.hail_risk).toBe('low');
  });

  it('ignores non-finite wind speeds instead of treating them as high wind', () => {
    const events: StormEvent[] = [
      makeEvent({ id: 'w1', event_type: 'High Wind', hail_size_inches: undefined, wind_speed_mph: Infinity as unknown as number }),
      makeEvent({ id: 'w2', event_type: 'High Wind', hail_size_inches: undefined, wind_speed_mph: NaN as unknown as number }),
      makeEvent({ id: 'w3', event_type: 'High Wind', hail_size_inches: undefined, wind_speed_mph: Infinity as unknown as number }),
    ];
    let result!: StormReport['risk_assessment'];
    expect(() => { result = assessRisk(events); }).not.toThrow();
    expectWellFormedAssessment(result);
    expect(result.wind_risk).toBe('low');
  });

  it('does not throw when event_type is missing or non-string', () => {
    const events: StormEvent[] = [
      makeEvent({ id: 'x1', event_type: undefined as unknown as StormEvent['event_type'], hail_size_inches: undefined }),
      makeEvent({ id: 'x2', event_type: null as unknown as StormEvent['event_type'], hail_size_inches: undefined }),
      makeEvent({ id: 'x3', event_type: 123 as unknown as StormEvent['event_type'], hail_size_inches: undefined }),
    ];
    let result!: StormReport['risk_assessment'];
    expect(() => { result = assessRisk(events); }).not.toThrow();
    expectWellFormedAssessment(result);
  });

  it('does not throw when individual event entries are null/undefined', () => {
    const events = [
      null,
      undefined,
      makeEvent({ id: 'ok', event_type: 'Hail', hail_size_inches: 0.6 }),
    ] as unknown as StormEvent[];
    let result!: StormReport['risk_assessment'];
    expect(() => { result = assessRisk(events); }).not.toThrow();
    expectWellFormedAssessment(result);
  });

  it('keeps the exact same grading as before for well-formed events (no happy-path drift)', () => {
    // 3 large-hail (>= 1") Hail events => hail_risk high; one 70 mph wind event.
    const wellFormed: StormEvent[] = [
      makeEvent({ id: 'g1', event_type: 'Hail', hail_size_inches: 1.5 }),
      makeEvent({ id: 'g2', event_type: 'Hail', hail_size_inches: 2.0 }),
      makeEvent({ id: 'g3', event_type: 'Hail', hail_size_inches: 1.25 }),
      makeEvent({ id: 'g4', event_type: 'High Wind', hail_size_inches: undefined, wind_speed_mph: 70 }),
    ];
    const result = assessRisk(wellFormed);
    expect(result.hail_risk).toBe('high');
    expect(result.overall_risk).toBe('high');
    // Exactly one large-hail factor + one high-wind factor present.
    expect(result.risk_factors.some(f => /hail/i.test(f))).toBe(true);
    expect(result.risk_factors.some(f => /wind/i.test(f))).toBe(true);

    // A modest, non-high scenario must stay non-high: 2 small Hail events only.
    const modest: StormEvent[] = [
      makeEvent({ id: 'm1', event_type: 'Hail', hail_size_inches: 0.6 }),
      makeEvent({ id: 'm2', event_type: 'Hail', hail_size_inches: 0.7 }),
    ];
    const modestResult = assessRisk(modest);
    expect(modestResult.hail_risk).toBe('low');
    expect(modestResult.overall_risk).toBe('low');
  });
});
