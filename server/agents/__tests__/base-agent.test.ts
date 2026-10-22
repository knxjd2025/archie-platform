import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getProviderForRole, getModelForRole, getOpenModelForRole } from '../base-agent';

const PROVIDER_ENV_KEYS = [
  'ADVISOR_PROVIDER_CEO',
  'ADVISOR_PROVIDER_PROJECT_COORDINATOR',
  'ADVISOR_PROVIDER_UNKNOWN_ROLE',
];
const MODEL_ENV_KEYS = ['ANTHROPIC_MODEL', 'ANTHROPIC_MODEL_CEO', 'OPEN_MODEL', 'OPEN_MODEL_ESTIMATOR'];

function clearEnv(keys: string[]) {
  for (const k of keys) delete process.env[k];
}

beforeEach(() => clearEnv([...PROVIDER_ENV_KEYS, ...MODEL_ENV_KEYS]));
afterEach(() => clearEnv([...PROVIDER_ENV_KEYS, ...MODEL_ENV_KEYS]));

describe('getProviderForRole', () => {
  it('keeps the highest-stakes advisors on anthropic by default', () => {
    for (const role of ['ceo', 'cfo', 'cpa', 'tax_accountant', 'tax_lawyer']) {
      expect(getProviderForRole(role)).toBe('anthropic');
    }
  });

  it('defaults the day-to-day advisors to the open model', () => {
    for (const role of ['coo', 'cmo', 'sales_manager', 'customer_service', 'estimator', 'project_coordinator']) {
      expect(getProviderForRole(role)).toBe('open');
    }
  });

  it('fails closed to anthropic for an unrecognized role', () => {
    expect(getProviderForRole('unknown_role')).toBe('anthropic');
  });

  it('honors a per-role ADVISOR_PROVIDER_<ROLE> override in either direction', () => {
    process.env.ADVISOR_PROVIDER_CEO = 'open';
    expect(getProviderForRole('ceo')).toBe('open');

    process.env.ADVISOR_PROVIDER_PROJECT_COORDINATOR = 'anthropic';
    expect(getProviderForRole('project_coordinator')).toBe('anthropic');
  });

  it('ignores a garbage override value and falls back to the default', () => {
    process.env.ADVISOR_PROVIDER_UNKNOWN_ROLE = 'not-a-real-provider';
    expect(getProviderForRole('unknown_role')).toBe('anthropic');
  });
});

describe('getModelForRole (Anthropic)', () => {
  it('falls back to the hardcoded default with no env set', () => {
    expect(getModelForRole('ceo')).toBe('claude-sonnet-4-20250514');
  });

  it('prefers a per-role override over the global default', () => {
    process.env.ANTHROPIC_MODEL = 'global-model';
    process.env.ANTHROPIC_MODEL_CEO = 'ceo-model';
    expect(getModelForRole('ceo')).toBe('ceo-model');
    expect(getModelForRole('cfo')).toBe('global-model');
  });
});

describe('getOpenModelForRole', () => {
  it('falls back to the hardcoded default with no env set', () => {
    // Maverick handles advisor conversation; reports use Qwen3-VL / Kimi instead.
    expect(getOpenModelForRole('estimator')).toBe('meta-llama/llama-4-maverick');
  });

  it('prefers a per-role override over the global default', () => {
    process.env.OPEN_MODEL = 'global-open-model';
    process.env.OPEN_MODEL_ESTIMATOR = 'estimator-open-model';
    expect(getOpenModelForRole('estimator')).toBe('estimator-open-model');
    expect(getOpenModelForRole('coo')).toBe('global-open-model');
  });
});
