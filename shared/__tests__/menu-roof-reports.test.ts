import { describe, expect, it } from 'vitest';
import { MENU_ITEMS, MENU_PAGES, ROOF_REPORTS_ITEM, navItemsFor } from '../menu';

describe('the Roof reports menu entry', () => {
  it('adds nothing to the menu while the server has not said reports are on', () => {
    expect(navItemsFor({ roofReports: false })).toEqual(MENU_ITEMS);
    expect(navItemsFor({ roofReports: false }).some((m) => m.label === ROOF_REPORTS_ITEM.label)).toBe(false);
  });

  it('files the entry under Deliver, straight after Documents, once the server says so', () => {
    const items = navItemsFor({ roofReports: true });
    expect(items).toHaveLength(MENU_ITEMS.length + 1);
    const at = items.findIndex((m) => m.page === 'documents');
    expect(items[at + 1]).toBe(ROOF_REPORTS_ITEM);
    expect(ROOF_REPORTS_ITEM).toMatchObject({ page: 'roof-reports', label: 'Roof reports', group: 'deliver' });
  });

  it('leaves the company menu settings alone: the page is not one a company can hide', () => {
    expect((MENU_PAGES as readonly string[]).includes('roof-reports')).toBe(false);
    expect(MENU_ITEMS.some((m) => (m.page as string) === 'roof-reports')).toBe(false);
  });

  it('uses no sparkle, wand or long dash in what it shows', () => {
    const shown = `${ROOF_REPORTS_ITEM.label} ${ROOF_REPORTS_ITEM.icon}`;
    expect(shown).not.toMatch(/\u2014|✨|🪄|⭐|🌟/u);
  });
});
