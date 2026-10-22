import { runSync, type SyncResult } from './run';
import { syncJobtread } from './jobtread-sync';
import { syncCalendar } from './calendar-sync';
import { syncLeads } from './leads-sync';
import { syncRoofLink } from './rooflink-sync';
import { syncClaimsFromJobTread } from '../claims/from-jobtread';
import { syncSalesRepsFromJobTread } from './jobtread-reps';

export async function runAllSyncs(): Promise<SyncResult[]> {
  // Sequential so one source's failure is isolated and logged before the next.
  const results: SyncResult[] = [];
  results.push(await runSync('jobtread', syncJobtread));
  // Before leads: a rep JobTread just added gets mapped (by exact name) so
  // this run's leads are already visible to them.
  results.push(await runSync('reps', async () => {
    const r = await syncSalesRepsFromJobTread();
    return { options: r.options.length, linked: r.linked, unmapped: r.unmapped.length, stale: r.stale.length };
  }));
  results.push(await runSync('leads', syncLeads));
  // Boards follow JobTread forward: a status someone changed in JobTread
  // moves the job's production/sales rows on (never back).
  results.push(await runSync('pipelines', async () => {
    const { reconcileWithJobTread } = await import('../pipelines/automation');
    return { ...(await reconcileWithJobTread()) };
  }));
  results.push(await runSync('calendar', () => syncCalendar()));
  // After jobtread, so it reads the stages this run just refreshed. A job
  // sitting in NTS Sent or Pre-Supplementing is a live claim, and it belongs
  // on the claims board without anyone re-keying it.
  results.push(await runSync('claims', async () => ({ ...(await syncClaimsFromJobTread()) })));
  return results;
}

/**
 * RoofLink runs on its own cron (vercel.json: 30 past the hour), not inside
 * runAllSyncs: its API is slow enough (~15s a page, ~19 pages) that sharing
 * the 300s function budget with the JobTread pull risked the whole hourly
 * run being killed. Scheduled after the top-of-the-hour run so it reads the
 * JobTread leads just refreshed and only adds clients the app lacks.
 */
export async function runRoofLinkSync(): Promise<SyncResult> {
  return runSync('rooflink', () => syncRoofLink());
}
