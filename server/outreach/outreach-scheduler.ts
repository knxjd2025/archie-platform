/**
 * Outreach Scheduler
 *
 * Main orchestrator for daily lead outreach automation.
 * Follows the automation-scheduler.ts pattern from KontentFire.
 *
 * Pipeline:
 * 1. Trigger at campaign run time
 * 2. Scrape leads via BrightData
 * 3. Deduplicate against existing leads
 * 4. Enrich with Hunter.io (email finding + verification)
 * 5. AI personalization (subject + first line)
 * 6. Push to Instantly.ai
 * 7. Update database and schedule next run
 */

import { db } from '../db';
import { eq, and, lte, desc } from 'drizzle-orm';
import {
  outreachCampaigns,
  outreachLeads,
  outreachAttempts,
  scrapeJobs,
  emailTemplates,
  type OutreachCampaign,
  type OutreachLead,
  type EmailTemplate,
} from '../../shared/schema';
import {
  createLeadScraperService,
  buildSearchQueries,
  generateDedupeHash,
  type ScrapedLead,
} from './lead-scraper-service';
import { createHunterClient, findBestEmail, extractDomain } from './hunter-integration';
import { createAIPersonalizationService, generateTemplatePersonalization } from './ai-personalization-service';
import { createInstantlyClient, formatLeadForInstantly } from './instantly-integration';
import { addDaysIso, easternMidnight, easternNow } from '../canvass/daily-reminder';

const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const SEND_BATCH_INTERVAL_MS = 3 * 60 * 1000; // Check for emails to send every 3 minutes
const WARM_UP_SCHEDULE = [
  { days: 7, limit: 10 },
  { days: 14, limit: 25 },
  { days: 21, limit: 50 },
  { days: 28, limit: 100 },
  { days: Infinity, limit: 250 },
];

// Working hours for sending emails (in campaign's timezone)
const SEND_WINDOW_START_HOUR = 8; // 8 AM
const SEND_WINDOW_END_HOUR = 17; // 5 PM
const EMAILS_PER_BATCH = 3; // Send max 3 emails per batch check

/**
 * The hour (0-23) in Charlotte. The send window used `getHours()`, which is
 * the server's zone — UTC on Vercel — so "8 AM to 5 PM" was 4 AM to 1 PM
 * Eastern (3 AM to noon in winter). Same Intl approach as
 * the old ops brain's quiet hours.
 */
export function easternHour(d: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }).format(d),
  ) % 24;
}

export function inSendWindow(d: Date): boolean {
  const hour = easternHour(d);
  return hour >= SEND_WINDOW_START_HOUR && hour < SEND_WINDOW_END_HOUR;
}

/** The instant it is `hour`:00 in Charlotte on the Eastern date of `d` (plus `addDays`). */
export function easternClock(d: Date, hour: number, addDays = 0): Date {
  const dateIso = addDaysIso(easternNow(d).dateIso, addDays);
  return new Date(easternMidnight(dateIso).getTime() + hour * 3_600_000);
}
const MIN_MINUTES_BETWEEN_EMAILS = 10; // At least 10 minutes between each email

interface SchedulerConfig {
  brightDataApiKey?: string;
  hunterApiKey?: string;
  openaiApiKey?: string;
}

/**
 * Calculate daily limit based on warm-up period
 */
function calculateWarmUpLimit(startDate: Date | null): number {
  if (!startDate) return 10;

  const daysSinceStart = Math.floor(
    (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  for (const tier of WARM_UP_SCHEDULE) {
    if (daysSinceStart < tier.days) {
      return tier.limit;
    }
  }

  return 250;
}

/**
 * Calculate next run time based on campaign schedule
 */
function calculateNextRunTime(campaign: OutreachCampaign): Date {
  const [hours, minutes] = (campaign.runTime || '09:00').split(':').map(Number);
  const now = new Date();
  const nextRun = new Date();

  // Set to campaign's timezone (simplified - assumes Eastern)
  nextRun.setHours(hours, minutes, 0, 0);

  // If already past today's run time, schedule for tomorrow
  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1);
  }

  return nextRun;
}

/**
 * Calculate spaced send times throughout the day
 *
 * Instead of sending all emails at once, we spread them across working hours.
 * This looks more natural and helps deliverability.
 *
 * Example: 25 emails spread from 8 AM to 5 PM (9 hours = 540 minutes)
 * = 1 email every ~21 minutes
 */
function calculateSpacedSendTimes(emailCount: number, startDate: Date): Date[] {
  const sendTimes: Date[] = [];

  // Calculate working window in minutes
  const windowMinutes = (SEND_WINDOW_END_HOUR - SEND_WINDOW_START_HOUR) * 60; // 9 hours = 540 minutes

  // Calculate spacing between emails
  // Ensure at least MIN_MINUTES_BETWEEN_EMAILS between each
  const idealSpacing = Math.floor(windowMinutes / emailCount);
  const spacing = Math.max(idealSpacing, MIN_MINUTES_BETWEEN_EMAILS);

  // Add some randomness (+/- 3 minutes) to look more natural
  const addJitter = (baseMinutes: number) => {
    const jitter = Math.floor(Math.random() * 7) - 3; // -3 to +3 minutes
    return baseMinutes + jitter;
  };

  // Start from the beginning of the send window (Eastern)
  const baseDate = easternClock(startDate, SEND_WINDOW_START_HOUR);
  const endTime = easternClock(startDate, SEND_WINDOW_END_HOUR);

  for (let i = 0; i < emailCount; i++) {
    const minutesFromStart = addJitter(i * spacing);
    const sendTime = new Date(baseDate.getTime() + minutesFromStart * 60 * 1000);

    // Make sure we don't go past the end of the window
    if (sendTime <= endTime) {
      sendTimes.push(sendTime);
    }
  }

  return sendTimes;
}

/**
 * Get the next available send time
 * If we're outside working hours, schedule for next working day
 */
export function getNextAvailableSendTime(now: Date = new Date()): Date {
  // If we're in the working window, send now
  if (inSendWindow(now)) {
    return now;
  }

  // If it's before working hours today, schedule for start of today's window
  if (easternHour(now) < SEND_WINDOW_START_HOUR) {
    return easternClock(now, SEND_WINDOW_START_HOUR);
  }

  // If it's after working hours, schedule for tomorrow
  return easternClock(now, SEND_WINDOW_START_HOUR, 1);
}

/**
 * Main pipeline execution for a single campaign
 */
async function executeCampaignPipeline(
  campaign: OutreachCampaign,
  config: SchedulerConfig
): Promise<{
  leadsScraped: number;
  leadsEnriched: number;
  leadsPersonalized: number;
  emailsQueued: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let leadsScraped = 0;
  let leadsEnriched = 0;
  let leadsPersonalized = 0;
  let emailsQueued = 0;

  console.log(`[Outreach] Starting pipeline for campaign: ${campaign.name}`);

  // Calculate daily limit
  const dailyLimit = campaign.warmUpEnabled
    ? calculateWarmUpLimit(campaign.warmUpStartDate)
    : campaign.dailyLeadTarget || 250;

  // Get email template
  let template: EmailTemplate | null = null;
  if (campaign.emailTemplateId) {
    const [templateResult] = await db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.id, campaign.emailTemplateId));
    template = templateResult || null;
  }

  // Initialize services
  const scraper = createLeadScraperService(config.brightDataApiKey);
  const hunterClient = config.hunterApiKey ? createHunterClient(config.hunterApiKey) : null;
  const aiService = config.openaiApiKey
    ? createAIPersonalizationService(config.openaiApiKey)
    : null;
  const instantlyClient = campaign.instantlyApiKey
    ? createInstantlyClient(campaign.instantlyApiKey)
    : null;

  // Parse targeting configuration
  const industries = campaign.industries as string[];
  const locations = (campaign.targetLocations as Array<{ city: string; state: string }>) || [
    { city: 'Atlanta', state: 'GA' },
  ];

  // Build search queries
  const queries = buildSearchQueries(industries, locations, Math.ceil(dailyLimit / industries.length));

  // Create scrape job record
  const scrapeJobsToCreate = queries.map(q => ({
    campaignId: campaign.id,
    userId: campaign.userId,
    industry: q.industry,
    location: `${q.city}, ${q.state}`,
    searchQuery: q.query,
    targetCount: Math.ceil(dailyLimit / queries.length),
    status: 'pending' as const,
  }));

  // Step 1: Scrape leads
  const allScrapedLeads: ScrapedLead[] = [];

  for (const job of scrapeJobsToCreate) {
    try {
      // Insert job record
      const [insertedJob] = await db.insert(scrapeJobs).values(job).returning();

      // Update status to running
      await db
        .update(scrapeJobs)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(scrapeJobs.id, insertedJob.id));

      // Execute scrape
      const leads = await scraper.scrapeLeads(
        {
          industry: job.industry,
          city: job.location.split(', ')[0],
          state: job.location.split(', ')[1],
          query: job.searchQuery,
        },
        job.targetCount || 10
      );

      allScrapedLeads.push(...leads);
      leadsScraped += leads.length;

      // Update job status
      await db
        .update(scrapeJobs)
        .set({
          status: 'completed',
          leadsFound: leads.length,
          completedAt: new Date(),
        })
        .where(eq(scrapeJobs.id, insertedJob.id));
    } catch (error: any) {
      errors.push(`Scrape error for ${job.industry} in ${job.location}: ${error.message}`);
      console.error(`[Outreach] Scrape error:`, error);
    }

    // Rate limiting between scrape jobs
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`[Outreach] Scraped ${leadsScraped} total leads`);

  // Step 2: Deduplicate and insert leads
  const newLeads: OutreachLead[] = [];

  for (const scrapedLead of allScrapedLeads) {
    const dedupeHash = generateDedupeHash(scrapedLead.companyName, scrapedLead.website);

    // Check if already exists
    const existing = await db
      .select()
      .from(outreachLeads)
      .where(
        and(
          eq(outreachLeads.userId, campaign.userId),
          eq(outreachLeads.dedupeHash, dedupeHash)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      continue; // Skip duplicate
    }

    // Insert new lead
    try {
      const [insertedLead] = await db
        .insert(outreachLeads)
        .values({
          campaignId: campaign.id,
          userId: campaign.userId,
          companyName: scrapedLead.companyName,
          industry: scrapedLead.city ? `home_services` : 'unknown',
          website: scrapedLead.website,
          phone: scrapedLead.phone,
          address: scrapedLead.address,
          city: scrapedLead.city,
          state: scrapedLead.state,
          zipCode: scrapedLead.zipCode,
          ownerFirstName: scrapedLead.ownerFirstName,
          ownerLastName: scrapedLead.ownerLastName,
          googleRating: scrapedLead.googleRating?.toString() || null,
          googleReviewCount: scrapedLead.googleReviewCount,
          yearFounded: scrapedLead.yearFounded,
          linkedinUrl: scrapedLead.linkedinUrl,
          facebookUrl: scrapedLead.facebookUrl,
          dedupeHash,
          sourceUrl: scrapedLead.sourceUrl,
          status: 'scraped',
        })
        .returning();

      newLeads.push(insertedLead);
    } catch (error: any) {
      errors.push(`Insert error for ${scrapedLead.companyName}: ${error.message}`);
    }
  }

  console.log(`[Outreach] ${newLeads.length} new leads after deduplication`);

  // Step 3: Enrich leads with Hunter.io
  for (const lead of newLeads.slice(0, dailyLimit)) {
    if (!hunterClient || !lead.website) {
      continue;
    }

    try {
      // Update status
      await db
        .update(outreachLeads)
        .set({ status: 'enriching', updatedAt: new Date() })
        .where(eq(outreachLeads.id, lead.id));

      const emailResult = await findBestEmail(hunterClient, {
        website: lead.website,
        ownerFirstName: lead.ownerFirstName,
        ownerLastName: lead.ownerLastName,
        companyName: lead.companyName,
      });

      if (emailResult.email) {
        await db
          .update(outreachLeads)
          .set({
            ownerEmail: emailResult.email,
            emailVerified: emailResult.confidence >= 70,
            emailVerificationSource: emailResult.source,
            emailVerificationScore: String(emailResult.confidence),
            status: 'enriched',
            updatedAt: new Date(),
          })
          .where(eq(outreachLeads.id, lead.id));

        lead.ownerEmail = emailResult.email;
        leadsEnriched++;
      }
    } catch (error: any) {
      errors.push(`Enrich error for ${lead.companyName}: ${error.message}`);
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`[Outreach] ${leadsEnriched} leads enriched with emails`);

  // Step 4: AI Personalization
  const enrichedLeads = newLeads.filter(l => l.ownerEmail);

  for (const lead of enrichedLeads.slice(0, dailyLimit)) {
    try {
      // Update status
      await db
        .update(outreachLeads)
        .set({ status: 'personalizing', updatedAt: new Date() })
        .where(eq(outreachLeads.id, lead.id));

      let personalization;

      if (aiService) {
        personalization = await aiService.generatePersonalization({
          companyName: lead.companyName,
          industry: lead.industry,
          ownerFirstName: lead.ownerFirstName,
          ownerLastName: lead.ownerLastName,
          city: lead.city || '',
          state: lead.state || '',
          yearFounded: lead.yearFounded,
          googleRating: lead.googleRating ? parseFloat(lead.googleRating) : null,
          googleReviewCount: lead.googleReviewCount,
          linkedinUrl: lead.linkedinUrl,
          website: lead.website,
        });
      } else {
        personalization = generateTemplatePersonalization({
          companyName: lead.companyName,
          industry: lead.industry,
          ownerFirstName: lead.ownerFirstName,
          ownerLastName: lead.ownerLastName,
          city: lead.city || '',
          state: lead.state || '',
          yearFounded: lead.yearFounded,
          googleRating: lead.googleRating ? parseFloat(lead.googleRating) : null,
          googleReviewCount: lead.googleReviewCount,
        });
      }

      await db
        .update(outreachLeads)
        .set({
          personalizedSubjectLine: personalization.subjectLine,
          personalizedFirstLine: personalization.firstLine,
          status: 'personalized',
          updatedAt: new Date(),
        })
        .where(eq(outreachLeads.id, lead.id));

      lead.personalizedSubjectLine = personalization.subjectLine;
      lead.personalizedFirstLine = personalization.firstLine;
      leadsPersonalized++;
    } catch (error: any) {
      errors.push(`Personalization error for ${lead.companyName}: ${error.message}`);
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log(`[Outreach] ${leadsPersonalized} leads personalized`);

  // Step 5: Schedule emails for spaced sending throughout the day
  // Instead of pushing directly to Instantly, we schedule send times
  const personalizedLeads = newLeads.filter(l => l.personalizedSubjectLine && l.ownerEmail);
  const leadsToSchedule = personalizedLeads.slice(0, dailyLimit);

  if (leadsToSchedule.length > 0) {
    // Calculate spaced send times
    const sendTimes = calculateSpacedSendTimes(leadsToSchedule.length, new Date());

    console.log(`[Outreach] Scheduling ${leadsToSchedule.length} emails from ${sendTimes[0]?.toLocaleTimeString()} to ${sendTimes[sendTimes.length - 1]?.toLocaleTimeString()}`);

    for (let i = 0; i < leadsToSchedule.length; i++) {
      const lead = leadsToSchedule[i];
      const scheduledTime = sendTimes[i] || getNextAvailableSendTime();

      try {
        // Update lead with scheduled send time
        await db
          .update(outreachLeads)
          .set({
            status: 'queued',
            scheduledSendAt: scheduledTime,
            updatedAt: new Date(),
          })
          .where(eq(outreachLeads.id, lead.id));

        emailsQueued++;
      } catch (error: any) {
        errors.push(`Schedule error for ${lead.companyName}: ${error.message}`);
      }
    }

    console.log(`[Outreach] ${emailsQueued} emails scheduled for spaced delivery`);
  }

  console.log(`[Outreach] ${emailsQueued} emails queued to Instantly`);

  // Step 6: Update campaign stats and schedule next run
  const nextRun = calculateNextRunTime(campaign);

  await db
    .update(outreachCampaigns)
    .set({
      totalLeadsGenerated: (campaign.totalLeadsGenerated || 0) + newLeads.length,
      totalEmailsSent: (campaign.totalEmailsSent || 0) + emailsQueued,
      currentDailyLimit: calculateWarmUpLimit(campaign.warmUpStartDate),
      lastRunAt: new Date(),
      nextRunAt: nextRun,
      updatedAt: new Date(),
    })
    .where(eq(outreachCampaigns.id, campaign.id));

  return {
    leadsScraped,
    leadsEnriched,
    leadsPersonalized,
    emailsQueued,
    errors,
  };
}

/**
 * Check for campaigns due to run
 */
async function checkAndExecuteCampaigns(config: SchedulerConfig): Promise<void> {
  const now = new Date();

  // Find campaigns that are active and due to run
  const dueCampaigns = await db
    .select()
    .from(outreachCampaigns)
    .where(
      and(
        eq(outreachCampaigns.status, 'active'),
        lte(outreachCampaigns.nextRunAt, now)
      )
    )
    .limit(5); // Process max 5 campaigns per check

  for (const campaign of dueCampaigns) {
    try {
      console.log(`[Outreach] Executing campaign: ${campaign.name} (ID: ${campaign.id})`);
      const result = await executeCampaignPipeline(campaign, config);
      console.log(`[Outreach] Campaign ${campaign.name} completed:`, result);
    } catch (error: any) {
      console.error(`[Outreach] Campaign ${campaign.name} failed:`, error);

      // Update campaign with error
      await db
        .update(outreachCampaigns)
        .set({
          lastRunAt: new Date(),
          nextRunAt: calculateNextRunTime(campaign),
          updatedAt: new Date(),
        })
        .where(eq(outreachCampaigns.id, campaign.id));
    }
  }
}

/**
 * Process scheduled emails that are due to be sent
 *
 * This runs every few minutes and sends emails that have reached
 * their scheduled send time. This creates natural spacing throughout
 * the day instead of sending all at once.
 */
async function processScheduledEmails(config: SchedulerConfig): Promise<void> {
  const now = new Date();

  // Only send during working hours (Eastern)
  if (!inSendWindow(now)) {
    return;
  }

  // Find leads that are due to be sent
  const dueLeads = await db
    .select({
      lead: outreachLeads,
      campaign: outreachCampaigns,
    })
    .from(outreachLeads)
    .innerJoin(outreachCampaigns, eq(outreachLeads.campaignId, outreachCampaigns.id))
    .where(
      and(
        eq(outreachLeads.status, 'queued'),
        lte(outreachLeads.scheduledSendAt, now)
      )
    )
    .orderBy(outreachLeads.scheduledSendAt)
    .limit(EMAILS_PER_BATCH);

  if (dueLeads.length === 0) {
    return;
  }

  console.log(`[Outreach] Sending ${dueLeads.length} scheduled emails...`);

  for (const { lead, campaign } of dueLeads) {
    // Skip if campaign doesn't have Instantly configured
    if (!campaign.instantlyApiKey || !campaign.instantlyCampaignId) {
      console.log(`[Outreach] Skipping lead ${lead.id} - campaign ${campaign.id} missing Instantly config`);
      continue;
    }

    try {
      const instantlyClient = createInstantlyClient(campaign.instantlyApiKey);

      // Get email template if available
      let template: EmailTemplate | null = null;
      if (campaign.emailTemplateId) {
        const [templateResult] = await db
          .select()
          .from(emailTemplates)
          .where(eq(emailTemplates.id, campaign.emailTemplateId));
        template = templateResult || null;
      }

      // Format and add to Instantly
      const instantlyLead = formatLeadForInstantly({
        ownerEmail: lead.ownerEmail!,
        ownerFirstName: lead.ownerFirstName,
        ownerLastName: lead.ownerLastName,
        companyName: lead.companyName,
        website: lead.website,
        phone: lead.phone,
        personalizedSubjectLine: lead.personalizedSubjectLine,
        personalizedFirstLine: lead.personalizedFirstLine,
        city: lead.city,
        state: lead.state,
        industry: lead.industry,
        yearFounded: lead.yearFounded,
        googleRating: lead.googleRating,
      });

      const result = await instantlyClient.addLead(campaign.instantlyCampaignId, instantlyLead);

      // Create outreach attempt record
      await db.insert(outreachAttempts).values({
        leadId: lead.id,
        campaignId: campaign.id,
        userId: campaign.userId,
        emailSubject: lead.personalizedSubjectLine!,
        emailFirstLine: lead.personalizedFirstLine!,
        emailBody: template?.bodyTemplate || '',
        instantlyEmailId: result.lead_id,
        status: 'pending',
      });

      // Update lead as sent
      await db
        .update(outreachLeads)
        .set({
          instantlyLeadId: result.lead_id,
          status: 'sent',
          actualSentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(outreachLeads.id, lead.id));

      // Update campaign stats
      await db
        .update(outreachCampaigns)
        .set({
          totalEmailsSent: (campaign.totalEmailsSent || 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(outreachCampaigns.id, campaign.id));

      console.log(`[Outreach] Sent email to ${lead.ownerEmail} (${lead.companyName})`);
    } catch (error: any) {
      console.error(`[Outreach] Failed to send to ${lead.ownerEmail}:`, error.message);

      // Mark as failed
      await db
        .update(outreachLeads)
        .set({
          status: 'failed',
          updatedAt: new Date(),
        })
        .where(eq(outreachLeads.id, lead.id));
    }

    // Small delay between sends
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

/**
 * Initialize the outreach scheduler
 */
export function initOutreachScheduler(config: SchedulerConfig): void {
  if (process.env.ENABLE_OUTREACH !== 'true') {
    console.log('[Outreach Scheduler] Disabled (ENABLE_OUTREACH !== true)');
    return;
  }

  console.log('[Outreach Scheduler] Starting...');

  // Initial check
  setTimeout(() => {
    checkAndExecuteCampaigns(config).catch(console.error);
  }, 10000); // Wait 10 seconds for server to fully start

  // Schedule regular campaign checks
  setInterval(() => {
    checkAndExecuteCampaigns(config).catch(console.error);
  }, SCHEDULER_INTERVAL_MS);

  // Schedule the batch email sender
  // This runs more frequently to send emails at their scheduled times
  setInterval(() => {
    processScheduledEmails(config).catch(console.error);
  }, SEND_BATCH_INTERVAL_MS);

  console.log(`[Outreach Scheduler] Campaign check: every ${SCHEDULER_INTERVAL_MS / 1000 / 60} minutes`);
  console.log(`[Outreach Scheduler] Email sender: every ${SEND_BATCH_INTERVAL_MS / 1000 / 60} minutes, ${EMAILS_PER_BATCH} emails per batch`);
  console.log(`[Outreach Scheduler] Send window: ${SEND_WINDOW_START_HOUR}:00 - ${SEND_WINDOW_END_HOUR}:00`);
}

/**
 * Manually trigger a campaign run (for testing)
 */
export async function triggerCampaignRun(
  campaignId: number,
  config: SchedulerConfig
): Promise<ReturnType<typeof executeCampaignPipeline>> {
  const [campaign] = await db
    .select()
    .from(outreachCampaigns)
    .where(eq(outreachCampaigns.id, campaignId));

  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  return executeCampaignPipeline(campaign, config);
}

/**
 * Check and run due campaigns (for Vercel Cron)
 * Returns summary of what was processed
 */
export async function checkAndRunDueCampaigns(
  config: SchedulerConfig
): Promise<{ campaignsProcessed: number; results: any[] }> {
  const results: any[] = [];
  const now = new Date();

  // Find campaigns that are active and due to run
  const dueCampaigns = await db
    .select()
    .from(outreachCampaigns)
    .where(
      and(
        eq(outreachCampaigns.status, 'active'),
        lte(outreachCampaigns.nextRunAt, now)
      )
    )
    .limit(3); // Process max 3 campaigns per cron run (Vercel timeout)

  for (const campaign of dueCampaigns) {
    try {
      console.log(`[Cron] Executing campaign: ${campaign.name} (ID: ${campaign.id})`);
      const result = await executeCampaignPipeline(campaign, config);
      results.push({ campaignId: campaign.id, name: campaign.name, ...result });
    } catch (error: any) {
      console.error(`[Cron] Campaign ${campaign.name} failed:`, error);
      results.push({ campaignId: campaign.id, name: campaign.name, error: error.message });

      // Update campaign for retry tomorrow
      await db
        .update(outreachCampaigns)
        .set({
          lastRunAt: new Date(),
          nextRunAt: calculateNextRunTime(campaign),
          updatedAt: new Date(),
        })
        .where(eq(outreachCampaigns.id, campaign.id));
    }
  }

  return { campaignsProcessed: dueCampaigns.length, results };
}

/**
 * Send scheduled emails (for Vercel Cron)
 * Returns summary of what was sent
 */
export async function sendScheduledEmails(
  config: SchedulerConfig
): Promise<{ emailsSent: number; errors: string[] }> {
  const errors: string[] = [];
  let emailsSent = 0;

  const now = new Date();

  // Only send during working hours (Eastern)
  if (!inSendWindow(now)) {
    return { emailsSent: 0, errors: ['Outside working hours'] };
  }

  // Find leads that are due to be sent
  const dueLeads = await db
    .select({
      lead: outreachLeads,
      campaign: outreachCampaigns,
    })
    .from(outreachLeads)
    .innerJoin(outreachCampaigns, eq(outreachLeads.campaignId, outreachCampaigns.id))
    .where(
      and(
        eq(outreachLeads.status, 'queued'),
        lte(outreachLeads.scheduledSendAt, now)
      )
    )
    .orderBy(outreachLeads.scheduledSendAt)
    .limit(5); // Send max 5 per cron run

  for (const { lead, campaign } of dueLeads) {
    if (!campaign.instantlyApiKey || !campaign.instantlyCampaignId) {
      continue;
    }

    try {
      const instantlyClient = createInstantlyClient(campaign.instantlyApiKey);

      const instantlyLead = formatLeadForInstantly({
        ownerEmail: lead.ownerEmail!,
        ownerFirstName: lead.ownerFirstName,
        ownerLastName: lead.ownerLastName,
        companyName: lead.companyName,
        website: lead.website,
        phone: lead.phone,
        personalizedSubjectLine: lead.personalizedSubjectLine,
        personalizedFirstLine: lead.personalizedFirstLine,
        city: lead.city,
        state: lead.state,
        industry: lead.industry,
        yearFounded: lead.yearFounded,
        googleRating: lead.googleRating,
      });

      const result = await instantlyClient.addLead(campaign.instantlyCampaignId, instantlyLead);

      // Create attempt record
      await db.insert(outreachAttempts).values({
        leadId: lead.id,
        campaignId: campaign.id,
        userId: campaign.userId,
        emailSubject: lead.personalizedSubjectLine!,
        emailFirstLine: lead.personalizedFirstLine!,
        emailBody: '',
        instantlyEmailId: result.lead_id,
        status: 'pending',
      });

      // Update lead as sent
      await db
        .update(outreachLeads)
        .set({
          instantlyLeadId: result.lead_id,
          status: 'sent',
          actualSentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(outreachLeads.id, lead.id));

      // Update campaign stats
      await db
        .update(outreachCampaigns)
        .set({
          totalEmailsSent: (campaign.totalEmailsSent || 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(outreachCampaigns.id, campaign.id));

      emailsSent++;
    } catch (error: any) {
      errors.push(`${lead.companyName}: ${error.message}`);
      await db
        .update(outreachLeads)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(outreachLeads.id, lead.id));
    }
  }

  return { emailsSent, errors };
}

export default initOutreachScheduler;
