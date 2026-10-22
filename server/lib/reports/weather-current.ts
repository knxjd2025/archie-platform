/**
 * Current + recent conditions from the Google Weather API, to sit alongside
 * the NOAA storm history on a canvassed address.
 *
 * The two answer different questions and neither replaces the other:
 *   NOAA          — the confirmed historical record ("1.75in hail on 4/12/24").
 *                   Authoritative for a claim, but reports are county-level and
 *                   land days to weeks late.
 *   Google Weather — what it is doing at this roof right now, and the last few
 *                   days. Point-accurate and immediate, but not a claim record.
 *
 * A rep at a door wants both: the storm that caused the damage, and whether
 * rain is coming before the tarp goes on.
 *
 * Fails soft everywhere — canvassing must keep working when weather does not.
 */
import { googleMapsKey } from './google-key';

const BASE = 'https://weather.googleapis.com/v1';

export interface CurrentConditions {
  description: string;
  temperatureF: number | null;
  feelsLikeF: number | null;
  humidityPct: number | null;
  windMph: number | null;
  windGustMph: number | null;
  precipProbabilityPct: number | null;
  isDaytime: boolean | null;
}

export interface RecentDay {
  date: string;
  maxWindMph: number | null;
  maxGustMph: number | null;
  precipInches: number | null;
  hadHail: boolean;
  description: string | null;
}

export interface WeatherSnapshot {
  current: CurrentConditions | null;
  recent: RecentDay[];
  /** Days in `recent` whose gusts reached a level worth mentioning at a door. */
  windyDays: number;
  source: 'google-weather-api';
}

/** Google returns km/h and Celsius; roofers work in mph and Fahrenheit. */
const kmhToMph = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 0.621371) : null;
};
const cToF = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round((n * 9) / 5 + 32) : null;
};
const mmToIn = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round((n / 25.4) * 100) / 100 : null;
};
const pct = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** Gusts at or above this are worth raising at a door. */
export const WINDY_GUST_MPH = 40;

/** Google rejects history requests longer than this. */
export const MAX_HISTORY_HOURS = 24;

export function shapeCurrent(raw: any): CurrentConditions | null {
  if (!raw) return null;
  return {
    description: String(raw?.weatherCondition?.description?.text || raw?.weatherCondition?.type || 'Unknown'),
    temperatureF: cToF(raw?.temperature?.degrees),
    feelsLikeF: cToF(raw?.feelsLikeTemperature?.degrees),
    humidityPct: pct(raw?.relativeHumidity),
    windMph: kmhToMph(raw?.wind?.speed?.value),
    windGustMph: kmhToMph(raw?.wind?.gust?.value),
    precipProbabilityPct: pct(raw?.precipitation?.probability?.percent),
    isDaytime: typeof raw?.isDaytime === 'boolean' ? raw.isDaytime : null,
  };
}

export function shapeRecentDay(raw: any): RecentDay | null {
  const d = raw?.interval?.startTime || raw?.displayDate;
  if (!d) return null;
  const date =
    typeof d === 'string'
      ? d.slice(0, 10)
      : `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  const day = raw?.daytimeForecast || raw;
  const conditionText = String(day?.weatherCondition?.description?.text || '');
  return {
    date,
    maxWindMph: kmhToMph(day?.wind?.speed?.value ?? raw?.maxWind?.speed?.value),
    maxGustMph: kmhToMph(day?.wind?.gust?.value ?? raw?.maxWind?.gust?.value),
    precipInches: mmToIn(day?.precipitation?.qpf?.quantity ?? raw?.precipitation?.qpf?.quantity),
    // Google has no explicit hail flag; the condition text is the only signal.
    hadHail: /hail/i.test(conditionText),
    description: conditionText || null,
  };
}

/**
 * Collapse hourly history into per-day peaks — the shape a rep reasons about
 * ("Tuesday gusted to 55"). Takes the max wind/gust, sums precipitation, and
 * treats a day as hail if any hour mentioned it.
 */
export function rollUpHours(hours: any[]): RecentDay[] {
  const byDay = new Map<string, RecentDay>();
  for (const h of hours) {
    const iso = h?.interval?.startTime || h?.displayDateTime;
    if (!iso) continue;
    const date =
      typeof iso === 'string'
        ? iso.slice(0, 10)
        : `${iso.year}-${String(iso.month).padStart(2, '0')}-${String(iso.day).padStart(2, '0')}`;
    const text = String(h?.weatherCondition?.description?.text || '');
    const cur = byDay.get(date) || {
      date, maxWindMph: null, maxGustMph: null, precipInches: null, hadHail: false, description: null,
    };
    const w = kmhToMph(h?.wind?.speed?.value);
    const g = kmhToMph(h?.wind?.gust?.value);
    const p = mmToIn(h?.precipitation?.qpf?.quantity);
    if (w !== null) cur.maxWindMph = Math.max(cur.maxWindMph ?? 0, w);
    if (g !== null) cur.maxGustMph = Math.max(cur.maxGustMph ?? 0, g);
    if (p !== null) cur.precipInches = Math.round(((cur.precipInches ?? 0) + p) * 100) / 100;
    if (/hail/i.test(text)) { cur.hadHail = true; cur.description = text; }
    // Keep the worst-sounding condition seen that day, not the last one.
    if (!cur.description && text && !/clear|sunny/i.test(text)) cur.description = text;
    byDay.set(date, cur);
  }
  return Array.from(byDay.values()).sort((a, b) => b.date.localeCompare(a.date));
}

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Conditions now, plus the last 24 hours rolled into day buckets.
 *
 * 24 hours is Google's hard limit for history — anything longer belongs to
 * NOAA, which is the record a claim rests on anyway. Returns null only when no
 * key is configured; a failed leg degrades to null within the snapshot rather
 * than losing the whole thing.
 */
export async function fetchWeatherSnapshot(
  lat: number,
  lng: number,
): Promise<WeatherSnapshot | null> {
  const key = googleMapsKey();
  if (!key) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const loc = `location.latitude=${lat}&location.longitude=${lng}`;
  // Google's history is HOURLY and capped at 24 hours. There is no
  // history/days endpoint, and asking for more than MAX_HISTORY_HOURS is
  // rejected — which getJson swallows into null, silently yielding zero recent
  // days while current conditions kept working.
  const [cur, hist] = await Promise.all([
    getJson(`${BASE}/currentConditions:lookup?key=${key}&${loc}&unitsSystem=METRIC`),
    getJson(`${BASE}/history/hours:lookup?key=${key}&${loc}&hours=${MAX_HISTORY_HOURS}&pageSize=${MAX_HISTORY_HOURS}&unitsSystem=METRIC`),
  ]);

  const recent = rollUpHours((hist?.historyHours || []) as any[]);

  return {
    current: shapeCurrent(cur),
    recent,
    windyDays: recent.filter((d) => (d.maxGustMph ?? 0) >= WINDY_GUST_MPH).length,
    source: 'google-weather-api',
  };
}
