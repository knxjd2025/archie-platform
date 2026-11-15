import { describe, it, expect } from 'vitest';
import {
  ADMIN_PROTECTED_PAGES, MENU_ITEMS, MENU_PAGES, hiddenPagesFor, menuCell, pageVisible, roleCanSeePage, validateMenuHidden,
} from '../menu';
import { ALL_ROLES } from '../rbac';

describe('menu', () => {
  it('lists every page once, in the menu and the key list alike', () => {
    expect(MENU_ITEMS.map((m) => m.page)).toEqual([...MENU_PAGES]);
    expect(new Set(MENU_PAGES).size).toBe(MENU_PAGES.length);
  });

  it('puts Company in the setup group for admins only', () => {
    expect(MENU_ITEMS.find((m) => m.page === 'company')?.group).toBe('setup');
    for (const role of ALL_ROLES) expect(roleCanSeePage(role, 'company')).toBe(role === 'admin');
  });

  it('keeps the role rules the menu always had', () => {
    expect(roleCanSeePage('production', 'leads')).toBe(false);
    expect(roleCanSeePage('customer_service', 'commission')).toBe(false);
    expect(roleCanSeePage('sales', 'payouts')).toBe(true);
    expect(roleCanSeePage('sales', 'assignments')).toBe(false);
    expect(roleCanSeePage('manager', 'assignments')).toBe(true);
    expect(roleCanSeePage('sales', 'team')).toBe(false);
    for (const role of ALL_ROLES) expect(roleCanSeePage(role, 'meetings')).toBe(true);
  });

  it('locks Home on for everyone and the three setup pages on for admins', () => {
    for (const role of ALL_ROLES) expect(menuCell(role, 'dashboard')).toBe('locked_on');
    for (const page of ADMIN_PROTECTED_PAGES) expect(menuCell('admin', page)).toBe('locked_on');
    expect(menuCell('admin', 'bugs')).toBe('switch');
    expect(menuCell('sales', 'team')).toBe('never');
  });

  it('accepts a valid map and cleans it', () => {
    const r = validateMenuHidden({ sales: ['kpis', 'canvass', 'kpis'], admin: ['bugs'], production: [] });
    expect(r).toEqual({ ok: true, value: { sales: ['canvass', 'kpis'], admin: ['bugs'] } });
  });

  it('refuses unknown levels, unknown pages and bad shapes', () => {
    expect(validateMenuHidden({ owner: ['kpis'] }).ok).toBe(false);
    expect(validateMenuHidden({ sales: ['nope'] }).ok).toBe(false);
    expect(validateMenuHidden({ sales: 'kpis' }).ok).toBe(false);
    expect(validateMenuHidden(['sales']).ok).toBe(false);
    expect(validateMenuHidden(null).ok).toBe(false);
  });

  it('refuses hiding a page the level never sees (hiding only narrows)', () => {
    const r = validateMenuHidden({ sales: ['team'] });
    expect(r.ok).toBe(false);
  });

  it('refuses locking admins out of the Company, Team and Integrations pages', () => {
    for (const page of ADMIN_PROTECTED_PAGES) {
      const r = validateMenuHidden({ admin: [page] });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/cannot be hidden from Admin/);
    }
    expect(validateMenuHidden({ sales: ['dashboard'] }).ok).toBe(false);
  });

  it('reads back only what can really be hidden', () => {
    const stored = { sales: ['kpis', 'team', 'dashboard', 'gone'], admin: ['company', 'bugs'] };
    expect(hiddenPagesFor(stored, 'sales')).toEqual(['kpis']);
    expect(hiddenPagesFor(stored, 'admin')).toEqual(['bugs']);
    expect(hiddenPagesFor(null, 'sales')).toEqual([]);
    expect(hiddenPagesFor({ sales: 'kpis' }, 'sales')).toEqual([]);
  });

  it('never shows a page the role may not see, whatever is hidden', () => {
    expect(pageVisible('sales', 'team', [])).toBe(false);
    expect(pageVisible('sales', 'kpis', ['kpis'])).toBe(false);
    expect(pageVisible('sales', 'kpis', [])).toBe(true);
    expect(pageVisible('admin', 'company', ['company'])).toBe(true);
    expect(pageVisible('sales', 'dashboard', ['dashboard'])).toBe(true);
  });
});
