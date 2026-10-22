import { describe, it, expect } from 'vitest';
import { atLeast, canSee, ROLE_RANK } from '../rbac';

describe('atLeast', () => {
  it('admin outranks everyone', () => {
    expect(atLeast('admin', 'production')).toBe(true);
    expect(atLeast('admin', 'admin')).toBe(true);
  });
  it('production does not meet manager', () => {
    expect(atLeast('production', 'manager')).toBe(false);
  });
  it('sales meets sales but not manager', () => {
    expect(atLeast('sales', 'sales')).toBe(true);
    expect(atLeast('sales', 'manager')).toBe(false);
  });
});

describe('canSee', () => {
  it('only admin sees settings, team, ap', () => {
    expect(canSee('admin', 'settings')).toBe(true);
    expect(canSee('manager', 'settings')).toBe(false);
    expect(canSee('manager', 'ap')).toBe(false);
    expect(canSee('admin', 'ap')).toBe(true);
  });
  it('manager sees leads/pipeline/ar/calendar but not settings', () => {
    expect(canSee('manager', 'leads')).toBe(true);
    expect(canSee('manager', 'ar')).toBe(true);
    expect(canSee('manager', 'settings')).toBe(false);
  });
  it('production sees calendar + overview only', () => {
    expect(canSee('production', 'calendar')).toBe(true);
    expect(canSee('production', 'overview')).toBe(true);
    expect(canSee('production', 'pipeline')).toBe(false);
    expect(canSee('production', 'leads')).toBe(false);
  });
  it('sales sees leads + pipeline + calendar, not ar/ap', () => {
    expect(canSee('sales', 'leads')).toBe(true);
    expect(canSee('sales', 'pipeline')).toBe(true);
    expect(canSee('sales', 'ar')).toBe(false);
    expect(canSee('sales', 'ap')).toBe(false);
  });
  it('sales sees bids but production does not', () => {
    expect(canSee('sales', 'bids')).toBe(true);
    expect(canSee('production', 'bids')).toBe(false);
  });
  it('only admin sees team and digests', () => {
    expect(canSee('admin', 'team')).toBe(true);
    expect(canSee('manager', 'team')).toBe(false);
    expect(canSee('admin', 'digests')).toBe(true);
    expect(canSee('manager', 'digests')).toBe(false);
  });
});

describe('ROLE_RANK', () => {
  it('orders roles', () => {
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.manager);
    expect(ROLE_RANK.manager).toBeGreaterThan(ROLE_RANK.sales);
    expect(ROLE_RANK.sales).toBeGreaterThan(ROLE_RANK.production);
  });
});
