import { describe, it, expect } from 'vitest';
import { shapeCurrent, shapeRecentDay, rollUpHours, WINDY_GUST_MPH } from '../weather-current';

describe('shapeCurrent', () => {
  it('converts Google metric into the units roofers use', () => {
    // Google answers in Celsius and km/h; every other number in this app —
    // and every conversation at a door — is Fahrenheit and mph.
    const c = shapeCurrent({
      weatherCondition: { description: { text: 'Thunderstorm' } },
      temperature: { degrees: 30 },
      feelsLikeTemperature: { degrees: 34 },
      relativeHumidity: 78.4,
      wind: { speed: { value: 32 }, gust: { value: 80 } },
      precipitation: { probability: { percent: 65 } },
      isDaytime: true,
    });
    expect(c).toEqual({
      description: 'Thunderstorm',
      temperatureF: 86,
      feelsLikeF: 93,
      humidityPct: 78,
      windMph: 20,
      windGustMph: 50,
      precipProbabilityPct: 65,
      isDaytime: true,
    });
  });

  it('returns null rather than a hollow object when there is no data', () => {
    expect(shapeCurrent(null)).toBeNull();
    expect(shapeCurrent(undefined)).toBeNull();
  });

  it('survives a response missing every optional field', () => {
    // A partial payload must not throw mid-canvass.
    const c = shapeCurrent({});
    expect(c?.description).toBe('Unknown');
    expect(c?.temperatureF).toBeNull();
    expect(c?.windGustMph).toBeNull();
  });

  it('falls back to the condition type when there is no description text', () => {
    expect(shapeCurrent({ weatherCondition: { type: 'RAIN' } })?.description).toBe('RAIN');
  });
});

describe('shapeRecentDay', () => {
  it('reads an ISO interval date', () => {
    const d = shapeRecentDay({
      interval: { startTime: '2026-09-04T00:00:00Z' },
      daytimeForecast: {
        weatherCondition: { description: { text: 'Hail showers' } },
        wind: { speed: { value: 40 }, gust: { value: 97 } },
        precipitation: { qpf: { quantity: 25.4 } },
      },
    });
    expect(d?.date).toBe('2026-09-04');
    expect(d?.maxWindMph).toBe(25);
    expect(d?.maxGustMph).toBe(60);
    expect(d?.precipInches).toBe(1);
    expect(d?.hadHail).toBe(true);
  });

  it('reads the structured displayDate shape too', () => {
    // Google returns either form depending on endpoint.
    const d = shapeRecentDay({ displayDate: { year: 2026, month: 9, day: 4 } });
    expect(d?.date).toBe('2026-09-04');
  });

  it('flags hail only from the condition text', () => {
    // There is no hail boolean in the API, so the text is the only signal —
    // worth stating, because absence here is not evidence of no hail. NOAA is
    // the authority for that.
    expect(shapeRecentDay({ displayDate: { year: 2026, month: 9, day: 4 },
      daytimeForecast: { weatherCondition: { description: { text: 'Sunny' } } } })?.hadHail).toBe(false);
  });

  it('returns null without a date to anchor on', () => {
    expect(shapeRecentDay({})).toBeNull();
    expect(shapeRecentDay(null)).toBeNull();
  });

  it('keeps a windy-day threshold a rep would actually mention', () => {
    // 40mph gusts are where shingle damage becomes a plausible conversation.
    expect(WINDY_GUST_MPH).toBe(40);
  });
});

describe('rollUpHours', () => {
  const hour = (t: string, gustKmh?: number, mm?: number, text?: string) => ({
    interval: { startTime: t },
    wind: { speed: { value: 16 }, gust: gustKmh != null ? { value: gustKmh } : undefined },
    precipitation: mm != null ? { qpf: { quantity: mm } } : undefined,
    weatherCondition: text ? { description: { text } } : undefined,
  });

  it('takes the day\'s PEAK gust, not the last reading', () => {
    // A rep says "Tuesday gusted to 55" — the maximum is the fact that matters.
    const d = rollUpHours([
      hour('2026-09-04T10:00:00Z', 30),
      hour('2026-09-04T14:00:00Z', 97),
      hour('2026-09-04T18:00:00Z', 20),
    ]);
    expect(d).toHaveLength(1);
    expect(d[0].maxGustMph).toBe(60);
  });

  it('sums precipitation across the day', () => {
    const d = rollUpHours([hour('2026-09-04T10:00:00Z', 10, 12.7), hour('2026-09-04T11:00:00Z', 10, 12.7)]);
    expect(d[0].precipInches).toBe(1);
  });

  it('marks the day as hail if any single hour had it', () => {
    const d = rollUpHours([hour('2026-09-04T10:00:00Z', 10, 0, 'Cloudy'), hour('2026-09-04T15:00:00Z', 80, 5, 'Hail')]);
    expect(d[0].hadHail).toBe(true);
    expect(d[0].description).toBe('Hail');
  });

  it('groups multiple days and returns newest first', () => {
    const d = rollUpHours([hour('2026-09-03T10:00:00Z', 20), hour('2026-09-05T10:00:00Z', 20), hour('2026-09-04T10:00:00Z', 20)]);
    expect(d.map((x) => x.date)).toEqual(['2026-09-05', '2026-09-04', '2026-09-03']);
  });

  it('prefers a notable condition over a clear one', () => {
    const d = rollUpHours([hour('2026-09-04T09:00:00Z', 10, 0, 'Sunny'), hour('2026-09-04T16:00:00Z', 10, 0, 'Thunderstorm')]);
    expect(d[0].description).toBe('Thunderstorm');
  });

  it('skips hours with no timestamp and survives an empty list', () => {
    expect(rollUpHours([])).toEqual([]);
    expect(rollUpHours([{ wind: { gust: { value: 90 } } }])).toEqual([]);
  });
});
