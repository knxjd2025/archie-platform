/**
 * Hardening tests for the pure SWDI CSV parser (`parseCSV`).
 *
 * NOAA SWDI is an external REST API: responses are not always the clean CSV
 * the row-mappers assume. They can be empty, a non-string (when an upstream
 * read fails), or an HTML error page (gateway 5xx, captive-portal, WAF block).
 * Column sets can also drift (missing / extra columns, malformed numeric cells).
 *
 * Two guarantees locked in here:
 *  1. WELL-FORMED SWDI CSV parses to exactly the same row objects as before
 *     (no behavior change for the happy path — the contract the row-mappers
 *     in fetchPLSREvents / fetchNX3HailEvents depend on).
 *  2. GARBAGE input (empty string, non-string, HTML error blob, header-only,
 *     malformed numeric cells) returns a SAFE array — empty or valid rows
 *     only — and never throws and never yields NaN coordinates once the
 *     row-mappers parse it.
 */
import { describe, it, expect, vi } from 'vitest';

// These tests must never reach a real storm data source.
vi.stubGlobal('fetch', vi.fn(() => { throw new Error('no network in tests'); }));
import {
  parseCSV,
  parseZTimeComponents,
  buildSwdiQuery,
  splitIntoChunks,
} from '../swdi-api-service';

describe('parseCSV — well-formed SWDI CSV (no behavior change)', () => {
  it('parses a canonical PLSR CSV into the exact same row objects as before', () => {
    const csv = [
      'ZTIME,LON,LAT,MAG,EVENT,REMARKS,STATE,COUNTY,CITY',
      '200506152030,-96.7000,32.7800,1.75,HAIL,HAIL 1.75 IN,TX,DALLAS,DALLAS',
      '200506152045,-96.7100,32.7900,60,TSTM WND,TSTM WND 60 MPH,TX,DALLAS,IRVING',
    ].join('\n');

    const rows = parseCSV(csv);

    expect(rows).toEqual([
      {
        ZTIME: '200506152030',
        LON: '-96.7000',
        LAT: '32.7800',
        MAG: '1.75',
        EVENT: 'HAIL',
        REMARKS: 'HAIL 1.75 IN',
        STATE: 'TX',
        COUNTY: 'DALLAS',
        CITY: 'DALLAS',
      },
      {
        ZTIME: '200506152045',
        LON: '-96.7100',
        LAT: '32.7900',
        MAG: '60',
        EVENT: 'TSTM WND',
        REMARKS: 'TSTM WND 60 MPH',
        STATE: 'TX',
        COUNTY: 'DALLAS',
        CITY: 'IRVING',
      },
    ]);
  });

  it('still parses CSV with CRLF line endings and a leading BOM', () => {
    const csv = '﻿ZTIME,LON,LAT\r\n200506152030,-96.7,32.78\r\n';
    const rows = parseCSV(csv);
    expect(rows).toEqual([{ ZTIME: '200506152030', LON: '-96.7', LAT: '32.78' }]);
  });
});

describe('parseCSV — malformed / garbage input is tolerated (no throw, no NaN)', () => {
  it('returns [] for an empty string', () => {
    expect(parseCSV('')).toEqual([]);
  });

  it('returns [] for whitespace-only input', () => {
    expect(parseCSV('   \n   \r\n  ')).toEqual([]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 12345],
    ['an object', { foo: 'bar' }],
    ['an array', ['a', 'b']],
  ])('returns [] for non-string input (%s) without throwing', (_label, input) => {
    let result: unknown;
    expect(() => {
      result = parseCSV(input as unknown as string);
    }).not.toThrow();
    expect(result).toEqual([]);
  });

  it('returns [] for an HTML error page (multi-line 5xx blob)', () => {
    const html = [
      '<html>',
      '<head><title>500 Internal Server Error</title></head>',
      '<body>',
      '<h1>Server Error</h1>',
      '<p>Something went wrong, please try again later.</p>',
      '</body>',
      '</html>',
    ].join('\n');

    const rows = parseCSV(html);
    // Must NOT manufacture pseudo-rows out of HTML tags.
    expect(rows).toEqual([]);
  });

  it('returns [] for an HTML one-liner error blob', () => {
    expect(parseCSV('<html><body>Access Denied</body></html>')).toEqual([]);
  });

  it('returns [] for a header row with no data rows', () => {
    expect(parseCSV('ZTIME,LON,LAT,MAG,EVENT')).toEqual([]);
  });

  it('tolerates a malformed numeric cell — row still parses, coords are not NaN downstream', () => {
    const csv = [
      'ZTIME,LON,LAT,MAG,EVENT,REMARKS',
      '200506152030,not-a-number,xx.yy,abc,HAIL,HAIL OBSERVED',
    ].join('\n');

    const rows = parseCSV(csv);
    expect(rows).toHaveLength(1);

    // The parser preserves the raw cells (it does not coerce numbers itself),
    // but the downstream numeric coercion the row-mappers use must not yield NaN.
    const row = rows[0];
    const eventLat = parseFloat(row.LAT || '0') || undefined;
    const eventLng = parseFloat(row.LON || '0') || undefined;
    expect(eventLat).toBeUndefined();
    expect(eventLng).toBeUndefined();
    expect(Number.isNaN(eventLat as unknown as number)).toBe(false);
    expect(Number.isNaN(eventLng as unknown as number)).toBe(false);
  });

  it('tolerates extra columns beyond the header (ignores overflow values)', () => {
    const csv = [
      'ZTIME,LON,LAT',
      '200506152030,-96.7,32.78,EXTRA,MORE_EXTRA',
    ].join('\n');
    const rows = parseCSV(csv);
    expect(rows).toEqual([{ ZTIME: '200506152030', LON: '-96.7', LAT: '32.78' }]);
  });
});

/**
 * Regression tests for the 2026-07 SWDI API-change fix.
 *
 * NOAA changed the SWDI web service and silently broke the primary storm source:
 *   1. `nx3hail` ZTIME is ISO 8601 (`2025-05-02T22:33:54Z`), but the parser sliced
 *      packed `YYYYMMDD` offsets → every radar event was mis-dated (month/day wrong).
 *   2. The spatial filter must be `bbox` — `center/radius` is ignored (returned the
 *      entire nationwide dataset every call).
 *   3. Queries are capped at 744h (31 days); the code chunked by 1 year → 500s.
 * These lock the fix so the bug can't silently return.
 */
describe('parseZTimeComponents — ISO 8601 vs packed (the mis-dating bug)', () => {
  it('parses an ISO 8601 nx3hail ZTIME by field (not by packed offset)', () => {
    // The exact bug: 2025-05-02T... used to slice to month=1, day=5.
    expect(parseZTimeComponents('2025-05-02T22:33:54Z')).toEqual({ year: 2025, month: 5, day: 2 });
  });

  it('parses a December ISO ZTIME correctly (no off-by-slice)', () => {
    expect(parseZTimeComponents('2024-12-31T10:15:00Z')).toEqual({ year: 2024, month: 12, day: 31 });
  });

  it('still parses a packed YYYYMMDDHHMI (legacy PLSR) ZTIME', () => {
    expect(parseZTimeComponents('200506152030')).toEqual({ year: 2005, month: 6, day: 15 });
  });

  it('never mis-dates an ISO event into January', () => {
    for (const m of ['03', '05', '07', '11']) {
      const { month } = parseZTimeComponents(`2025-${m}-14T08:00:00Z`);
      expect(month).toBe(parseInt(m, 10));
    }
  });
});

describe('buildSwdiQuery — bbox spatial filter (center/radius is ignored by SWDI)', () => {
  it('emits a bbox query, not center/radius', () => {
    const q = buildSwdiQuery(-80.8431, 35.2271, 15);
    expect(q.startsWith('?bbox=')).toBe(true);
    expect(q).not.toContain('center=');
    expect(q).not.toContain('radius=');
  });

  it('builds west,south,east,north around the center, radius-scaled', () => {
    const [west, south, east, north] = buildSwdiQuery(-80.8431, 35.2271, 15)
      .replace('?bbox=', '').split(',').map(Number);
    // center is inside the box
    expect(west).toBeLessThan(-80.8431);
    expect(east).toBeGreaterThan(-80.8431);
    expect(south).toBeLessThan(35.2271);
    expect(north).toBeGreaterThan(35.2271);
    // latitude span ≈ 2 * 15mi / 69mi-per-deg ≈ 0.43°
    expect(north - south).toBeCloseTo((2 * 15) / 69, 2);
    // longitude span is wider than latitude span at this latitude (cos-corrected)
    expect(east - west).toBeGreaterThan(north - south);
  });

  it('a larger radius yields a larger box', () => {
    const span = (r: number) => {
      const [w, , e] = buildSwdiQuery(-80.84, 35.22, r).replace('?bbox=', '').split(',').map(Number);
      return e - w;
    };
    expect(span(25)).toBeGreaterThan(span(5));
  });
});

describe('splitIntoChunks — ≤30-day windows (SWDI 744h cap)', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('returns a single chunk for a range under 30 days', () => {
    const chunks = splitIntoChunks(new Date('2025-04-01T00:00:00Z'), new Date('2025-04-20T00:00:00Z'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].start.toISOString()).toBe('2025-04-01T00:00:00.000Z');
    expect(chunks[0].end.toISOString()).toBe('2025-04-20T00:00:00.000Z');
  });

  it('splits a multi-month range and never exceeds 744h (31 days) per chunk', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-06-01T00:00:00Z'); // ~151 days
    const chunks = splitIntoChunks(start, end);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      const hours = (c.end.getTime() - c.start.getTime()) / (60 * 60 * 1000);
      expect(hours).toBeLessThanOrEqual(744);
    }
  });

  it('is contiguous and covers the full range exactly', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-04-15T00:00:00Z');
    const chunks = splitIntoChunks(start, end);
    expect(chunks[0].start.getTime()).toBe(start.getTime());
    expect(chunks[chunks.length - 1].end.getTime()).toBe(end.getTime());
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].start.getTime()).toBe(chunks[i - 1].end.getTime()); // no gaps/overlaps
    }
  });

  it('30-day chunk boundaries advance by exactly 30 days', () => {
    const chunks = splitIntoChunks(new Date('2025-01-01T00:00:00Z'), new Date('2025-03-01T00:00:00Z'));
    expect(chunks[0].end.getTime() - chunks[0].start.getTime()).toBe(30 * DAY);
  });
});
