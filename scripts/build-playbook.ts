/**
 * Build shared/playbook/library.json from a folder of extracted text files
 * (one per source document; the file name carries the folder path with "__"
 * separators — see the corpus produced by textutil/pdftotext). The library is
 * committed; this script is run when the source documents change.
 *
 *   npx tsx scripts/build-playbook.ts <corpus-dir>
 *
 * Curation rules: exact duplicates and COVID-era variants are dropped; where
 * the same letter exists once per rep, James's copy becomes the template
 * with his name, cell and email replaced by placeholders; vendor copyright
 * and disclaimer boilerplate is stripped; every [PLACEHOLDER] is listed so
 * the app can fill it.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

type Group = 'process' | 'scripts' | 'objections' | 'letters' | 'emails' | 'productivity';
type Kind = 'checklist' | 'guide' | 'script' | 'letter' | 'email' | 'reference';
interface Entry { match: RegExp; id: string; title: string; group: Group; kind: Kind; audience?: string; stage?: string; tags?: string[] }

/** Which documents make the library, in the order the Playbook shows them. */
const CATALOG: Entry[] = [
  // Process — the start-to-finish system
  { match: /MultiTouchMarketingChecklist/, id: 'multi-touch-checklist', title: 'Multi-Touch Marketing Checklist (open a neighborhood)', group: 'process', kind: 'checklist', tags: ['canvassing'] },
  { match: /Checklists__NewCustomerChecklist/, id: 'checklist-new-customer', title: 'New Customer Checklist', group: 'process', kind: 'checklist', stage: 'sold' },
  { match: /Checklists__JobScheduledChecklist-210407-103440\.txt$/, id: 'checklist-job-scheduled', title: 'Job Scheduled Checklist', group: 'process', kind: 'checklist', stage: 'scheduled' },
  { match: /Checklists__DayofInstallationChecklist/, id: 'checklist-day-of-install', title: 'Day of Installation Checklist', group: 'process', kind: 'checklist', stage: 'install' },
  { match: /Checklists__InstallationCompleteChecklist/, id: 'checklist-install-complete', title: 'Installation Complete Checklist', group: 'process', kind: 'checklist', stage: 'complete' },
  { match: /Checklists__PaidinFullChecklist/, id: 'checklist-paid-in-full', title: 'Paid in Full Checklist', group: 'process', kind: 'checklist', stage: 'paid' },
  { match: /InsuranceAgentCOLDOutreachChecklist/, id: 'checklist-insurance-agent-outreach', title: 'Insurance Agent Cold Outreach Checklist', group: 'process', kind: 'checklist', audience: 'insurance agents' },
  { match: /RealtorsHomesforSaleOutreachChecklist/, id: 'checklist-realtor-outreach', title: 'Realtors & Homes for Sale Outreach Checklist', group: 'process', kind: 'checklist', audience: 'realtors' },
  { match: /CompleteSALESStrategyMasterGuide.*\.pdf\.txt$/, id: 'master-guide', title: 'Complete Sales Strategy Master Guide', group: 'process', kind: 'guide' },
  { match: /12StepSalesProcessFromInspectiontoSale/, id: '12-step-sales-process', title: '12-Step Sales Process: Inspection to Sale', group: 'process', kind: 'guide' },
  { match: /3TrickstoCloseMoreSales.*\.pdf\.txt$/, id: '3-tricks-kitchen-table', title: '3 Tricks to Get to the Kitchen Table', group: 'process', kind: 'guide' },
  { match: /CARPARKReferenceSheetFULLStormandRetail.*\.txt$/, id: 'carpark', title: 'CARPARK Closing Formula (Storm & Retail)', group: 'objections', kind: 'reference' },
  { match: /ClosingStrategyCheatSheetPrintOut.*\.pdf\.txt$/, id: 'closing-cheat-sheet', title: 'Closing Strategy Cheat Sheet (print-out)', group: 'objections', kind: 'reference' },
  { match: /SLAPFormulaForPitchingattheDoor/, id: 'slap-formula', title: 'S.L.A.P. Formula for Pitching at the Door', group: 'scripts', kind: 'reference', tags: ['canvassing'] },
  { match: /ReferralProgramCheatSheet/, id: 'referral-cheat-sheet', title: 'Referral Program Cheat Sheet (leave with the customer)', group: 'process', kind: 'reference' },
  // Scripts
  { match: /Scripts__CanvassingScriptsdooropeners-BRN/, id: 'canvassing-openers', title: 'Canvassing Scripts: Door Openers', group: 'scripts', kind: 'script', tags: ['canvassing'] },
  { match: /Scripts__Residential Cold Calling Script/, id: 'residential-cold-call', title: 'Residential Cold Calling Script', group: 'scripts', kind: 'script' },
  { match: /InboundLeadCallScripts-230730-190851\.txt$/, id: 'inbound-lead-scripts', title: 'Inbound Lead Call Scripts (call-in and online leads)', group: 'scripts', kind: 'script' },
  { match: /Battle Pack__Commercial__CommercialColdCallingScript/, id: 'commercial-cold-call', title: 'Commercial Cold Calling Script', group: 'scripts', kind: 'script', audience: 'commercial' },
  { match: /Insurance Agent__InsuranceAgentColdCallIntroScript/, id: 'insurance-agent-call', title: 'Insurance Agent Cold Call Intro Script', group: 'scripts', kind: 'script', audience: 'insurance agents' },
  { match: /Battle Pack__Realtors and Homes for Sales__RealtorListingsColdCallingScript/, id: 'realtor-listing-call', title: 'Realtor Listings Call Script', group: 'scripts', kind: 'script', audience: 'realtors' },
  { match: /ReferralCallScripttoSetAppointments/, id: 'referral-call', title: 'Referral Call Script to Set Appointments', group: 'scripts', kind: 'script' },
  { match: /FollowUpTemplatesEmailTextandCall/, id: 'follow-up-templates', title: 'Follow-Up Scripts: Call, Email and Text', group: 'scripts', kind: 'script' },
  // Objections & training
  { match: /OBJECTIONStrategyGuide.*\.pdf\.txt$/, id: 'objection-guide', title: 'Objection Strategy Guide (the ARO formula)', group: 'objections', kind: 'guide' },
  { match: /RolePlayTrainingGuide\.pdf\.txt$/, id: 'role-play-guide', title: 'Role Play Training Guide', group: 'objections', kind: 'guide' },
  { match: /AcingYourPitch/, id: 'acing-your-pitch', title: 'Acing Your Pitch', group: 'objections', kind: 'guide' },
  { match: /SellingSecrets_NeedsvsDesires/, id: 'needs-vs-desires', title: 'Selling Secrets: Needs vs. Desires', group: 'objections', kind: 'guide' },
  { match: /RoofervsStormRestorationContractor/, id: 'roofer-vs-restoration', title: 'Roofer vs. Storm Restoration Contractor', group: 'objections', kind: 'guide' },
  { match: /HowtoSellUsingtheContingencyAgreement/, id: 'selling-with-contingency', title: 'How to Sell Using the Contingency Agreement', group: 'objections', kind: 'guide' },
  { match: /TRSContingencySample/, id: 'contingency-sample', title: 'Sample Insurance Contingency Agreement', group: 'objections', kind: 'reference' },
  { match: /Pitch Book Template__PitchBookTemplate/, id: 'pitch-book', title: 'Pitch Book Template', group: 'objections', kind: 'reference' },
  { match: /Roof Components__Roof Components/, id: 'roof-components-video', title: 'Roof Components (training video)', group: 'objections', kind: 'reference' },
  // Letters — leave-behinds and direct mail
  { match: /Door Hangers and Letters__DoorHangerLetterLeavebehind/, id: 'door-hanger-sorry-missed-you', title: 'Door Hanger: Sorry I Missed You', group: 'letters', kind: 'letter', audience: 'homeowners' },
  { match: /Letters__Mail-out Letter__SorryIMissedYouDirectMailLetter/, id: 'mail-sorry-missed-you', title: 'Sorry I Missed You (direct mail)', group: 'letters', kind: 'letter', audience: 'homeowners' },
  { match: /Door Hangers and Letters__NeighborAnnouncementBeforeBuild/, id: 'neighbor-announcement-before-build', title: 'Neighbor Announcement: Before the Build (leave-behind)', group: 'letters', kind: 'letter', audience: 'neighbors', stage: 'scheduled' },
  { match: /Letters__Leave Behind Letters__12PackGenerator_LeaveBehindDuringInstall/, id: '12-pack-during-install', title: '12-Pack Generator: Leave-Behind During Install', group: 'letters', kind: 'letter', audience: 'neighbors', stage: 'install' },
  { match: /Letters__Mail-out Letter__InstallNoticeNeighborhoodAnnouncement/, id: 'install-notice-mail', title: 'Install Notice: Neighborhood Announcement (direct mail)', group: 'letters', kind: 'letter', audience: 'neighbors', stage: 'scheduled' },
  { match: /Letters__Mail-out Letter__Wedidyourneighborsroofletter/, id: 'we-did-your-neighbors-roof', title: "We Did Your Neighbor's Roof (direct mail)", group: 'letters', kind: 'letter', audience: 'neighbors', stage: 'complete' },
  { match: /Letters__Mail-out Letter__FollowUpLetter/, id: 'follow-up-letter', title: 'Follow-Up Direct Mail Letter', group: 'letters', kind: 'letter', audience: 'homeowners' },
  { match: /Letters__Mail-out Letter__TiredofRoofersatYourDoor/, id: 'tired-of-roofers', title: 'Tired of Roofers at Your Door? (direct mail)', group: 'letters', kind: 'letter', audience: 'homeowners' },
  { match: /Letters__Mail-out Letter__WindDamageLetter/, id: 'wind-damage-letter', title: 'Wind Damage Letter', group: 'letters', kind: 'letter', audience: 'homeowners' },
  { match: /Direct Mail Letters__Old Storm Damage Letter__James/, id: 'old-storm-damage-letter', title: 'Old Storm Damage Letter', group: 'letters', kind: 'letter', audience: 'homeowners' },
  { match: /Direct Mail Letters__3-Tab Shingles Letter__James/, id: '3-tab-shingles-letter', title: '3-Tab Shingles Letter', group: 'letters', kind: 'letter', audience: 'homeowners' },
  { match: /Letters__Mail-out Letter__DiscontinuedShingleLetter/, id: 'discontinued-shingle-letter', title: 'Discontinued Shingle Letter', group: 'letters', kind: 'letter', audience: 'homeowners' },
  { match: /Under the Radar Sales Letter__James/, id: 'under-the-radar-letter', title: 'Under the Radar Sales Letter', group: 'letters', kind: 'letter', audience: 'homeowners' },
  { match: /Letters__Mail-out Letter__NeedaSecondOpinion_/, id: 'denied-underpaid-letter', title: 'Denied or Underpaid Claim? Need a Second Opinion (direct mail)', group: 'letters', kind: 'letter', audience: 'homeowners' },
  { match: /Letters__Mail-out Letter__CustomerHitByNEWStorm/, id: 'customer-hit-by-new-storm', title: 'Past Customer Hit by a New Storm', group: 'letters', kind: 'letter', audience: 'past customers' },
  { match: /Letters__Mail-out Letter__MissedSaleThankYouLetter/, id: 'missed-sale-thank-you-letter', title: 'Missed Sale Thank You Letter', group: 'letters', kind: 'letter', audience: 'lost leads' },
  { match: /Thank You Letter and Email__ThankYouLettertomail/, id: 'thank-you-letter', title: 'Thank You Letter to Mail When the Job Is Complete', group: 'letters', kind: 'letter', audience: 'customers', stage: 'paid' },
  { match: /Realtors and Homes for Sales__HomeforSale_Letter/, id: 'home-for-sale-letter', title: 'Home for Sale Letter (to the homeowner)', group: 'letters', kind: 'letter', audience: 'homes for sale' },
  { match: /Letters__Mail-out Letter__ChurchLetter/, id: 'church-letter', title: 'Church Letter', group: 'letters', kind: 'letter', audience: 'churches' },
  { match: /Letters__Mail-out Letter__CommercialLetter/, id: 'commercial-letter', title: 'Commercial Letter', group: 'letters', kind: 'letter', audience: 'commercial' },
  { match: /Letters__Mail-out Letter__ApartmentLetter/, id: 'apartment-letter', title: 'Apartment Letter', group: 'letters', kind: 'letter', audience: 'apartments' },
  { match: /Landlord Letter__LandlordLetter/, id: 'landlord-letter', title: 'Landlord Letter', group: 'letters', kind: 'letter', audience: 'landlords' },
  { match: /Property Management Companies__PropertyManagementLetter/, id: 'property-management-letter', title: 'Property Management Introduction Letter', group: 'letters', kind: 'letter', audience: 'property managers' },
  // Emails
  { match: /NewLeadConfirmationEmail-210303-141440/, id: 'email-new-lead-confirmation', title: 'New Lead Confirmation Email (appointment details)', group: 'emails', kind: 'email', audience: 'customers', stage: 'lead' },
  { match: /NewCustomerWelcomeEmailSendAfterSigning/, id: 'email-new-customer-welcome', title: 'New Customer Welcome Email (after signing)', group: 'emails', kind: 'email', audience: 'customers', stage: 'sold' },
  { match: /ScheduledNotificationEmailSendWhenInstallScheduled/, id: 'email-scheduled-notification', title: 'Scheduled Notification Email', group: 'emails', kind: 'email', audience: 'customers', stage: 'scheduled' },
  { match: /InstallCompleteAwaitingFinalPayment/, id: 'email-install-complete', title: 'Install Complete Email (awaiting final payment)', group: 'emails', kind: 'email', audience: 'customers', stage: 'complete' },
  { match: /JobCompleteEmailSendWhenPaidinFull/, id: 'email-job-complete', title: 'Job Complete Email (paid in full)', group: 'emails', kind: 'email', audience: 'customers', stage: 'paid' },
  { match: /30DaysAfterJobPaidinFullReferralEmail/, id: 'email-referral-30', title: '30 Days After Paid in Full: Referral Email', group: 'emails', kind: 'email', audience: 'customers', stage: 'paid' },
  { match: /60DaysAfterJobPaidinFullReferralEmail/, id: 'email-referral-60', title: '60 Days After Paid in Full: Referral Email', group: 'emails', kind: 'email', audience: 'customers', stage: 'paid' },
  { match: /90DaysAfterJobPaidinFullReferralEmail/, id: 'email-referral-90', title: '90 Days After Paid in Full: Referral Email', group: 'emails', kind: 'email', audience: 'customers', stage: 'paid' },
  { match: /GettingReviewsTemplates_3EmailsTexts/, id: 'getting-reviews', title: 'Getting Reviews: 2 Emails + 2 Texts', group: 'emails', kind: 'email', audience: 'customers', stage: 'paid' },
  { match: /MissedSaleEmail1/, id: 'email-missed-sale-1', title: 'Missed Sale Email 1', group: 'emails', kind: 'email', audience: 'lost leads' },
  { match: /MissedSaleEmail2/, id: 'email-missed-sale-2', title: 'Missed Sale Email 2', group: 'emails', kind: 'email', audience: 'lost leads' },
  { match: /MissedSaleEmail3/, id: 'email-missed-sale-3', title: 'Missed Sale Email 3', group: 'emails', kind: 'email', audience: 'lost leads' },
  { match: /MissedSaleEmail4/, id: 'email-missed-sale-4', title: 'Missed Sale Email 4', group: 'emails', kind: 'email', audience: 'lost leads' },
  { match: /Insurance Agent__InsuranceAgentColdEmailIntro_FollowUp/, id: 'email-insurance-agent-cold', title: 'Insurance Agent Cold Email: Introduction + Follow-Up', group: 'emails', kind: 'email', audience: 'insurance agents' },
  { match: /Insurance Agent__InsuranceAgentReferralEmailsorLetter14/, id: 'email-insurance-agent-1-4', title: "Insurance Agent Emails 1–4 (after signing a customer)", group: 'emails', kind: 'email', audience: 'insurance agents', stage: 'sold' },
  { match: /Realtors and Homes for Sales__EmailtoRealtorForListingInHail_WindArea/, id: 'email-realtor-listing', title: 'Email to Realtor for a Listing in a Hail/Wind Area', group: 'emails', kind: 'email', audience: 'realtors' },
  { match: /Emails__ChurchEmail2/, id: 'email-church', title: 'Church Email', group: 'emails', kind: 'email', audience: 'churches' },
  { match: /Emails__CommercialEmail2/, id: 'email-commercial', title: 'Commercial Email', group: 'emails', kind: 'email', audience: 'commercial' },
  { match: /Emails__ApartmentEmail1/, id: 'email-apartment-1', title: 'Commercial, Apartment and Church Email #1 (first touch)', group: 'emails', kind: 'email', audience: 'apartments' },
  { match: /Emails__ApartmentEmail2/, id: 'email-apartment-2', title: 'Apartment Email #2', group: 'emails', kind: 'email', audience: 'apartments' },
  { match: /Landlord Letter__LandlordEmail/, id: 'email-landlord', title: 'Landlord Email', group: 'emails', kind: 'email', audience: 'landlords' },
  { match: /Property Management Companies__PropertyManagementEmail/, id: 'email-property-management', title: 'Property Management Email', group: 'emails', kind: 'email', audience: 'property managers' },
  // Productivity & goals
  { match: /IncomeGoalPlan-210303-141612\.txt$/, id: 'income-goal-plan', title: 'Income Goal and Strategy Plan', group: 'productivity', kind: 'guide' },
  { match: /TheDailySales_Points_Game-210303-141612 \(2\)\.txt$/, id: 'daily-points-game', title: 'The Daily Sales Points Game', group: 'productivity', kind: 'guide' },
  { match: /TimeManagementforMaximumSales/, id: 'time-management', title: 'Time Management for Maximum Sales (the clock exercise)', group: 'productivity', kind: 'guide' },
  { match: /WeeklySalesProgressTracker-BRN/, id: 'weekly-progress-tracker', title: 'Weekly Sales Progress Tracker', group: 'productivity', kind: 'reference' },
  { match: /DailyScheduleSheet1.*\.pdf\.txt$/, id: 'daily-schedule-sheet', title: 'Daily Schedule and Activity Tracker', group: 'productivity', kind: 'reference' },
];

const BOILERPLATE = [
  /copyright\s+20\d\d\s*-\s*the roof strategist/i, /roofstrategist\.com/i, /it is your responsibility/i, /by using this material you agree/i,
  /original purchaser/i, /plagiarization/i, /respect\s+the law/i, /intellectual property belongs/i, /questions\? email/i, /terms and conditions/i,
  /\[LockDown LIVE\]/, /^HAND SIGN IN BLUE INK$/i, /^\[HAND SIGN IN BLUE INK\]$/i, /^\[SCRIPT ON PAGE 2\]$/i, /^\[MORE ON PAGE 2\]$/i, /^GO TO NEXT PAGE$/i,
  /^\s*\d+\s*$/, // bare page numbers from pdftotext
  /^DISCLAIMER$/i, /state laws that are applicable/i, /seek legal advice/i, /not (a )?(legal|law) (advice|firm)/i, /no (warranty|guarantee) of (results|any kind)/i,
  /results (may|will) vary/i, /for (educational|informational) purposes only/i, /^(the )?roof strategist/i,
];

function clean(raw: string): string {
  let t = raw.replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[ \t]+$/gm, '');
  // pdftotext -layout pads with runs of spaces; collapse them but keep indents meaningful enough to read.
  t = t.split('\n').map((l) => l.replace(/ {3,}/g, '  ').trimEnd()).filter((l) => !BOILERPLATE.some((re) => re.test(l.trim()))).join('\n');
  t = t.replace(/\t•\t/g, '• ').replace(/^\s*[❏]\s*/gm, '☐ ').replace(/\n{3,}/g, '\n\n').trim();
  // James's personal copies become the template.
  t = t.replace(/james@bestroofingnow\.com/gi, '[REP EMAIL]').replace(/C[-:]\s*704-831-1525/g, 'C: [REP CELL]').replace(/\bJames Turner\b/g, '[REP NAME]');
  t = t.replace(/Best Roofing Now,? LLC/g, 'Best Roofing Now LLC');
  return t;
}

function placeholdersIn(t: string): string[] {
  return Array.from(new Set(Array.from(t.matchAll(/\[([^\]\n]{1,80})\]/g)).map((m) => m[1].trim())));
}

function videosIn(t: string): string[] {
  return Array.from(new Set(Array.from(t.matchAll(/https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/\S+/g)).map((m) => m[0])));
}

function summaryOf(t: string, title: string): string {
  const lines = t.split('\n').map((l) => l.trim()).filter((l) => l && !/^https?:/.test(l) && l.toLowerCase() !== title.toLowerCase());
  const body = lines.filter((l) => !/^(subject|use|reference|watch|note)\b/i.test(l)).slice(0, 3).join(' ');
  return body.replace(/\s+/g, ' ').slice(0, 180);
}

const dir = process.argv[2];
if (!dir) { console.error('usage: build-playbook <corpus-dir>'); process.exit(1); }
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt'));
const seen = new Map<string, string>();
const docs: any[] = [];
for (const entry of CATALOG) {
  const file = files.find((f) => entry.match.test(f));
  if (!file) { console.warn(`missing: ${entry.id} (${entry.match})`); continue; }
  const raw = fs.readFileSync(path.join(dir, file), 'utf8');
  const hash = crypto.createHash('md5').update(raw).digest('hex');
  if (seen.has(hash)) { console.warn(`duplicate content: ${entry.id} == ${seen.get(hash)}`); continue; }
  seen.set(hash, entry.id);
  const body = clean(raw);
  docs.push({
    id: entry.id, title: entry.title, group: entry.group, kind: entry.kind,
    audience: entry.audience ?? null, stage: entry.stage ?? null, tags: entry.tags ?? [],
    summary: summaryOf(body, entry.title), body, placeholders: placeholdersIn(body), videos: videosIn(body), source: file.replace(/\.txt$/, ''),
  });
}
const out = { builtAt: new Date().toISOString(), count: docs.length, docs };
fs.mkdirSync('shared/playbook', { recursive: true });
fs.writeFileSync('shared/playbook/library.json', JSON.stringify(out, null, 1));
console.log(`wrote shared/playbook/library.json: ${docs.length} documents, ${Math.round(JSON.stringify(out).length / 1024)} KB`);
