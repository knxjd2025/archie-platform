import { describe, it, expect } from 'vitest';
import { PLAYBOOK, PLAYBOOK_GROUPS, companyFillFrom, fillTemplate, subjectOf, incomePlan, pointsFor, stageForColumn, STAGE_CHECKLISTS, playbookDoc } from '../playbook';
import { resolveCompanyProfile } from '../company';

const ACME = resolveCompanyProfile({
  id: '0e5f1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Acme Test Roofing',
  branding: { shortName: 'Acme Roofing', phone: '(555) 010-2030', website: 'https://acme.test' },
  settings: { credentials: ['Fully insured'], workmanshipYears: 10 },
});
/** The company this library was first written for: none of it may reach a template. */
const FORMER_COMPANY = /Best Roofing|bestroof|\bBRN\b|Charlotte|North Carolina|704-|843-271|336-583|Cochran|Bragg|Anthony Smith/;

describe('playbook library', () => {
  it('has every group populated and unique ids', () => {
    const ids = new Set(PLAYBOOK.map((d) => d.id));
    expect(ids.size).toBe(PLAYBOOK.length);
    for (const g of PLAYBOOK_GROUPS) expect(PLAYBOOK.some((d) => d.group === g.key)).toBe(true);
    expect(PLAYBOOK.length).toBeGreaterThan(70);
  });
  it('carries no vendor boilerplate or stray placeholders', () => {
    for (const d of PLAYBOOK) {
      expect(d.body).not.toMatch(/roofstrategist/i);
      expect(d.body).not.toMatch(/LockDown LIVE/);
      for (const text of [d.body, d.summary, d.title, d.source]) expect(text, d.id).not.toMatch(FORMER_COMPANY);
    }
  });
  it('every checklist step points at a real document', () => {
    for (const s of STAGE_CHECKLISTS) for (const i of s.items) if (i.doc) expect(playbookDoc(i.doc), `${s.key}/${i.key} → ${i.doc}`).toBeDefined();
  });
});

describe('fillTemplate', () => {
  const ctx = { ...companyFillFrom(ACME), repName: 'Casey Rep', repCell: '(555) 010-0100', repEmail: 'casey@acme.test', customerName: 'Pat Homeowner', customerAddress: '12 Oak St, Springfield, IL 62705', street: 'Oak St', cityState: 'Springfield, IL', date: 'September 16, 2026' };
  it('fills rep, customer, company and date placeholders and lists what is left', () => {
    const r = fillTemplate('Dear [HOMEOWNER NAME],\nWe are on [STREET NAME]. Call [YOUR NAME] at [YOUR CELL #] or [EMAIL]. [COMPANY NAME] [COMPANY WEBSITE] [DATE]. Storm on [STORM DATE].', ctx);
    expect(r.text).toBe('Dear Pat Homeowner,\nWe are on Oak St. Call Casey Rep at (555) 010-0100 or casey@acme.test. Acme Roofing acme.test September 16, 2026. Storm on [STORM DATE].');
    expect(r.remaining).toEqual(['STORM DATE']);
    expect(r.filled.map((f) => f.placeholder)).toContain('YOUR CELL #');
  });
  it('uses the first name for first-name placeholders and the office phone when the rep has no cell', () => {
    const r = fillTemplate('Hi [CUSTOMER FIRST NAME], call [PHONE]', { ...ctx, repCell: null });
    expect(r.text).toBe('Hi Pat, call (555) 010-2030');
  });
  it('leaves unknown placeholders intact rather than blanking them', () => {
    const r = fillTemplate('[HAIL/WIND/HURRICANE/STORM] hit [NEIGHBORHOOD]', { ...ctx, street: null });
    expect(r.text).toBe('[HAIL/WIND/HURRICANE/STORM] hit [NEIGHBORHOOD]');
    expect(r.remaining).toEqual(['HAIL/WIND/HURRICANE/STORM', 'NEIGHBORHOOD']);
  });
  it('builds a signature block', () => {
    const r = fillTemplate('Thanks,\n[EMAIL SIGNATURE]', ctx);
    expect(r.text).toContain('Casey Rep\nAcme Roofing\nCell: (555) 010-0100\nOffice: (555) 010-2030\ncasey@acme.test\nacme.test');
  });
  it("fills company placeholders from the company's own profile, and leaves the rest for the rep", () => {
    expect(companyFillFrom(ACME)).toMatchObject({ companyName: 'Acme Roofing', officePhone: '(555) 010-2030', companyWebsite: 'acme.test', credentials: 'Fully insured', warrantyLength: '10-year workmanship' });
    const r = fillTemplate('[COMPANY NAME] · [OFFICE PHONE] · [INSERT CREDENTIALS] · [INSERT WARRANTY LENGTH]', { repName: 'Casey' });
    expect(r.text).toBe('[COMPANY NAME] · [OFFICE PHONE] · [INSERT CREDENTIALS] · [INSERT WARRANTY LENGTH]');
    expect(r.remaining).toEqual(['COMPANY NAME', 'OFFICE PHONE', 'INSERT CREDENTIALS', 'INSERT WARRANTY LENGTH']);
  });
});

describe('subjectOf', () => {
  it('pulls the subject line out of an email template', () => {
    const r = subjectOf({ title: 'T', body: 'Subject: “Your roof is scheduled”\n\nHi there' });
    expect(r.subject).toBe('Your roof is scheduled');
    expect(r.body).toBe('Hi there');
  });
  it('falls back to the title', () => {
    expect(subjectOf({ title: 'Welcome', body: 'Hi' }).subject).toBe('Welcome');
  });
});

describe('goals', () => {
  it('runs the income plan math from the worksheet', () => {
    const p = incomePlan({ incomeGoal: 100000, avgCommission: 1500, closeRate: 40, sellingMonths: 9 });
    expect(p.salesPerYear).toBe(66.7);
    expect(p.salesPerMonth).toBe(7.5);
    expect(p.salesPerWeek).toBe(1.9);
    expect(p.apptsPerWeek).toBe(4.7);
    expect(p.doorsPerWeek).toBe(47);
    expect(p.doorsPerDay).toBe(10);
    expect(p.touchesPerWeek).toBeGreaterThan(p.doorsPerWeek);
  });
  it('scores the points game', () => {
    expect(pointsFor({ doors: 10, contacted: 1, presented: 1, closed: 1 })).toBe(30);
  });
  it('maps production columns to stage checklists', () => {
    expect(stageForColumn('Roof Construction')?.key).toBe('day_of_install');
    expect(stageForColumn('PIF File Warranties')?.key).toBe('paid_in_full');
    expect(stageForColumn('Lead')).toBeUndefined();
  });
});
