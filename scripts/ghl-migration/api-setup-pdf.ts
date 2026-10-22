/**
 * The integration setup checklist, as a PDF on James's Desktop.
 *
 *   npx tsx scripts/ghl-migration/api-setup-pdf.ts [outputPath]
 *
 * Built from the code: every `process.env.*` the server and client actually
 * read, grouped by the service it belongs to. Nothing here is aspirational —
 * if a key is listed, something in the app is looking for it.
 */
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildPdf, type PdfLine } from '../../server/lib/pdf/simple-pdf';

const H = (text: string): PdfLine => ({ kind: 'heading', text });
const S = (text: string): PdfLine => ({ kind: 'subheading', text });
const T = (text: string): PdfLine => ({ kind: 'text', text });
const R = (label: string, value: string, bold = false): PdfLine => ({ kind: 'row', label, value, bold });
const rule = (): PdfLine => ({ kind: 'rule' });
const gap = (size = 8): PdfLine => ({ kind: 'space', size });

const lines: PdfLine[] = [
  T('Every API key the app looks for, grouped by service, with what each one turns on.'),
  T('Built from the code on 19 September 2026 - 156 environment variables read across the server and client. This lists the ones that matter.'),
  gap(),
  S('FIRST: find out what is already set'),
  T('I cannot read your Vercel settings. But the app can tell you itself - sign in as an admin and open:'),
  T('    https://app.bestroofingnow.com/api/health/integrations'),
  T('It reports every connected service, which are answering and which are not, with each check time-boxed so one slow provider cannot hang it. Anything listed as "down" or "not-configured" below is what needs a key.'),
  gap(), rule(),

  H('1. DO NOW - the phone switch'),
  T('These are the only ones blocking the move off GoHighLevel.'),
  gap(),
  S('Twilio (twilio.com console, Account Info on the home page)'),
  R('TWILIO_ACCOUNT_SID', 'starts with AC'),
  R('TWILIO_AUTH_TOKEN', 'hidden until you click reveal'),
  R('TWILIO_PHONE_NUMBER', 'the default number to send from'),
  R('TWILIO_A2P_READY', 'set to true once carriers approve you'),
  T('Without the first two, nothing phone-related works in V2. A2P approval takes 1-3 weeks, so start it before anything else.'),
  gap(),
  S('Close the open webhooks (confirmed open right now)'),
  R('GHL_WEBHOOK_SECRET', 'any long random string'),
  R('JOBTREAD_WEBHOOK_SECRET', 'a different long random string'),
  R('WEBHOOKS_REQUIRE_SECRET', 'true - but LAST, see below'),
  T('Order matters. Set the two secrets, then add a custom header named x-webhook-secret with the matching value in the GoHighLevel and JobTread webhook settings, and only then set WEBHOOKS_REQUIRE_SECRET. Doing the flag first drops real incoming leads.'),
  T('Today both endpoints accept anyone who knows the URL. I verified that against the live site.'),
  gap(), rule(),

  H('2. CHECK - these should already be set'),
  T('The app is working, so most of these are in Vercel. Worth confirming rather than assuming, because a few fail silently.'),
  gap(),
  S('Core - the app does not run without these'),
  R('DATABASE_URL', 'Supabase connection string'),
  R('SESSION_SECRET', 'signs the login cookie'),
  R('APP_BASE_URL', 'https://app.bestroofingnow.com'),
  R('GOOGLE_CLIENT_ID / _SECRET', 'Google sign-in'),
  R('CRON_SECRET', 'guards the eight scheduled jobs'),
  gap(),
  S('Google Workspace - calendars, Gmail scanning, sending as a mailbox'),
  R('GOOGLE_SA_KEY', 'service account JSON'),
  R('GOOGLE_SA_EMAIL', 'the delegated account'),
  T('Without these the availability board loses its Google side, Inbox Leads stops scanning, and letters cannot send from a real mailbox.'),
  gap(),
  S('Maps - the canvass map and property lookups'),
  R('VITE_GOOGLE_MAPS_API_KEY', 'the browser map'),
  R('GOOGLE_MAPS_API_KEY', 'server-side geocoding'),
  gap(),
  S('AI - reports, the Ops Brain, the advisors'),
  R('ANTHROPIC_API_KEY', 'the brain and the advisors'),
  R('ANTHROPIC_MODEL_BRAIN', 'confirm this is set'),
  R('GROQ_API_KEY', 'report vision and narrative'),
  T('ANTHROPIC_MODEL_BRAIN is worth checking specifically. The fallback model id was wrong until today, so if neither it nor ANTHROPIC_MODEL is set, the Ops Brain has been failing silently on a model that does not exist.'),
  gap(),
  S('The systems you already run on'),
  R('GHL_PIT_TOKEN + GHL_LOCATION_ID', 'GoHighLevel'),
  R('JOBTREAD_API_KEY / _TOKEN / _COMPANY_ID', 'JobTread'),
  gap(), rule(),

  H('3. OPTIONAL - only if you want the feature'),
  T('Each of these turns on one thing. Leave them unset and that screen says it is not connected instead of breaking.'),
  gap(),
  R('QuickBooks', 'CLIENT_ID, CLIENT_SECRET, REALM_ID, REDIRECT_URI, ENVIRONMENT'),
  T('    Turns on: profit and loss, balance sheet, vendors, expenses.'),
  gap(),
  R('Plaid', 'PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENVIRONMENT'),
  T('    Turns on: bank account feeds on the finance screens.'),
  gap(),
  R('Everee', 'EVEREE_API_KEY, EVEREE_ENVIRONMENT'),
  T('    Turns on: payroll runs and pay statements.'),
  gap(),
  R('CompanyCam', 'COMPANYCAM_API_TOKEN'),
  T('    Turns on: pulling job photos from CompanyCam into reports.'),
  gap(),
  R('Tracerfy', 'TRACERFY_API_KEY, TRACERFY_BASE_URL'),
  T('    Turns on: owner names, phones and emails on the canvass map. Costs real credits per lookup - about 10 per property, up to $50 for an area pull.'),
  gap(),
  R('RoofLink', 'ROOFLINK_API_KEY'),
  T('    Turns on: the hourly sync from the old CRM.'),
  gap(),
  R('Vapi', 'VAPI_API_KEY, VAPI_PHONE_NUMBER_ID, VAPI_ASSISTANT_ID, VAPI_SECRET'),
  T('    Turns on: the existing voice AI integration. Worth keeping until the Twilio one is proven.'),
  gap(),
  R('Vision fallbacks', 'FAL_AI_API_KEY, OPENROUTER_API_KEY'),
  T('    Turns on: backup providers for roof photo analysis if Groq is down.'),
  gap(),
  R('Enrichment', 'HUNTER_IO_API_KEY, BRIGHTDATA_API_KEY'),
  T('    Turns on: contact enrichment. Probably leave off.'),
  gap(), rule(),

  H('4. DO NOT SET - nothing would happen'),
  S('Cloudflare R2, and the roof colour renders behind it'),
  R('R2_REPORTS_* (five keys)', 'do not set'),
  R('GEMINI_API_KEY / ENABLE_ROOF_RENDERS', 'do not set'),
  T('An earlier version of this page said these keys would break report uploads because a package was missing. That was wrong, and I am correcting it: the package is beside the point, because nothing in the app calls this code at all.'),
  T('The chain is generateRoofColorRenders -> r2-storage -> the S3 client. All three of its functions have zero callers. So do putReportHtml and putReportPdf. Setting the keys changes nothing either way - no uploads happen, and none fail.'),
  gap(),
  T('What is odd is that the other half IS finished. The report templates already have a "Your Home, New Roof" chapter that renders these images, and the combined report already accepts them. The only missing piece is the line that generates them and hands them over.'),
  T('You were asked whether you wanted AI images of a customer\'s own house in different shingle colours, and said no on 19 September 2026. So this stays off and costs nothing. The code is marked in both files as deliberately unwired, so nobody connects it later thinking it was forgotten.'),
  gap(), rule(),

  H('Where to put them'),
  T('Vercel, then the best-roofing-ai project, then Settings, then Environment Variables. Set each for Production. Most take effect on the next deploy; tell me when they are in and I will confirm from the app side.'),
  gap(),
  T('Never send a key in a chat message. Put it in Vercel yourself - I can verify a connection works without ever seeing the value.'),
];

export function buildApiSetupPdf(): Buffer {
  return buildPdf('Best Roofing Now - API setup checklist', lines, 'Prepared for James Turner - 19 September 2026');
}

const out = process.argv[2] || join(homedir(), 'Desktop', 'BRN - API setup checklist.pdf');
const pdf = buildApiSetupPdf();
writeFileSync(out, pdf);
console.log(`${(pdf.length / 1024).toFixed(0)} KB -> ${out}`);
