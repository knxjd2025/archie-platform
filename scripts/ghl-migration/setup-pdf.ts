/**
 * The switch-off-GoHighLevel instructions, as a PDF on James's Desktop.
 * Uses the app's own PDF writer (pdf-parse is broken on this Node, so the
 * hand-rolled one is what everything here uses).
 *
 *   npx tsx scripts/ghl-migration/setup-pdf.ts [outputPath]
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

export const setupLines: PdfLine[] = [
  T('Moving phone, texting and the AI answering service off GoHighLevel onto our own tools.'),
  T('Prepared 19 September 2026. Do these in order - step 1 is the one that takes weeks, so start it today even if you do nothing else.'),
  gap(), rule(),

  H('Step 1 - Register for business texting (DO THIS FIRST)'),
  T('This is called A2P 10DLC. Phone carriers require every business to register before it can send texts. Approval takes one to three weeks and nothing else can be finished until it clears. It is the long pole - everything else is days, this is weeks.'),
  gap(),
  S('What to do'),
  T('1. Create a Twilio account at twilio.com. Use a company email, not a personal one.'),
  T('2. In the Twilio console go to Messaging, then Regulatory Compliance, then Brand Registration.'),
  T('3. Register the Brand. Have these details ready before you start, because the form times out.'),
  gap(),
  R('Legal business name', 'Best Roofing Now'),
  R('Address', '10130 Mallard Creek Road, Suite 300'),
  R('City, State, ZIP', 'Charlotte, NC 28262'),
  R('Website', 'https://www.bestroofingnow.com'),
  R('Contact email', 'james@bestroofingnow.com'),
  R('EIN / Tax ID', 'you will need this - Twilio verifies it'),
  gap(),
  T('4. Then register a Campaign. Pick "Customer Care" or "Mixed" as the use case. Twilio asks for two sample messages - use real ones, invented samples get rejected:'),
  T('   "Hi {name}, this is Best Roofing Now confirming your roof inspection Tuesday at 2pm. Reply STOP to opt out."'),
  T('   "Hi {name}, your inspection report is ready. Reply STOP to opt out."'),
  T('5. Every sample must carry the opt-out wording. Missing it is the most common rejection.'),
  gap(),
  R('Cost', '$4 one-time, then about $12/month'),
  R('Time', '1 to 3 weeks - start now'),
  gap(), rule(),

  H('Step 2 - Send me the Twilio keys'),
  T('Once the account exists - you do not need to wait for step 1 to be approved - the app needs two values to talk to Twilio.'),
  gap(),
  S('Where to find them'),
  T('Twilio console home page, under Account Info. Two values: Account SID (starts with AC) and Auth Token (hidden until you click to reveal).'),
  gap(),
  S('How to give them to me'),
  T('Put them in Vercel yourself rather than sending them in a message - that way they are never written down anywhere they should not be, and I never see them.'),
  T('Vercel, then the best-roofing-ai project, then Settings, then Environment Variables. Add these two, set for Production:'),
  gap(),
  R('TWILIO_ACCOUNT_SID', 'the AC... value'),
  R('TWILIO_AUTH_TOKEN', 'the auth token'),
  gap(),
  T('Then tell me they are in, and I will verify the connection without ever seeing the values.'),
  gap(), rule(),

  H('Step 3 - Approve the database change'),
  T('The app needs somewhere to keep calls and texts. Right now it has nowhere - all 6,055 conversations live inside GoHighLevel and leave with it the day you stop paying.'),
  T('I have written the change but not run it; database changes always come to you first. It adds three new tables (calls, comm_messages, phone_numbers) and does not touch or alter anything that already exists.'),
  T('The file is migrations/0029_add_calls_and_messages.sql. Say "apply 0029" and I will run it.'),
  gap(), rule(),

  H('Step 4 - Decide: port your numbers, or get new ones?'),
  T('You have four numbers in GoHighLevel today:'),
  gap(),
  R('+1 980 946 6044', 'Joven - cold caller'),
  R('+1 980 441 1330', 'Bo - customer service'),
  R('+1 704 368 3951', 'Office - main line'),
  R('+1 980 485 7732', 'Andre - claims'),
  gap(),
  S('Porting - what I would do'),
  T('Customers keep calling the same numbers. Takes about two weeks with a short cutover window. Your main line is on your trucks, your website and your yard signs, so changing it is not really free.'),
  gap(),
  S('New numbers'),
  T('Instant, and you forward the old ones across for a few months. Faster, but you run two sets of numbers for a while.'),
  gap(),
  T('Either way: do NOT release the GoHighLevel numbers until everything is proven. Porting a number away is hard to undo.'),
  gap(), rule(),

  H('Step 5 - The V1 / V2 switch (already built and live)'),
  T('There is now a switch on your My Account page that only your account can see. Nobody else can see it and nobody else can move it - the app answers "not found" to anyone else who goes looking.'),
  gap(),
  R('V1', 'GoHighLevel - how everything works today'),
  R('V2', 'our own Twilio numbers and our own call history'),
  gap(),
  T('Switching to V2 does NOT disconnect GoHighLevel. It stays connected and keeps receiving the whole time, so switching back loses nothing.'),
  T('Going back to V1 always works, whatever state V2 is in. There is no condition under which the app can refuse it - that is the whole point of the switch.'),
  T('It will also not let you turn V2 on until V2 can actually work. It lists what is still missing and what to do about each item, so it can never leave your reps sending texts that silently go nowhere.'),
  gap(), rule(),

  H('Two things to fix in GoHighLevel while you are in there'),
  S('1. Two AI agents have the wrong timezone'),
  T('You have nine voice agents configured; only Dakota is real. One of the others is set to Africa/Lagos and another to Europe/Budapest. If either ever picks up a call and books an appointment, it books at the wrong time. Delete the ones you do not use.'),
  gap(),
  S('2. fred@bestroofingnow.com is still an active GoHighLevel user'),
  T('He has a phone number on the account (+1 334 546 8069), even though he is hard-blocked from ever signing into the app. Whatever that decision was about, it was never applied in GoHighLevel.'),
  gap(), rule(),

  H('What it costs after the switch'),
  T('Based on your real volume: 50 dials a day, 10 answering, 6 minutes average.'),
  gap(),
  R('Outbound calls (about 1,520 min)', '$21'),
  R('Recording every call', '$4'),
  R('Transcribing every call', '$5'),
  R('Inbound AI answering', '$24'),
  R('Texts (about 2,000)', '$26'),
  R('Four phone numbers', '$5'),
  R('Business texting registration', '$12'),
  R('TOTAL', 'about $97 per month', true),
  gap(),
  T('That includes recording AND transcribing every single call, which is not happening today at any price.'),
  gap(), rule(),

  H('The order, on one line each'),
  T('1. Start the A2P registration - today, it takes weeks'),
  T('2. Create the Twilio account, put the two keys in Vercel'),
  T('3. Say "apply 0029" so the app has somewhere to put calls'),
  T('4. I backfill the history, and you get real numbers on your caller for the first time'),
  T('5. I wire up texting and calling; you try it with the V2 switch'),
  T('6. I rebuild the Dakota AI answering service on the new stack'),
  T('7. Port the numbers - last, once everything else is proven'),
  gap(),
  T('Nothing breaks along the way. GoHighLevel keeps running until the very last step, and the V2 switch flips back at any point.'),
];

export function buildSetupPdf(): Buffer {
  return buildPdf(
    'Best Roofing Now - Switching off GoHighLevel',
    setupLines,
    'Prepared for James Turner - 19 September 2026',
  );
}

const out = process.argv[2] || join(homedir(), 'Desktop', 'BRN - Switching off GoHighLevel.pdf');
const pdf = buildSetupPdf();
writeFileSync(out, pdf);
console.log(`${(pdf.length / 1024).toFixed(0)} KB -> ${out}`);
