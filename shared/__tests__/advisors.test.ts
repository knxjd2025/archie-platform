import { describe, it, expect } from 'vitest';
import { canUseAdvisor, advisorsForRole, advisorMinRole, ADVISOR_MIN_ROLE, ADVISOR_FOCUS } from '../advisors';

const TEAM_ADVISORS = ['sales_manager', 'customer_service', 'coo', 'project_coordinator', 'estimator'];

describe('advisor access by role', () => {
  it('gives a sales rep the five team advisors and nothing else', () => {
    expect(new Set(advisorsForRole('sales'))).toEqual(new Set(TEAM_ADVISORS));
  });

  it('keeps marketing, finance, legal and exec advisors away from sales', () => {
    for (const a of ['ceo', 'cfo', 'cpa', 'tax_accountant', 'tax_lawyer', 'cmo']) {
      expect(canUseAdvisor('sales', a), a).toBe(false);
    }
  });

  it('gives production only the project coordinator', () => {
    expect(advisorsForRole('production')).toEqual(['project_coordinator']);
    expect(canUseAdvisor('production', 'sales_manager')).toBe(false);
  });

  it('opens marketing to managers but not the books', () => {
    expect(canUseAdvisor('manager', 'cmo')).toBe(true);
    expect(canUseAdvisor('manager', 'cfo')).toBe(false);
    expect(canUseAdvisor('manager', 'tax_lawyer')).toBe(false);
  });

  it('gives admin everything', () => {
    expect(new Set(advisorsForRole('admin'))).toEqual(new Set(Object.keys(ADVISOR_MIN_ROLE)));
  });

  it('has a focus line for every advisor', () => {
    for (const a of Object.keys(ADVISOR_MIN_ROLE)) expect(ADVISOR_FOCUS[a], a).toBeTruthy();
  });

  it('fails closed on an unknown advisor', () => {
    expect(advisorMinRole('some_new_bot')).toBe('admin');
    expect(canUseAdvisor('sales', 'some_new_bot')).toBe(false);
    expect(canUseAdvisor('manager', 'some_new_bot')).toBe(false);
  });
});
