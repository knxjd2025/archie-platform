import { describe, it, expect } from 'vitest';
import { PLAYBOOK, PLAYBOOK_GROUPS, fillTemplate, subjectOf, incomePlan, pointsFor, stageForColumn, STAGE_CHECKLISTS, playbookDoc } from '../playbook';

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
      expect(d.body).not.toMatch(/james@bestroofingnow/i);
    }
  });
  it('every checklist step points at a real document', () => {
    for (const s of STAGE_CHECKLISTS) for (const i of s.items) if (i.doc) expect(playbookDoc(i.doc), `${s.key}/${i.key} → ${i.doc}`).toBeDefined();
  });
});

describe('fillTemplate', () => {
  const ctx = { repName: 'Casey Rep', repCell: '(704) 555-0100', repEmail: 'casey@bestroofingnow.com', customerName: 'Pat Homeowner', customerAddress: '12 Oak St, Charlotte, NC 28205', street: 'Oak St', cityState: 'Charlotte, NC', date: 'September 16, 2026' };
  it('fills rep, customer, company and date placeholders and lists what is left', () => {
    const r = fillTemplate('Dear [HOMEOWNER NAME],\nWe are on [STREET NAME]. Call [YOUR NAME] at [YOUR CELL #] or [EMAIL]. [COMPANY NAME] [COMPANY WEBSITE] [DATE]. Storm on [STORM DATE].', ctx);
    expect(r.text).toBe('Dear Pat Homeowner,\nWe are on Oak St. Call Casey Rep at (704) 555-0100 or casey@bestroofingnow.com. Best Roofing Now bestroofingnow.com September 16, 2026. Storm on [STORM DATE].');
    expect(r.remaining).toEqual(['STORM DATE']);
    expect(r.filled.map((f) => f.placeholder)).toContain('YOUR CELL #');
  });
  it('uses the first name for first-name placeholders and the office phone when the rep has no cell', () => {
    const r = fillTemplate('Hi [CUSTOMER FIRST NAME], call [PHONE]', { ...ctx, repCell: null });
    expect(r.text).toBe('Hi Pat, call (704) 605-6047');
  });
  it('leaves unknown placeholders intact rather than blanking them', () => {
    const r = fillTemplate('[HAIL/WIND/HURRICANE/STORM] hit [NEIGHBORHOOD]', { ...ctx, street: null });
    expect(r.text).toBe('[HAIL/WIND/HURRICANE/STORM] hit [NEIGHBORHOOD]');
    expect(r.remaining).toEqual(['HAIL/WIND/HURRICANE/STORM', 'NEIGHBORHOOD']);
  });
  it('builds a signature block', () => {
    const r = fillTemplate('Thanks,\n[EMAIL SIGNATURE]', ctx);
    expect(r.text).toContain('Casey Rep\nBest Roofing Now\nCell: (704) 555-0100\nOffice: (704) 605-6047\ncasey@bestroofingnow.com\nbestroofingnow.com');
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
