/**
 * The NOAA record behind a storm claim: recommended date of loss, the
 * biggest hail and wind on file, and the year-by-year count. Shared by the
 * Inspection and the Proposal so the adjuster and the homeowner read the same
 * numbers. Only on a job that is actually a claim (rep-confirmed storm, or
 * an insurance job type) — on a retail document this would imply a claim
 * nobody made. Returns '' otherwise.
 */
import { esc } from '../report-theme.js';
import { factGrid, type SectionStyle } from './style.js';

function fmtDate(iso: string): string {
  const d = new Date(iso + (iso?.length === 10 ? 'T12:00:00' : ''));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function isClaimContext(report: any, jobType?: 'retail' | 'insurance'): boolean {
  return !!report?.repConfirmedStorm || jobType === 'insurance';
}

export function stormEvidence(report: any, jobType: 'retail' | 'insurance' | undefined, style: SectionStyle): string {
  const s = report?.stormHistory;
  if (!s?.totalEvents) return '';
  if (!isClaimContext(report, jobType)) return '';
  const years = Object.entries(s.eventsByYear || {}).sort(([a], [b]) => Number(b) - Number(a)).slice(0, 4) as Array<[string, { hail: number; wind: number; total: number }]>;
  const yearLine = years.length ? years.map(([y, c]) => `${y}: ${c.total} (${c.hail} hail, ${c.wind} wind)`).join(' &middot; ') : '';
  const dol = s.recommendedDateOfLoss;
  const rep = report.repConfirmedStorm;
  return `<div class="storm-evidence">
      <p class="${esc(style.label)}">On the record &middot; NOAA</p>
      ${factGrid([
        ['Storm documented by inspector', rep ? `${fmtDate(rep.date)} &mdash; ${esc(rep.type)}` : null],
        ['Recommended date of loss', dol ? `${fmtDate(dol.date)} &mdash; ${esc(dol.magnitude)} ${esc(dol.eventType)}` : null],
        ['Largest hail nearby', s.largestHailInches ? `${s.largestHailInches}&Prime;` : null],
        ['Highest wind nearby', s.highestWindMph ? `${s.highestWindMph} mph` : null],
        [`Storms within ${s.searchRadiusMiles ?? 5} mi, ${s.yearsAnalyzed ?? 3} yr`, `${s.totalEvents} (${s.hailEvents} hail, ${s.windEvents} wind)`],
      ])}
      ${yearLine ? `<p class="${esc(style.note)}">By year &mdash; ${yearLine}. Source: NOAA storm records. An insurance adjuster makes the final coverage determination.</p>` : ''}
    </div>`;
}
