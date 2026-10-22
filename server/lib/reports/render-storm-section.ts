/**
 * Renders a branded "Storm & Weather History" section from a real NOAA StormReport.
 * Used when an inspector documents wind/hail/storm damage and an insurance claim is
 * recommended. Presents verified NOAA records honestly: it supports filing a claim,
 * but the insurance adjuster makes the final coverage determination — we never assert
 * a claim is approved, owed, or covered.
 */
import { esc } from './report-theme.js';
import { companyBrand } from './company-brand.js';
import type { StormReport, StormEvent } from './storm-history-service.js';
import { getHailSizeLevel } from './storm-history-service.js';

function fmtDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function eventMagnitude(e: StormEvent): string {
  if (e.hail_size_inches) {
    const lvl = getHailSizeLevel(e.hail_size_inches);
    return `${e.hail_size_inches}" hail${lvl ? ` (${lvl.label})` : ''}`;
  }
  if (e.wind_speed_mph) return `${e.wind_speed_mph} mph wind`;
  return ''; // no distinct magnitude (e.g. a tornado with no rating) — the Event column already names it
}

export interface StormSectionOptions {
  /**
   * When true (default), frame the data around an active insurance claim: a
   * recommended Date of Loss and "file a claim" guidance (an inspector documented
   * storm damage). When false, present the same NOAA data purely as weather
   * context — no claim push, no date-of-loss-for-claim block.
   */
  recommendClaim?: boolean;
}

/**
 * Render the storm history section. Returns '' when there is genuinely nothing to
 * show (degraded data with no events) so the report never advertises a data gap.
 */
export function renderStormSection(report: StormReport, opts: StormSectionOptions = {}): string {
  const recommendClaim = opts.recommendClaim !== false;
  const s = report.summary;
  const hasWind = (s.highest_wind_mph || 0) > 0 || s.wind_events > 0;
  const hasHail = (s.largest_hail_inches || 0) > 0;
  const significant = report.significant_events.filter(
    (e) => e.event_type.includes('Wind') || e.event_type === 'Tornado' || (e.hail_size_inches || 0) >= 1.0,
  );
  // Always surface the events behind the headline stats (largest hail, highest wind) so
  // no stat is an unbacked number the reader can't see in context, then fill with other
  // significant events (most recent first).
  const pool = significant.length ? significant : report.events;
  const byId = new Map<string, StormEvent>();
  const pushEv = (e?: StormEvent) => { if (e && e.id && !byId.has(e.id)) byId.set(e.id, e); };
  const largestHailEv = [...report.events].filter((e) => e.hail_size_inches).sort((a, b) => (b.hail_size_inches || 0) - (a.hail_size_inches || 0))[0];
  const highestWindEv = [...report.events].filter((e) => e.wind_speed_mph).sort((a, b) => (b.wind_speed_mph || 0) - (a.wind_speed_mph || 0))[0];
  // Always show the recommended Date-of-Loss event so an adjuster can find it in the table.
  const dolEv = report.recommended_date_of_loss ? report.events.find((e) => e.id === report.recommended_date_of_loss!.event_id) : undefined;
  pushEv(dolEv);
  pushEv(largestHailEv);
  pushEv(highestWindEv);
  for (const e of pool) { if (byId.size >= 6) break; pushEv(e); }
  const events = [...byId.values()].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Nothing verifiable to present — stay silent rather than advertise a gap.
  if (report.data_quality === 'degraded' && report.events.length === 0) return '';

  const dol = report.recommended_date_of_loss;
  const area = `${esc(report.city)}, ${esc(report.state)}`;

  // Attribute the data to the sources that actually produced it. Only credit the
  // NEXRAD radar network when the SWDI source (Storm Reports + NEXRAD Hail) actually
  // contributed events — otherwise every row came from NWS local storm reports and
  // claiming NEXRAD would overstate the authority behind the figures.
  const swdiContributed = report.data_source_details.some((d) => /SWDI/i.test(d.name) && d.status === 'success');
  const sourceClause = swdiContributed
    ? 'verified NOAA storm databases (the National Weather Service Storm Reports and the NEXRAD radar network)'
    : 'verified National Weather Service storm records (NOAA storm-event data and local storm-spotter reports)';

  const stat = (v: string, k: string) =>
    `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
  const stats: string[] = [];
  stats.push(stat(String(s.total_events), `Storm Events (${report.years_covered}-yr, ${report.search_radius_miles}mi)`));
  if (hasWind) stats.push(stat(String(s.wind_events), 'Wind Events'));
  if (s.highest_wind_mph) stats.push(stat(`${s.highest_wind_mph}`, 'Peak Wind (mph)'));
  if (hasHail) stats.push(stat(`${s.largest_hail_inches}"`, 'Largest Hail'));
  while (stats.length < 4 && s.hail_events >= 0 && stats.length === 3) stats.push(stat(String(s.hail_events), 'Hail Events'));

  const intro = recommendClaim
    ? `The roof shows storm damage consistent with the severe-weather history of ${area}. The records below are pulled from ${sourceClause} within ${report.search_radius_miles} miles of the property. They corroborate the damage documented on the roof and support filing an insurance claim. An insurance adjuster makes the final determination on coverage.`
    : `${area} sees frequent hail and high winds, and your roof takes the brunt of it. The records below are pulled from ${sourceClause} within ${report.search_radius_miles} miles of your home — useful context for why staying ahead of roof maintenance and sealing matters here. We share it so you can make an informed decision, not to push a claim.`;

  // Describe the headline event without repeating the type (e.g. avoid "Tornado, Tornado").
  const dolDesc = dol
    ? esc(dol.event_type) + (dol.magnitude && dol.magnitude !== dol.event_type ? `, ${esc(dol.magnitude)}` : '')
    : '';
  const dolBlock = !dol
    ? ''
    : recommendClaim
    ? `<div class="findings" style="border-left-color:var(--fire);margin-top:18px">
      <h3 class="findings-h" style="margin:0 0 6px;font-size:16px">Recommended Date of Loss for Your Claim</h3>
      <p style="margin:6px 0"><b>${esc(fmtDate(dol.date))}</b> — ${dolDesc}${dol.distance_miles != null ? `, ${dol.distance_miles.toFixed(1)} miles from the property` : ''}.</p>
      <p class="muted tiny" style="margin:6px 0 0">This is the most significant verified storm near your home during the period reviewed. It is the date we recommend referencing when you file. Your adjuster will confirm the date of loss and what your policy covers.</p>
    </div>`
    : `<div class="findings" style="border-left-color:var(--gold);margin-top:18px">
      <h3 class="findings-h" style="margin:0 0 6px;font-size:16px">Most Significant Nearby Storm</h3>
      <p style="margin:6px 0"><b>${esc(fmtDate(dol.date))}</b> — ${dolDesc}${dol.distance_miles != null ? `, ${dol.distance_miles.toFixed(1)} miles from your home` : ''}.</p>
      <p class="muted tiny" style="margin:6px 0 0">The strongest verified storm near your home during the period reviewed. We note it for context — if you ever notice damage after a storm like this, photograph it and call us.</p>
    </div>`;

  const rows = events
    .map((e) => {
      const mag = eventMagnitude(e);
      return `<tr>
        <td>${esc(fmtDate(e.date))}</td>
        <td>${esc(e.event_type)}</td>
        <td>${mag ? esc(mag) : '—'}</td>
        <td>${e.distance_miles != null ? `${e.distance_miles.toFixed(1)} mi` : '—'}</td>
      </tr>`;
    })
    .join('\n');
  const table = events.length
    ? `<table style="margin-top:18px">
      <thead><tr><th style="text-align:left">Date</th><th>Event</th><th>Magnitude</th><th>Distance</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`
    : '';

  const sourceNote = report.data_sources.length
    ? `<p class="muted tiny" style="margin:14px 0 0">Source: ${esc(report.data_sources.join('; '))}. Search radius ${report.search_radius_miles} miles over ${report.years_covered} years.</p>`
    : '';

  const claimNote = recommendClaim
    ? `<p style="margin:14px 0 0">${esc(companyBrand().displayName)} works directly with insurance adjusters. If you choose to file, we will meet your adjuster on the roof, walk the documented damage with them, and make sure nothing is missed. Filing a claim is your decision, and approval is always up to your carrier — but the storm history and the damage on your roof give you a well-supported case.</p>`
    : `<p style="margin:14px 0 0">This is why we recommend staying ahead of small problems — a sealed, maintained roof handles weather like this far better than one that's been let go. If a future storm ever does real damage, document it and give us a call; we can tell you honestly whether it's worth a claim.</p>`;

  return `<section class="sec">
    <div class="sec-head"><h2>Storm &amp; Weather History</h2><span class="n">${swdiContributed ? 'NOAA / NWS verified records' : 'NWS storm records'}</span></div>
    <p style="margin:0 0 14px">${intro}</p>
    <div class="stats">${stats.slice(0, 4).join('')}</div>
    ${dolBlock}
    ${table}
    ${claimNote}
    ${sourceNote}
  </section>`;
}
