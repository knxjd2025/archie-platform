import { describe, it, expect } from 'vitest';
import {
  jobPageView, isArchieJob, leadFormView, photoConsentSaved,
  PHOTO_CONSENT_HELP, PHOTO_CONSENT_LABEL, START_PRODUCTION_CONFIRM, PRODUCTION_STARTED,
  NOT_IN_PRODUCTION, MOVES_ON_BOARD, LEAD_SAVED_IN_ARCHIE,
  kynexProBannerShows, KYNEXPRO_HELD_BY_ROOF_LEE,
  accountEditorWords, isArchieJobKey, contactRouteKey, availabilityBoardView, BOOKING_NOT_YET,
  roofReportsView, commissionView, companyWords, boardCardWords, jobRepsNote,
} from '../own-jobs';

const KEY = `archie-${'a'.repeat(32)}`;
const archieJob = (over: Record<string, unknown> = {}) => ({ externalId: KEY, source: 'archie', backend: 'archie', boardStage: null, ...over });
const jobTreadJob = (over: Record<string, unknown> = {}) => ({ externalId: 'jt-123', source: 'jobtread', backend: 'jobtread', ...over });

describe('the client page for a job Archie keeps', () => {
  it('never points at JobTread or KynexPro', () => {
    const v = jobPageView(archieJob());
    expect(isArchieJob(archieJob())).toBe(true);
    expect(v.openInJobTread).toBe(false);
    expect(v.documentsOpenJobTread).toBe(false);
    expect(v.contactThroughKynexPro).toBe(false);
    expect(v.kynexProTags).toBe(false);
    expect(v.booking).toBe(false);
  });

  it('shows the board stage read only, and "Start production" only while the job is not on the board', () => {
    expect(jobPageView(archieJob())).toMatchObject({ stageControl: 'board', startProduction: true });
    expect(jobPageView(archieJob({ boardStage: { key: 'schedule', label: 'Schedule Job' } }))).toMatchObject({ stageControl: 'board', startProduction: false });
  });

  it('lets an admin correct the account, and offers the photo switch', () => {
    expect(jobPageView(archieJob())).toMatchObject({ accountEditor: true, photoConsent: true });
  });

  it('says the note is saved, with no mention of a CRM', () => {
    const v = jobPageView(archieJob());
    expect(v.noteSaved).toBe('Note saved');
    expect(v.noteHeading).toBe('Add a note');
    expect(`${v.noteSaved} ${v.noteHeading}`).not.toMatch(/CRM|JobTread|KynexPro/);
  });

  it('explains the photo switch in one plain sentence: website and social posts, the town only, never the address', () => {
    expect(PHOTO_CONSENT_HELP).toMatch(/website/);
    expect(PHOTO_CONSENT_HELP).toMatch(/social posts/);
    expect(PHOTO_CONSENT_HELP).toMatch(/town/);
    expect(PHOTO_CONSENT_HELP).toMatch(/never the address/);
    expect(PHOTO_CONSENT_HELP.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length).toBe(1);
    expect(photoConsentSaved(true)).toMatch(/agreed/);
    expect(photoConsentSaved(false)).toMatch(/not be used/);
  });

  it('uses plain words with no codes, internal names or long dashes', () => {
    for (const s of [
      PHOTO_CONSENT_LABEL, PHOTO_CONSENT_HELP, START_PRODUCTION_CONFIRM, PRODUCTION_STARTED,
      NOT_IN_PRODUCTION, MOVES_ON_BOARD, LEAD_SAVED_IN_ARCHIE, photoConsentSaved(true), photoConsentSaved(false),
    ]) {
      expect(s).not.toMatch(/[—–]|CRM|JobTread|KynexPro|archie-|backend|_/);
    }
  });
});

describe('the client page for every other job', () => {
  it('is exactly as before: JobTread link, JobTread stage picker, KynexPro buttons, booking, no photo switch', () => {
    const v = jobPageView(jobTreadJob());
    expect(isArchieJob(jobTreadJob())).toBe(false);
    expect(v).toEqual({
      openInJobTread: true,
      stageControl: 'jobtread',
      startProduction: false,
      accountEditor: true,
      contactThroughKynexPro: true,
      kynexProTags: true,
      booking: true,
      photoConsent: false,
      documentsOpenJobTread: true,
      noteHeading: 'Add a note to Current CRM',
      noteSaved: 'Note added to your CRM',
    });
  });

  it('keeps the account editor to JobTread jobs, as before', () => {
    expect(jobPageView(jobTreadJob({ source: 'ghl' })).accountEditor).toBe(false);
    expect(jobPageView({ externalId: null, source: 'manual', backend: 'jobtread' })).toMatchObject({ accountEditor: false, openInJobTread: false });
  });

  it('treats a page from before the server said which system keeps the job as a JobTread job', () => {
    expect(jobPageView({ externalId: 'jt-9', source: 'jobtread' })).toMatchObject({ stageControl: 'jobtread', openInJobTread: true, photoConsent: false });
  });
});

describe('the lead form', () => {
  it('is unchanged for a company Roof Lee did not make', () => {
    for (const role of ['admin', 'manager', 'sales', 'customer_service'] as const) {
      const v = leadFormView(false, role);
      expect(v.booking).toBe(true);
      expect(v.repPlaceholder).toBe('Sales Rep (default: you)');
      expect(v.footer).toMatch(/^Creates a job in your CRM/);
    }
  });

  it('leaves booking out for a company Roof Lee made, and says plainly where the lead goes', () => {
    for (const role of ['admin', 'sales_director', 'manager', 'customer_service', 'sales', 'production'] as const) {
      const v = leadFormView(true, role);
      expect(v.booking).toBe(false);
      expect(v.footer).toMatch(/^Saves the lead in Archie as a New Lead on the Sales board\./);
      expect(`${v.footer} ${v.repPlaceholder}`).not.toMatch(/[—–]|CRM|JobTread|KynexPro/);
    }
  });

  it('says who owns the lead the way the server decides it', () => {
    expect(leadFormView(true, 'sales').footer).toMatch(/under your name/);
    expect(leadFormView(true, 'manager')).toMatchObject({ repPlaceholder: 'Salesperson (default: you)' });
    expect(leadFormView(true, 'manager').footer).toMatch(/yours unless you pick a salesperson/);
    expect(leadFormView(true, 'admin')).toMatchObject({ repPlaceholder: 'Salesperson (optional)' });
    expect(leadFormView(true, 'admin').footer).toMatch(/a manager gives it to one on the Assignments page/);
    expect(leadFormView(true, 'customer_service').footer).toMatch(/A manager gives it to a salesperson/);
    // A crew member never owns a job: their lead waits for a manager too.
    expect(leadFormView(true, 'production').footer).toMatch(/A manager gives it to a salesperson/);
  });
});

describe('the words the server uses', () => {
  it('no longer says photos are coming soon anywhere: Archie keeps them now', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(__dirname, '..', '..', '..', '..');
    for (const file of ['server/production/native-jobs.ts', 'server/photos/routes.ts', 'client/src/lib/own-jobs.ts', 'client/src/components/JobPhotos.tsx']) {
      expect(readFileSync(join(root, file), 'utf8'), file).not.toMatch(/photos to jobs is coming soon|NATIVE_PHOTOS_SOON|PHOTOS_SOON/);
    }
  });
});

describe('KynexPro for a company Roof Lee made', () => {
  it('never asks its admin to connect KynexPro, which Roof Lee looks after', () => {
    expect(kynexProBannerShows({ connected: false, heldByRoofLee: true })).toBe(false);
    expect(kynexProBannerShows({ connected: true, heldByRoofLee: true })).toBe(false);
  });

  it('still reminds every other company\'s admin until it is connected, as before', () => {
    expect(kynexProBannerShows({ connected: false, heldByRoofLee: false })).toBe(true);
    expect(kynexProBannerShows({ connected: false })).toBe(true);
    expect(kynexProBannerShows({ connected: true, heldByRoofLee: false })).toBe(false);
  });

  it('says why in the same words the server refuses with, promising nothing', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const server = readFileSync(join(__dirname, '..', '..', '..', '..', 'server', 'production', 'native-jobs.ts'), 'utf8');
    expect(server).toContain(`KYNEXPRO_IS_ROOF_LEES = '${KYNEXPRO_HELD_BY_ROOF_LEE}'`);
    expect(KYNEXPRO_HELD_BY_ROOF_LEE).not.toMatch(/soon|job software|[—–]/);
  });
});

describe('the account editor', () => {
  it('for a job Archie keeps: saves to the job, with no CRM, estimate or tasks to change things in', () => {
    const w = accountEditorWords(true);
    expect(w.save).toBe('Save');
    expect(w.saved).toBe('Account saved ✅');
    for (const s of [w.save, w.saved, w.footnote]) expect(s).not.toMatch(/CRM|JobTread|KynexPro|estimate|tasks|[—–]/);
    expect(w.footnote).toMatch(/Production board/);
  });

  it('for every other job: exactly as before', () => {
    expect(accountEditorWords(false)).toEqual({
      save: 'Save to Current CRM',
      saved: 'Account saved to your CRM ✅',
      footnote: 'Projected value and the schedule come from the estimate and tasks in your CRM, so they\'re changed there. Reps, stage, phone/email and commission each have their own edit on this page.',
    });
  });
});

describe('call, text and email', () => {
  it('knows a key Archie made, exactly as the server does', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const server = readFileSync(join(__dirname, '..', '..', '..', '..', 'server', 'production', 'native-jobs.ts'), 'utf8');
    expect(server).toContain('const NATIVE_JOB_RE = /^archie-[0-9a-f]{32}$/;');
    expect(isArchieJobKey(KEY)).toBe(true);
    for (const k of [null, undefined, '', 'jt-123', 'archie-', `archie-${'A'.repeat(32)}`, `archie-${'a'.repeat(31)}`, `x${KEY}`]) expect(isArchieJobKey(k)).toBe(false);
  });

  it('use the phone\'s own apps for a job Archie keeps (its KynexPro is Roof Lee\'s), on every screen', () => {
    expect(contactRouteKey(KEY)).toBeNull();
  });

  it('still go through KynexPro for every other job, as before', () => {
    expect(contactRouteKey('jt-123')).toBe('jt-123');
    expect(contactRouteKey(null)).toBeNull();
    expect(contactRouteKey(undefined)).toBeNull();
  });
});

describe('the Schedule\'s availability board', () => {
  it('offers no booking to a company Roof Lee made, so an open time never makes a lead it cannot book', () => {
    expect(availabilityBoardView(true)).toEqual({ booking: false, hint: BOOKING_NOT_YET });
  });

  it('still books for every other company, as before', () => {
    expect(availabilityBoardView(false)).toEqual({ booking: true, hint: 'Click an open time to book it.' });
  });

  it('says so in the same words the server refuses a booking with', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const server = readFileSync(join(__dirname, '..', '..', '..', '..', 'server', 'writes', 'routes.ts'), 'utf8');
    expect(server).toContain(`NATIVE_BOOKING_UNAVAILABLE = '${BOOKING_NOT_YET}'`);
  });
});

describe('roof reports on a job', () => {
  it('for a job Archie keeps: no button to send it to job software the company does not have, and no CRM in the words', () => {
    const v = roofReportsView(KEY);
    expect(v.sendToJobSoftware).toBe(false);
    expect(v.jobFileLabel).toBeNull();
    for (const s of [v.footnote, v.tierNote]) expect(s).not.toMatch(/CRM|JobTread|KynexPro|[—–]/);
  });

  it('for every other job: exactly as before', () => {
    expect(roofReportsView('jt-123')).toEqual({
      sendToJobSoftware: true,
      jobFileLabel: 'Use this job\'s Current CRM file',
      footnote: 'Pulls the job\u2019s photos, notes and documents from your CRM, analyses the photos for damage, and builds the report here. Takes 2\u20135 minutes \u2014 you can leave this page and come back.',
      tierNote: 'All three show on the document as a comparison; the tier you pick here is the one priced and pushed to your CRM.',
    });
  });
});

describe('a job\'s commission statement', () => {
  it('for a job Archie keeps: no "Save PDF to job" (there is nowhere to save it yet); Preview still opens it', () => {
    expect(commissionView(KEY)).toEqual({ savePdfToJob: false });
  });

  it('for every other job: as before', () => {
    expect(commissionView('jt-123')).toEqual({ savePdfToJob: true });
  });
});

describe('the words on screens a company Roof Lee made now reaches', () => {
  const NO_CRM = /CRM|JobTread|KynexPro|[—–]/;

  it('canvassing, the leads list and the Assignments page name no CRM for such a company', () => {
    const w = companyWords(true);
    for (const s of [w.canvassConvertAsk('7 Elm Ct'), w.canvassConverted, w.canvassIsLead, w.leadsEmpty, w.assignmentsHow]) expect(s).not.toMatch(NO_CRM);
    expect(w.canvassConvertAsk('7 Elm Ct')).toMatch(/7 Elm Ct/);
    expect(w.canvassConverted).toMatch(/Sales board/);
  });

  it('are exactly as before for every other company', () => {
    const w = companyWords(false);
    expect(w.canvassConvertAsk('7 Elm Ct')).toBe('Create a lead in your CRM for 7 Elm Ct?');
    expect(w.canvassConverted).toBe('Lead created in your CRM ✅');
    expect(w.canvassIsLead).toBe(' · ✅ in Current CRM');
    expect(w.leadsEmpty).toBe('📭 No leads yet. New leads from KynexPro and your CRM show up here automatically.');
    expect(w.assignmentsHow).toBe('We read who has tasks on each CRM job, who commented on it, and whose calendar the appointment landed on. A field rep on the job is the rep; if you\'re on it alone it\'s yours. Nothing is assigned until you accept it.');
  });

  it('a Production board card for a job Archie keeps shows no CRM status and no CRM in the note box', () => {
    expect(boardCardWords(KEY)).toEqual({ showOtherStatus: false, notePlaceholder: 'Add a note…' });
    expect(boardCardWords('jt-123')).toEqual({ showOtherStatus: true, notePlaceholder: 'Add a note to Current CRM…' });
  });

  it('changing reps on a job Archie keeps does not claim to update a CRM', () => {
    expect(jobRepsNote(KEY)).not.toMatch(NO_CRM);
    expect(jobRepsNote(KEY)).toMatch(/commission box/);
    expect(jobRepsNote('jt-123')).toBe('Also updates the Sales Rep in your CRM. An existing commission record keeps its reps, adjust those in the commission box below.');
  });
});
