/**
 * Outreach Automation Module
 *
 * Exports all outreach-related services for daily lead outreach automation.
 */

export { default as initOutreachScheduler, triggerCampaignRun } from './outreach-scheduler';
export {
  createInstantlyClient,
  formatLeadForInstantly,
  validateInstantlyWebhook,
  parseInstantlyWebhookEvent,
  type InstantlyLead,
  type InstantlyCampaign,
  type InstantlyWebhookEvent,
} from './instantly-integration';
export {
  createHunterClient,
  findBestEmail,
  extractDomain,
  generateEmailPatterns,
  isEmailSendable,
  batchVerifyEmails,
  type HunterEmail,
  type HunterVerificationResult,
} from './hunter-integration';
export {
  createLeadScraperService,
  buildSearchQueries,
  generateDedupeHash,
  parseOwnerName,
  parseYearFounded,
  extractSocialLinks,
  HOME_SERVICE_INDUSTRIES,
  MAJOR_US_CITIES,
  type ScrapedLead,
  type SearchQuery,
  type HomeServiceIndustry,
} from './lead-scraper-service';
export {
  createAIPersonalizationService,
  generateTemplatePersonalization,
  batchGeneratePersonalizations,
  type PersonalizationContext,
  type PersonalizationResult,
} from './ai-personalization-service';
