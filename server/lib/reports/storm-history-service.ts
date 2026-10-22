/**
 * Storm History Service
 * Fetches historical storm data (hail, wind, severe weather) for property locations.
 * Uses multiple real NOAA data sources — NO synthetic/estimated data.
 *
 * Data sources:
 *   1. NOAA SWDI (Storm Reports + NEXRAD Hail) — primary
 *   2. Iowa Environmental Mesonet (IEM) Local Storm Reports — secondary
 *
 * When no events are found from any source, the report honestly states
 * "no significant storm events found" rather than generating fake data.
 */

import { fetchSWDIStormEvents, deduplicateEvents, type DataSourceDetail } from './swdi-api-service.js';
import { fetchIEMLSREvents } from './iem-api-service.js';

// ─── 10-Level Hail Size Scale with HAAG Engineering References ───────
export const HAIL_SIZE_SCALE = [
  { level: 1,  min: 0.50, max: 0.74, label: 'Pea',         color: '#93c5fd', damageRating: 'Minimal',       haagRef: 'Below functional damage threshold' },
  { level: 2,  min: 0.75, max: 0.99, label: 'Penny/Dime',  color: '#60a5fa', damageRating: 'Minor',         haagRef: 'Possible granule loss on aged shingles' },
  { level: 3,  min: 1.00, max: 1.24, label: 'Quarter',     color: '#3b82f6', damageRating: 'Moderate',      haagRef: 'Functional damage likely — bruising, granule displacement' },
  { level: 4,  min: 1.25, max: 1.49, label: 'Half Dollar', color: '#2563eb', damageRating: 'Significant',   haagRef: 'Fractures and cracks in shingle mat' },
  { level: 5,  min: 1.50, max: 1.74, label: 'Golf Ball',   color: '#f59e0b', damageRating: 'Severe',        haagRef: 'Open fractures, exposed fiberglass mat' },
  { level: 6,  min: 1.75, max: 1.99, label: 'Lime',        color: '#f97316', damageRating: 'Very Severe',   haagRef: 'Mat tears, sealant failure, potential leaks' },
  { level: 7,  min: 2.00, max: 2.49, label: 'Tennis Ball',  color: '#ef4444', damageRating: 'Major',         haagRef: 'Penetration of shingle layers possible' },
  { level: 8,  min: 2.50, max: 2.74, label: 'Baseball',    color: '#dc2626', damageRating: 'Catastrophic',  haagRef: 'Full penetration of roofing system likely' },
  { level: 9,  min: 2.75, max: 2.99, label: 'Tea Cup',     color: '#b91c1c', damageRating: 'Extreme',       haagRef: 'Structural deck compromise' },
  { level: 10, min: 3.00, max: 99,   label: 'Softball+',   color: '#7f1d1d', damageRating: 'Catastrophic+', haagRef: 'Total roof system replacement required' },
] as const;

export type HailSizeLevel = typeof HAIL_SIZE_SCALE[number];

/**
 * Get the hail size level for a given size in inches.
 * Returns undefined if size is below the minimum threshold (0.5").
 */
export function getHailSizeLevel(sizeInches: number): HailSizeLevel | undefined {
  if (sizeInches < 0.5) return undefined;
  return HAIL_SIZE_SCALE.find(l => sizeInches >= l.min && sizeInches <= l.max)
    || HAIL_SIZE_SCALE[HAIL_SIZE_SCALE.length - 1]; // 3"+ fallback
}

// Storm event types we care about for roofing
export const RELEVANT_STORM_TYPES = [
  'Hail',
  'Thunderstorm Wind',
  'High Wind',
  'Strong Wind',
  'Tornado',
  'Hurricane',
  'Tropical Storm',
] as const;

export type StormType = typeof RELEVANT_STORM_TYPES[number];

export interface StormEvent {
  id: string;
  event_type: StormType;
  date: string;
  year: number;
  month: number;
  day: number;
  time?: string;

  // Location
  state: string;
  county: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  distance_miles?: number; // Distance from property

  // Storm details
  magnitude?: number;
  magnitude_unit?: string; // 'inch' for hail, 'mph' for wind
  hail_size_inches?: number;
  wind_speed_mph?: number;

  // Damage info
  damage_property?: string;
  damage_crops?: string;
  injuries_direct?: number;
  injuries_indirect?: number;
  deaths_direct?: number;
  deaths_indirect?: number;

  // Narrative
  episode_narrative?: string;
  event_narrative?: string;

  // Source
  source: 'NOAA' | 'NWS';
  data_source?: string;
}

export interface StormReport {
  property_address: string;
  city: string;
  state: string;
  zip?: string;
  latitude: number;
  longitude: number;

  // Report period
  start_date: string;
  end_date: string;
  years_covered: number;

  // Summary statistics
  summary: {
    total_events: number;
    hail_events: number;
    wind_events: number;
    tornado_events: number;
    largest_hail_inches?: number;
    highest_wind_mph?: number;
    total_property_damage?: string;
    insurance_claim_potential: 'high' | 'medium' | 'low' | 'none';
    hail_size_distribution?: Record<number, number>; // count per hail size level (1-10)
  };

  // Events by year
  events_by_year: Record<number, StormEvent[]>;

  // All events sorted by date (most recent first)
  events: StormEvent[];

  // Significant events (large hail, high winds)
  significant_events: StormEvent[];

  // Risk assessment
  risk_assessment: {
    hail_risk: 'high' | 'medium' | 'low';
    wind_risk: 'high' | 'medium' | 'low';
    overall_risk: 'high' | 'medium' | 'low';
    risk_factors: string[];
    recommendations: string[];
  };

  // Numeric risk scores (0-100) — more granular than high/medium/low
  risk_score?: {
    hail_score: number;
    wind_score: number;
    overall_score: number;
  };

  // Date of Loss — for insurance claims
  date_of_loss?: {
    date: string;
    event_id?: string;
    event_type?: string;
    magnitude?: string;
    distance_miles?: number;
    confidence: 'confirmed' | 'recommended' | 'manual';
  };
  recommended_date_of_loss?: {
    date: string;
    event_id: string;
    event_type: string;
    magnitude: string;
    distance_miles?: number;
    reason: string;
  };

  // Property storm profile — for 5+ year reports
  property_profile?: {
    total_hail_events: number;
    total_wind_events: number;
    avg_events_per_year: number;
    worst_year: { year: number; event_count: number; largest_hail?: number };
    storm_free_years: number[];
    repeat_storm_months: number[];
    estimated_cumulative_exposure: 'extreme' | 'high' | 'moderate' | 'low';
  };

  // Data quality indicator
  data_quality: 'verified' | 'no_data' | 'partial' | 'degraded';
  data_source_details: DataSourceDetail[];

  // Metadata
  generated_at: string;
  data_sources: string[];
  search_radius_miles: number;
}

export interface GeocodingResult {
  latitude: number;
  longitude: number;
  formatted_address: string;
  city: string;
  state: string;
  county: string;
  zip?: string;
}

/**
 * Geocode an address to get coordinates
 */
export async function geocodeAddress(
  address: string,
  city: string,
  state: string,
  zip?: string,
  googleApiKey?: string
): Promise<GeocodingResult | null> {
  const fullAddress = `${address}, ${city}, ${state} ${zip || ''}`.trim();

  // Try Google Geocoding if API key provided
  if (googleApiKey) {
    try {
      const fetchResponse = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${googleApiKey}`
      );
      const response = fetchResponse as any;

      if (response.ok) {
        const data = await response.json();
        if (data.results && data.results.length > 0) {
          const result = data.results[0];
          const location = result.geometry.location;

          // Extract address components
          const components = result.address_components;
          const getComponent = (type: string) =>
            components.find((c: any) => c.types.includes(type))?.long_name || '';

          return {
            latitude: location.lat,
            longitude: location.lng,
            formatted_address: result.formatted_address,
            city: getComponent('locality') || city,
            state: getComponent('administrative_area_level_1') || state,
            county: getComponent('administrative_area_level_2') || '',
            zip: getComponent('postal_code') || zip,
          };
        }
      }
    } catch (error) {
      console.error('Google Geocoding error:', error);
    }
  }

  // Fallback to Nominatim (OpenStreetMap)
  try {
    const fetchResponse = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddress)}&limit=1`,
      {
        headers: {
          // Nominatim's usage policy requires an identifiable app with a way
          // to reach us, or it blocks the whole IP range.
          'User-Agent': 'BestRoofingNow-Reports/1.0 (https://bestroofingnow.com)',
        },
      }
    );
    const response = fetchResponse as any;

    if (response.ok) {
      const data = await response.json();
      if (data.length > 0) {
        const result = data[0];
        return {
          latitude: parseFloat(result.lat),
          longitude: parseFloat(result.lon),
          formatted_address: result.display_name,
          city,
          state,
          county: '',
          zip,
        };
      }
    }
  } catch (error) {
    console.error('Nominatim Geocoding error:', error);
  }

  return null;
}

/**
 * Fetch storm events from multiple real NOAA data sources in parallel.
 * Merges and deduplicates results. Returns events and source details.
 */
async function fetchStormEventsMultiSource(
  latitude: number,
  longitude: number,
  startDate: Date,
  endDate: Date,
  radiusMiles: number
): Promise<{ events: StormEvent[]; sourceDetails: DataSourceDetail[]; dataQuality: StormReport['data_quality'] }> {
  // Fetch from SWDI and IEM in parallel
  const [swdiResult, iemResult] = await Promise.allSettled([
    fetchSWDIStormEvents(latitude, longitude, startDate, endDate, radiusMiles),
    fetchIEMLSREvents(latitude, longitude, startDate, endDate, radiusMiles),
  ]);

  const allEvents: StormEvent[] = [];
  const sourceDetails: DataSourceDetail[] = [];
  let successSources = 0;
  let failedSources = 0;

  // Process SWDI result
  if (swdiResult.status === 'fulfilled') {
    allEvents.push(...swdiResult.value.events);
    sourceDetails.push(swdiResult.value.sourceDetail);
    if (swdiResult.value.sourceDetail.status !== 'failed') {
      successSources++;
    } else {
      failedSources++;
    }
  } else {
    failedSources++;
    sourceDetails.push({
      name: 'NOAA SWDI (Storm Reports + NEXRAD Hail)',
      status: 'failed',
      event_count: 0,
      response_time_ms: 0,
    });
    console.error('SWDI fetch rejected:', swdiResult.reason);
  }

  // Process IEM result
  if (iemResult.status === 'fulfilled') {
    allEvents.push(...iemResult.value.events);
    sourceDetails.push(iemResult.value.sourceDetail);
    if (iemResult.value.sourceDetail.status !== 'failed') {
      successSources++;
    } else {
      failedSources++;
    }
  } else {
    failedSources++;
    sourceDetails.push({
      name: 'Iowa Environmental Mesonet (IEM) - Local Storm Reports',
      status: 'failed',
      event_count: 0,
      response_time_ms: 0,
    });
    console.error('IEM fetch rejected:', iemResult.reason);
  }

  // Deduplicate across sources (same date + type + ~2mi proximity)
  const dedupedEvents = deduplicateEvents(allEvents);

  // Sort by date descending
  dedupedEvents.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Determine data quality
  const totalSources = 2;
  let dataQuality: StormReport['data_quality'];

  if (failedSources === totalSources) {
    dataQuality = 'degraded';
  } else if (dedupedEvents.length === 0) {
    dataQuality = 'no_data';
  } else if (failedSources > 0) {
    dataQuality = 'partial';
  } else {
    dataQuality = 'verified';
  }

  console.log(`Multi-source: ${dedupedEvents.length} events after dedup (${allEvents.length} raw), quality=${dataQuality}, ${successSources}/${totalSources} sources OK`);

  return { events: dedupedEvents, sourceDetails, dataQuality };
}

/**
 * Assess risk based on storm history
 */
function assessRisk(events: StormEvent[]): StormReport['risk_assessment'] {
  // When no events, return low risk with honest messaging
  if (events.length === 0) {
    return {
      hail_risk: 'low',
      wind_risk: 'low',
      overall_risk: 'low',
      risk_factors: ['No storm events recorded within search radius during report period. This may indicate low storm activity or limited data coverage for this area.'],
      recommendations: ['Continue regular roof maintenance and annual inspections'],
    };
  }

  const hailEvents = events.filter(e => e.event_type === 'Hail');
  const windEvents = events.filter(e =>
    e.event_type.includes('Wind') || e.event_type === 'Tornado'
  );

  // Calculate hail risk
  const largeHailCount = hailEvents.filter(e => (e.hail_size_inches || 0) >= 1.0).length;
  const hailRisk: 'high' | 'medium' | 'low' =
    largeHailCount >= 3 ? 'high' :
    hailEvents.length >= 5 ? 'medium' : 'low';

  // Calculate wind risk
  const highWindCount = windEvents.filter(e => (e.wind_speed_mph || 0) >= 60).length;
  const windRisk: 'high' | 'medium' | 'low' =
    highWindCount >= 3 ? 'high' :
    windEvents.length >= 5 ? 'medium' : 'low';

  // Overall risk
  const overallRisk: 'high' | 'medium' | 'low' =
    hailRisk === 'high' || windRisk === 'high' ? 'high' :
    hailRisk === 'medium' || windRisk === 'medium' ? 'medium' : 'low';

  // Risk factors
  const riskFactors: string[] = [];
  if (largeHailCount > 0) {
    riskFactors.push(`${largeHailCount} large hail events (1"+ diameter) in the past 3 years`);
  }
  if (highWindCount > 0) {
    riskFactors.push(`${highWindCount} high wind events (60+ mph) in the past 3 years`);
  }
  if (events.some(e => e.event_type === 'Tornado')) {
    riskFactors.push('Tornado activity recorded in the area');
  }

  // Recommendations
  const recommendations: string[] = [];
  if (hailRisk === 'high') {
    recommendations.push('Consider impact-resistant roofing materials (Class 4 rated)');
    recommendations.push('Annual roof inspections are strongly recommended');
  }
  if (windRisk === 'high') {
    recommendations.push('Ensure proper roof-to-wall connections');
    recommendations.push('Consider wind-rated shingles (130+ mph)');
  }
  if (overallRisk === 'high') {
    recommendations.push('Document roof condition with photos annually');
    recommendations.push('Review insurance coverage for storm damage');
  }
  if (overallRisk !== 'low') {
    recommendations.push('Keep records of all storm events for insurance claims');
  }

  return {
    hail_risk: hailRisk,
    wind_risk: windRisk,
    overall_risk: overallRisk,
    risk_factors: riskFactors.length > 0 ? riskFactors : ['No significant storm risk factors identified'],
    recommendations: recommendations.length > 0 ? recommendations : ['Continue regular roof maintenance'],
  };
}

/**
 * Compute numeric risk scores (0-100) for more granular assessment.
 */
function computeRiskScores(events: StormEvent[]): { hail_score: number; wind_score: number; overall_score: number } {
  const now = Date.now();
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;

  const hailEvents = events.filter(e => e.event_type === 'Hail');
  const windEvents = events.filter(e => e.event_type.includes('Wind') || e.event_type === 'Tornado');

  // Hail score: event count + severity + recency
  let hailScore = 0;
  hailScore += Math.min(hailEvents.length * 5, 25); // up to 25 pts for count
  hailScore += hailEvents.filter(e => (e.hail_size_inches || 0) >= 1.0).length * 12; // 12 pts per 1"+ event
  hailScore += hailEvents.filter(e => (e.hail_size_inches || 0) >= 1.5).length * 15; // extra 15 per 1.5"+
  const largestHail = Math.max(...hailEvents.map(e => e.hail_size_inches || 0), 0);
  hailScore += Math.round(largestHail * 8); // up to ~24 pts for largest
  // Recency bonus: events in last 12 months
  hailScore += hailEvents.filter(e => new Date(e.date).getTime() > oneYearAgo).length * 8;

  // Wind score: event count + severity + recency
  let windScore = 0;
  windScore += Math.min(windEvents.length * 5, 25);
  windScore += windEvents.filter(e => (e.wind_speed_mph || 0) >= 60).length * 12;
  windScore += windEvents.filter(e => (e.wind_speed_mph || 0) >= 75).length * 15;
  const highestWind = Math.max(...windEvents.map(e => e.wind_speed_mph || 0), 0);
  windScore += Math.round(highestWind * 0.3); // scaled lower than hail
  windScore += windEvents.filter(e => new Date(e.date).getTime() > oneYearAgo).length * 8;

  // Tornado bonus
  if (events.some(e => e.event_type === 'Tornado')) {
    windScore += 20;
  }

  return {
    hail_score: Math.min(100, hailScore),
    wind_score: Math.min(100, windScore),
    overall_score: Math.min(100, Math.round(Math.max(hailScore, windScore) * 0.7 + Math.min(hailScore, windScore) * 0.3)),
  };
}

/**
 * Recommend the most likely Date of Loss for insurance claims.
 * Picks the most severe event within 10 miles, preferring recent large hail.
 */
function recommendDateOfLoss(events: StormEvent[], peril: 'wind' | 'hail' | 'any' = 'any'): StormReport['recommended_date_of_loss'] {
  if (events.length === 0) return undefined;
  // For a peril-specific claim, only that peril's events can be the date of loss (a wind claim's
  // date of loss must be a wind/tornado event, not an unrelated small-hail report).
  if (peril === 'wind') events = events.filter(e => /wind|tornado/i.test(e.event_type));
  else if (peril === 'hail') events = events.filter(e => /hail/i.test(e.event_type) || (e.hail_size_inches || 0) > 0);
  if (events.length === 0) return undefined;

  // Score every event with a real magnitude across the search radius — do NOT hard-filter by
  // a tight radius first, or sparse zero-magnitude "Thunderstorm Wind" point reports nearby can
  // crowd out the genuinely significant event (a tornado / high wind / large hail) a few miles
  // further out. Distance is folded into the score as a mild factor so severity dominates.
  const now = Date.now();
  const scored = events
    .map(e => {
      const dist0 = e.distance_miles || 0;
      let severity = 0;
      if (e.hail_size_inches) severity = e.hail_size_inches * 100;
      if (e.wind_speed_mph) severity = Math.max(severity, e.wind_speed_mph);
      // A tornado only damages a narrow path: it's the date-of-loss event only if very close.
      // Farther out it just signals a severe-wind day, so straight-line wind (wide swath) should
      // characterize the loss instead — give a distant tornado only a modest severity.
      if (e.event_type === 'Tornado') severity = Math.max(severity, dist0 <= 8 ? 200 : 40);

      // Recency: more recent = higher multiplier (1.0 to 2.0 over 3 years)
      const ageMs = now - new Date(e.date).getTime();
      const ageYears = ageMs / (365 * 24 * 60 * 60 * 1000);
      const recencyMultiplier = Math.max(1.0, 2.0 - ageYears * 0.33);

      // Distance factor: closer scores higher, but never zero out a severe distant event (min 0.3).
      const dist = e.distance_miles || 0;
      const distanceFactor = Math.max(0.3, 1 - dist / 40);

      return { event: e, score: severity * recencyMultiplier * distanceFactor };
    })
    .filter(s => s.score > 0); // only events with a real magnitude qualify as a date of loss
  if (!scored.length) return undefined;

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score === 0) return undefined;

  const e = best.event;
  const magnitude = e.hail_size_inches
    ? `${e.hail_size_inches}" hail`
    : e.wind_speed_mph
      ? `${e.wind_speed_mph} mph wind`
      : e.event_type;

  const level = e.hail_size_inches ? getHailSizeLevel(e.hail_size_inches) : undefined;
  const reason = e.hail_size_inches
    ? `Largest hail event (${e.hail_size_inches}"${level ? ` - ${level.label}` : ''}) within ${(e.distance_miles || 0).toFixed(1)} miles`
    : e.event_type === 'Tornado'
      ? 'Tornado event near property'
      : `Highest wind event (${e.wind_speed_mph} mph) within ${(e.distance_miles || 0).toFixed(1)} miles`;

  return {
    date: e.date,
    event_id: e.id,
    event_type: e.event_type,
    magnitude,
    distance_miles: e.distance_miles,
    reason,
  };
}

/**
 * Build property storm profile for long-term reports (5+ years).
 */
function buildPropertyProfile(
  eventsByYear: Record<number, StormEvent[]>,
  allEvents: StormEvent[]
): StormReport['property_profile'] {
  const years = Object.keys(eventsByYear).map(Number).sort();
  if (years.length < 2) return undefined;

  const hailEvents = allEvents.filter(e => e.event_type === 'Hail');
  const windEvents = allEvents.filter(e => e.event_type.includes('Wind') || e.event_type === 'Tornado');

  const totalEvents = allEvents.length;
  const avgPerYear = totalEvents / years.length;

  // Find worst year
  let worstYear = { year: years[0], event_count: 0, largest_hail: 0 };
  for (const [yearStr, events] of Object.entries(eventsByYear)) {
    const yr = parseInt(yearStr);
    if (events.length > worstYear.event_count) {
      const largestHail = Math.max(...events.map(e => e.hail_size_inches || 0), 0);
      worstYear = { year: yr, event_count: events.length, largest_hail: largestHail || undefined } as any;
    }
  }

  // Storm-free years
  const stormFreeYears = years.filter(yr => (eventsByYear[yr] || []).length === 0);

  // Months with recurring storms (3+ events across all years)
  const monthCounts: Record<number, number> = {};
  for (const event of allEvents) {
    monthCounts[event.month] = (monthCounts[event.month] || 0) + 1;
  }
  const repeatMonths = Object.entries(monthCounts)
    .filter(([, count]) => count >= 3)
    .map(([month]) => parseInt(month));

  // Cumulative exposure
  const largeHailCount = hailEvents.filter(e => (e.hail_size_inches || 0) >= 1.0).length;
  const exposure: 'extreme' | 'high' | 'moderate' | 'low' =
    largeHailCount >= 10 ? 'extreme' :
    largeHailCount >= 5 ? 'high' :
    largeHailCount >= 2 ? 'moderate' : 'low';

  return {
    total_hail_events: hailEvents.length,
    total_wind_events: windEvents.length,
    avg_events_per_year: Math.round(avgPerYear * 10) / 10,
    worst_year: worstYear,
    storm_free_years: stormFreeYears,
    repeat_storm_months: repeatMonths,
    estimated_cumulative_exposure: exposure,
  };
}

/**
 * Compute hail size distribution across the 10-level scale.
 */
function computeHailSizeDistribution(events: StormEvent[]): Record<number, number> {
  const distribution: Record<number, number> = {};
  for (let i = 1; i <= 10; i++) distribution[i] = 0;

  for (const event of events) {
    if (event.hail_size_inches) {
      const level = getHailSizeLevel(event.hail_size_inches);
      if (level) distribution[level.level]++;
    }
  }
  return distribution;
}

/**
 * Generate a comprehensive storm report for a property.
 * Uses real NOAA data from multiple sources. No synthetic/estimated data.
 */
export async function generateStormReport(
  address: string,
  city: string,
  state: string,
  zip?: string,
  options: {
    yearsBack?: number;
    searchRadiusMiles?: number;
    googleApiKey?: string;
    /** Bias the recommended date of loss toward a specific peril (e.g. 'wind' for a wind claim). */
    peril?: 'wind' | 'hail' | 'any';
    /**
     * Coordinates the caller already has (a canvass pin). Skips the geocode,
     * which is a paid Google call on every storm pull otherwise.
     */
    coords?: { lat: number; lng: number };
  } = {}
): Promise<StormReport> {
  const yearsBack = options.yearsBack || 3;
  const searchRadius = options.searchRadiusMiles || 25;

  // Geocode the address, unless the caller already knows where it is
  const known = options.coords;
  const geoResult: GeocodingResult | null = known && Number.isFinite(known.lat) && Number.isFinite(known.lng)
    ? {
        latitude: known.lat, longitude: known.lng,
        formatted_address: [address, city, state, zip].filter(Boolean).join(', '),
        city, state, county: '', zip,
      }
    : await geocodeAddress(address, city, state, zip, options.googleApiKey);

  if (!geoResult) {
    throw new Error('Unable to geocode address');
  }

  const { latitude, longitude } = geoResult;

  // Calculate date range
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - yearsBack);

  // Fetch storm events from multiple real NOAA sources
  const { events, sourceDetails, dataQuality } = await fetchStormEventsMultiSource(
    latitude, longitude, startDate, endDate, searchRadius
  );

  // Build data sources list for display
  const dataSources: string[] = [];
  for (const detail of sourceDetails) {
    if (detail.status === 'success') {
      dataSources.push(detail.name);
    } else if (detail.status === 'empty') {
      dataSources.push(`${detail.name} (No Events Found)`);
    }
  }
  if (dataSources.length === 0) {
    if (dataQuality === 'degraded') {
      dataSources.push('All NOAA data sources unavailable');
    } else {
      dataSources.push('NOAA (No Events Found)');
    }
  }

  // Filter by distance and sort by date
  const filteredEvents = events
    .filter(e => (e.distance_miles || 0) <= searchRadius)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Group events by year
  const eventsByYear: Record<number, StormEvent[]> = {};
  for (let year = new Date().getFullYear() - yearsBack; year <= new Date().getFullYear(); year++) {
    eventsByYear[year] = filteredEvents.filter(e => e.year === year);
  }

  // Calculate summary statistics
  const hailEvents = filteredEvents.filter(e => e.event_type === 'Hail');
  const windEvents = filteredEvents.filter(e => e.event_type.includes('Wind'));
  const tornadoEvents = filteredEvents.filter(e => e.event_type === 'Tornado');

  const largestHail = Math.max(...hailEvents.map(e => e.hail_size_inches || 0), 0);
  const highestWind = Math.max(...windEvents.map(e => e.wind_speed_mph || 0), 0);

  // Determine insurance claim potential
  let claimPotential: 'high' | 'medium' | 'low' | 'none' = 'none';
  if (largestHail >= 1.5 || highestWind >= 70 || tornadoEvents.length > 0) {
    claimPotential = 'high';
  } else if (largestHail >= 1.0 || highestWind >= 60) {
    claimPotential = 'medium';
  } else if (hailEvents.length > 0 || windEvents.length > 0) {
    claimPotential = 'low';
  }

  // Identify significant events
  const significantEvents = filteredEvents.filter(e =>
    (e.hail_size_inches && e.hail_size_inches >= 1.0) ||
    (e.wind_speed_mph && e.wind_speed_mph >= 60) ||
    e.event_type === 'Tornado'
  );

  // Assess risk
  const riskAssessment = assessRisk(filteredEvents);

  // Compute numeric risk scores (0-100)
  const riskScore = computeRiskScores(filteredEvents);

  // Compute hail size distribution
  const hailSizeDistribution = computeHailSizeDistribution(filteredEvents);

  // Recommend Date of Loss
  const recommendedDOL = recommendDateOfLoss(filteredEvents, options.peril || 'any');

  // Build property profile for 5+ year reports
  const propertyProfile = yearsBack >= 5 ? buildPropertyProfile(eventsByYear, filteredEvents) : undefined;

  return {
    property_address: address,
    city: geoResult.city,
    state: geoResult.state,
    zip: geoResult.zip,
    latitude,
    longitude,

    start_date: startDate.toISOString().split('T')[0],
    end_date: endDate.toISOString().split('T')[0],
    years_covered: yearsBack,

    summary: {
      total_events: filteredEvents.length,
      hail_events: hailEvents.length,
      wind_events: windEvents.length,
      tornado_events: tornadoEvents.length,
      largest_hail_inches: largestHail > 0 ? largestHail : undefined,
      highest_wind_mph: highestWind > 0 ? highestWind : undefined,
      insurance_claim_potential: claimPotential,
      hail_size_distribution: hailSizeDistribution,
    },

    events_by_year: eventsByYear,
    events: filteredEvents,
    significant_events: significantEvents,
    risk_assessment: riskAssessment,
    risk_score: riskScore,

    recommended_date_of_loss: recommendedDOL,
    property_profile: propertyProfile,

    data_quality: dataQuality,
    data_source_details: sourceDetails,

    generated_at: new Date().toISOString(),
    data_sources: dataSources,
    search_radius_miles: searchRadius,
  };
}

/**
 * Format storm report as text for display
 */
export function formatStormReportText(report: StormReport): string {
  let text = `# Storm History Report\n\n`;
  text += `**Property:** ${report.property_address}, ${report.city}, ${report.state}\n`;
  text += `**Report Period:** ${report.start_date} to ${report.end_date} (${report.years_covered} years)\n`;
  text += `**Search Radius:** ${report.search_radius_miles} miles\n`;
  text += `**Data Quality:** ${report.data_quality.toUpperCase()}\n\n`;

  if (report.data_quality === 'degraded') {
    text += `> **Note:** NOAA weather data services were unavailable when this report was generated. Try again later for complete results.\n\n`;
  } else if (report.data_quality === 'no_data') {
    text += `> **Note:** No significant storm events were found in NOAA records for this area during the report period.\n\n`;
  }

  text += `## Summary\n`;
  text += `- **Total Storm Events:** ${report.summary.total_events}\n`;
  text += `- **Hail Events:** ${report.summary.hail_events}\n`;
  text += `- **Wind Events:** ${report.summary.wind_events}\n`;
  if (report.summary.tornado_events > 0) {
    text += `- **Tornado Events:** ${report.summary.tornado_events}\n`;
  }
  if (report.summary.largest_hail_inches) {
    text += `- **Largest Hail:** ${report.summary.largest_hail_inches}"\n`;
  }
  if (report.summary.highest_wind_mph) {
    text += `- **Highest Wind:** ${report.summary.highest_wind_mph} mph\n`;
  }
  text += `- **Insurance Claim Potential:** ${report.summary.insurance_claim_potential.toUpperCase()}\n\n`;

  text += `## Risk Assessment\n`;
  text += `- **Hail Risk:** ${report.risk_assessment.hail_risk.toUpperCase()}\n`;
  text += `- **Wind Risk:** ${report.risk_assessment.wind_risk.toUpperCase()}\n`;
  text += `- **Overall Risk:** ${report.risk_assessment.overall_risk.toUpperCase()}\n\n`;

  text += `### Risk Factors\n`;
  for (const factor of report.risk_assessment.risk_factors) {
    text += `- ${factor}\n`;
  }
  text += `\n`;

  text += `### Recommendations\n`;
  for (const rec of report.risk_assessment.recommendations) {
    text += `- ${rec}\n`;
  }
  text += `\n`;

  if (report.significant_events.length > 0) {
    text += `## Significant Events\n`;
    for (const event of report.significant_events.slice(0, 10)) {
      text += `- **${event.date}:** ${event.event_type}`;
      if (event.hail_size_inches) {
        text += ` - ${event.hail_size_inches}" hail`;
      }
      if (event.wind_speed_mph) {
        text += ` - ${event.wind_speed_mph} mph winds`;
      }
      text += `\n`;
    }
  }

  text += `\n## Data Sources\n`;
  for (const detail of report.data_source_details) {
    text += `- ${detail.name}: ${detail.status} (${detail.event_count} events, ${detail.response_time_ms}ms)\n`;
  }

  return text;
}

/**
 * Get hail size description for insurance purposes
 */
export function getHailSizeDescription(sizeInches: number): string {
  if (sizeInches < 0.5) return 'Pea size - minimal damage expected';
  if (sizeInches < 0.75) return 'Marble size - possible minor damage';
  if (sizeInches < 1.0) return 'Dime/Penny size - potential shingle damage';
  if (sizeInches < 1.25) return 'Quarter size - likely shingle damage';
  if (sizeInches < 1.5) return 'Half dollar size - significant damage likely';
  if (sizeInches < 1.75) return 'Golf ball size - severe damage expected';
  if (sizeInches < 2.5) return 'Tennis ball size - major damage, full inspection needed';
  if (sizeInches < 3.0) return 'Baseball size - catastrophic damage likely';
  return 'Softball size or larger - extreme damage, emergency repair needed';
}

/**
 * Get wind damage potential description
 */
export function getWindDamageDescription(speedMph: number): string {
  if (speedMph < 40) return 'Light - minimal risk to properly installed roofing';
  if (speedMph < 50) return 'Moderate - possible loose shingle lifting';
  if (speedMph < 60) return 'Strong - shingle damage possible';
  if (speedMph < 70) return 'Very Strong - shingle blow-off likely';
  if (speedMph < 80) return 'Severe - significant roof damage expected';
  if (speedMph < 100) return 'Extreme - major structural damage possible';
  return 'Catastrophic - widespread destruction likely';
}
