/**
 * Every place Archie makes a JobTread or a KynexPro client, and what it does
 * for a company Roof Lee made (docs/archie/02-roof-lee-link.md, "Archie's own
 * jobs"). Such a company keeps its jobs in Archie (server/production/native-jobs.ts)
 * and its KynexPro belongs to Roof Lee, so neither system is ever reached for it.
 *
 * PERMANENT. A file that starts making one of these clients, or stops, fails
 * this test until someone decides what it does for a job Archie keeps and
 * writes it down here. Never delete or loosen this test to make a change pass.
 *
 *   native-path    has an Archie path for a job Archie keeps (it asks
 *                  isNativeJobId, jobBackendFor or keepsOwnJobs first, or reads
 *                  only leads whose source is JobTread)
 *   refused        answers a plain-English refusal for a job Archie keeps or a
 *                  company Roof Lee made, and calls nothing
 *   not-reachable  a Roof Lee company can never reach the outside system from
 *                  here; `why` says why in one line
 *
 * "No connection" below is a promise kept in three places: a Roof Lee company
 * cannot connect JobTread, CompanyCam or KynexPro (A1-m, refused in
 * server/integrations/connection-routes.ts and server/integrations/ghl/routes.ts),
 * the sister link stores a KynexPro location as an id only, and the
 * deployment's own keys belong to the original company alone
 * (ownsEnvCredentials). So a call from there stops with "not connected" before
 * anything leaves Archie. outside-systems.db.test.ts checks that promise.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

type Native = 'native-path' | 'refused' | 'not-reachable';
interface Decision { native: Native; why: string }

const NO_JOBTREAD = 'no connection: company-wide JobTread reads and writes, and a Roof Lee company can hold no JobTread connection';
const NO_KYNEXPRO = 'no connection: company-wide KynexPro use, and a Roof Lee company keeps its KynexPro location as an id only, with no credential';

/** Every file that makes a JobTreadClient. */
const JOBTREAD: Record<string, Decision> = {
  'server/access/assignment-routes.ts': { native: 'native-path', why: 'the Sales Rep field is not sent for a job Archie keeps' },
  'server/access/assignment-service.ts': { native: 'native-path', why: 'owner suggestions for a job Archie keeps use the calendar only' },
  'server/agents/archie-agent.ts': { native: 'not-reachable', why: NO_JOBTREAD },
  'server/agents/ceo-agent.ts': { native: 'not-reachable', why: NO_JOBTREAD },
  'server/agents/cfo-agent.ts': { native: 'not-reachable', why: `${NO_JOBTREAD}; payment reminders also ask maySendOwnMessage` },
  'server/agents/cmo-agent.ts': { native: 'not-reachable', why: NO_JOBTREAD },
  'server/agents/cpa-agent.ts': { native: 'not-reachable', why: NO_JOBTREAD },
  'server/agents/sales-tools.ts': { native: 'native-path', why: 'a follow-up on a job Archie keeps stays in Archie; the job summary reads stop at no connection' },
  'server/agents/team-agents.ts': { native: 'not-reachable', why: NO_JOBTREAD },
  'server/canvass/routes.ts': { native: 'native-path', why: 'a canvassed door becomes a lead Archie keeps' },
  'server/certificates/routes.ts': { native: 'native-path', why: 'a signed certificate of a job Archie keeps stays in Archie' },
  'server/claims/store.ts': { native: 'native-path', why: 'a claim move on a job Archie keeps is kept on the lead' },
  'server/client-account/routes.ts': { native: 'native-path', why: 'corrections to a job Archie keeps are made on the lead' },
  'server/companycam/routes.ts': { native: 'not-reachable', why: 'JobTread is read only once CompanyCam is connected, which a Roof Lee company cannot do' },
  'server/conversations/routes.ts': { native: 'not-reachable', why: NO_JOBTREAD },
  'server/final-walkthrough/routes.ts': { native: 'native-path', why: 'the walkthrough of a job Archie keeps is not copied to JobTread' },
  'server/followups/routes.ts': { native: 'native-path', why: 'a follow-up on a job Archie keeps stays in Archie' },
  'server/inspections/routes.ts': { native: 'native-path', why: 'the inspection form of a job Archie keeps is not copied to JobTread' },
  'server/insurance-letters/routes.ts': { native: 'native-path', why: 'claim details of a job Archie keeps come from the claim record only, and no JobTread files are fetched' },
  'server/job-commissions/routes.ts': { native: 'refused', why: 'saving the statement on a job Archie keeps is refused (nowhere to file it yet); Preview still opens it' },
  'server/jobtread-archive/runner.ts': { native: 'not-reachable', why: NO_JOBTREAD },
  'server/photos/routes.ts': { native: 'refused', why: 'adding a photo to a job Archie keeps is refused until Archie stores photos; the lists answer empty' },
  'server/preconstruction/routes.ts': { native: 'native-path', why: 'the checklist of a job Archie keeps is not copied to JobTread' },
  'server/production/pipeline.ts': { native: 'native-path', why: 'a board move on a job Archie keeps is kept on the lead' },
  'server/reports/job-context.ts': { native: 'native-path', why: 'a job Archie keeps has no JobTread files, notes or documents to gather' },
  'server/reports/routes.ts': { native: 'refused', why: 'sending a proposal to other job software is refused for a job Archie keeps; document routes take JobTread ids a Roof Lee company has none of' },
  'server/reports/to-jobtread.ts': { native: 'not-reachable', why: 'only the report push route calls it, and that route refuses a job Archie keeps' },
  'server/routes.ts': { native: 'native-path', why: 'the client page and its messages of a job Archie keeps ask no one; the integration screens stop at no connection' },
  'server/sales/store.ts': { native: 'native-path', why: 'a sales board move on a job Archie keeps is kept on the lead' },
  'server/signatures/routes.ts': { native: 'native-path', why: 'a signed document of a job Archie keeps stays in Archie' },
  'server/sync/jobtread-reps.ts': { native: 'not-reachable', why: NO_JOBTREAD },
  'server/sync/jobtread-roles.ts': { native: 'not-reachable', why: 'a role is pushed only for someone linked to a JobTread membership, which only the pull (no connection) sets' },
  'server/writes/routes.ts': { native: 'native-path', why: 'lead, note, contact and stage writes for a job Archie keeps stay in Archie' },
};

/** Every file that makes a GoHighLevelClient (KynexPro). */
const KYNEXPRO: Record<string, Decision> = {
  'server/agents/ceo-agent.ts': { native: 'not-reachable', why: NO_KYNEXPRO },
  'server/agents/cfo-agent.ts': { native: 'not-reachable', why: `${NO_KYNEXPRO}; payment reminders also ask maySendOwnMessage` },
  'server/agents/cmo-agent.ts': { native: 'not-reachable', why: `${NO_KYNEXPRO}; its texts also ask maySendOwnMessage` },
  'server/ai/routes.ts': { native: 'not-reachable', why: NO_KYNEXPRO },
  'server/calendar/board.ts': { native: 'not-reachable', why: NO_KYNEXPRO },
  'server/contact-actions/routes.ts': { native: 'not-reachable', why: NO_KYNEXPRO },
  'server/conversations/routes.ts': { native: 'not-reachable', why: NO_KYNEXPRO },
  'server/dashboard/routes.ts': { native: 'not-reachable', why: NO_KYNEXPRO },
  'server/integrations/ghl/new-contact.ts': { native: 'refused', why: 'a new KynexPro contact is not taken in at all for a company Roof Lee made' },
  'server/routes.ts': { native: 'native-path', why: 'messages of a job Archie keeps ask no one; the webhook hands contacts to new-contact; the rest stops at no connection' },
  'server/signatures/routes.ts': { native: 'not-reachable', why: NO_KYNEXPRO },
  'server/writes/routes.ts': { native: 'native-path', why: 'a new lead and a contact correction of a job Archie keeps make no KynexPro contact; replies and tags stop at no connection' },
};

/** What a native-path file must ask before it would reach the outside system. */
const ASKS_NATIVE = /\b(isNativeJobId|jobBackendFor|keepsOwnJobs|backendOf)\s*\(|source\s*!==\s*'jobtread'/;
/** The refusals: plain words a person reads (server/production/native-jobs.ts), or new-contact's own outcome. */
const REFUSES = /\b(OTHER_JOB_SOFTWARE_SOON|NATIVE_PHOTOS_SOON|NATIVE_SEND_ELSEWHERE_SOON|NATIVE_STATEMENT_NOT_FILED|KYNEXPRO_IS_ROOF_LEES|COMPANYCAM_NOT_FOR_YOU)\b|'roofli_company'/;

const root = join(__dirname, '..', '..', '..');
const sources: Array<{ file: string; text: string }> = [];
(function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') walk(full);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      sources.push({ file: relative(root, full).split(sep).join('/'), text: readFileSync(full, 'utf8') });
    }
  }
})(join(root, 'server'));

/** Files that make the client, on a line that is not a comment. */
function makers(client: string): string[] {
  const makes = new RegExp(`\\bnew\\s+${client}\\s*\\(`);
  return sources
    .filter(({ text }) => text.split('\n').some((line) => makes.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)))
    .map(({ file }) => file)
    .sort();
}

describe.each([
  ['JobTreadClient', JOBTREAD],
  ['GoHighLevelClient', KYNEXPRO],
] as const)('every file that makes a %s', (client, listed) => {
  it('is listed with what it does for a job Archie keeps', () => {
    expect(makers(client)).toEqual(Object.keys(listed).sort());
  });

  it('gives a reason for each decision', () => {
    for (const [file, d] of Object.entries(listed)) {
      expect(['native-path', 'refused', 'not-reachable'], file).toContain(d.native);
      expect(d.why.trim().length, file).toBeGreaterThan(10);
    }
  });

  it('asks first where it says it has an Archie path', () => {
    for (const [file, d] of Object.entries(listed)) {
      if (d.native !== 'native-path') continue;
      expect(readFileSync(join(root, file), 'utf8'), file).toMatch(ASKS_NATIVE);
    }
  });

  it('says no in plain words where it says it refuses', () => {
    for (const [file, d] of Object.entries(listed)) {
      if (d.native !== 'refused') continue;
      expect(readFileSync(join(root, file), 'utf8'), file).toMatch(REFUSES);
    }
  });
});
