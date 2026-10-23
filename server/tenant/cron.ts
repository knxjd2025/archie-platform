/**
 * Scheduled jobs in Archie.
 *
 * A cron request carries no company. Every job that touches company data runs
 * once per live company, as that company (forEachLiveCompany), so it can never
 * read or write across companies.
 *
 * The Best Roofing AI app had jobs tied to one company's own systems (JobTread
 * syncs, a Gmail inbox watcher, the ops "brain", outreach, RoofLink). They are
 * not part of Archie; their paths answer 410 so a stray schedule cannot run them.
 */
import type { Express, Request, Response } from 'express';

export const DISABLED_IN_ARCHIE = [
  '/api/cron/outreach-campaigns',
  '/api/cron/outreach-send',
  '/api/cron/brain-sweep',
  '/api/cron/brain-digest',
  '/api/jobtread-archive/cron',
  '/api/sync/cron',
  '/api/sync/rooflink/cron',
  '/api/cron/inbox-watch',
  '/api/cron/bug-digest',
];

/**
 * Whole areas of the Best Roofing AI app that were one company's own phone
 * and message plumbing (its Twilio numbers, a Vapi voice assistant and a Mac
 * iMessage bridge, both removed, JobTread webhooks, a public project map for
 * its website). In Archie, calls, texts and the AI voice agent go through each
 * company's GHL sub-account (GHL Voice AI).
 */
export const DISABLED_PREFIXES_IN_ARCHIE = [
  '/api/vapi',
  '/api/voice',
  '/api/imessage',
  '/api/webhooks/twilio',
  '/api/webhooks/jobtread',
  '/api/projects-map',
];

/** Registered before every other route, so these never reach their old handlers. */
export function blockDisabledJobs(app: Express): void {
  const gone = (_req: Request, res: Response) => { res.status(410).json({ error: 'This is not part of Archie.' }); };
  app.all(DISABLED_IN_ARCHIE, gone);
  app.use(DISABLED_PREFIXES_IN_ARCHIE, gone);
}
