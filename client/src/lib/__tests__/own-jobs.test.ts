import { describe, it, expect } from 'vitest';
import {
  jobPageView, isArchieJob, leadFormView, photoConsentSaved,
  PHOTO_CONSENT_HELP, PHOTO_CONSENT_LABEL, PHOTOS_SOON, START_PRODUCTION_CONFIRM, PRODUCTION_STARTED,
  NOT_IN_PRODUCTION, MOVES_ON_BOARD, LEAD_SAVED_IN_ARCHIE,
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
      PHOTO_CONSENT_LABEL, PHOTO_CONSENT_HELP, PHOTOS_SOON, START_PRODUCTION_CONFIRM, PRODUCTION_STARTED,
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
  it('says photos are coming soon in the same words the server refuses with', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const server = readFileSync(join(__dirname, '..', '..', '..', '..', 'server', 'production', 'native-jobs.ts'), 'utf8');
    expect(server).toContain(`NATIVE_PHOTOS_SOON = '${PHOTOS_SOON}'`);
  });
});
