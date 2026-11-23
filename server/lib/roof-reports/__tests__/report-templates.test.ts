import { describe, it, expect } from 'vitest';
import {
  getTemplateConfig,
  getDefaultTemplateConfig,
  REPORT_TEMPLATES,
  REPORT_SECTION_KEYS,
  DEFAULT_REPORT_TEMPLATE,
  type ReportTemplate,
  type ReportTemplateConfig,
} from '../report-templates';

const VALID_NAMES: ReportTemplate[] = ['insurance', 'homeowner', 'full', 'quick'];

/** Assert a config has the full, valid section-flag shape every consumer reads. */
function expectValidConfig(config: ReportTemplateConfig | undefined) {
  expect(config).toBeDefined();
  expect(config).not.toBeNull();
  // id must be one of the four known templates
  expect(VALID_NAMES).toContain(config!.id);
  // sections must be a defined object with every expected boolean flag present
  expect(config!.sections).toBeDefined();
  for (const key of REPORT_SECTION_KEYS) {
    expect(typeof config!.sections[key]).toBe('boolean');
  }
}

describe('getTemplateConfig — hardening against unknown/invalid template names', () => {
  it('returns the exact same config for each of the four valid template names', () => {
    for (const name of VALID_NAMES) {
      // Must be the canonical config object (unchanged by hardening).
      expect(getTemplateConfig(name)).toBe(REPORT_TEMPLATES[name]);
      expect(getTemplateConfig(name).id).toBe(name);
      expectValidConfig(getTemplateConfig(name));
    }
  });

  it('returns a safe valid default config (never undefined) for an unknown string name', () => {
    // Cast to bypass the compile-time union — this models data arriving from
    // JSONB / query params at runtime.
    const config = getTemplateConfig('totally-not-a-template' as unknown as ReportTemplate);
    expectValidConfig(config);
    expect(config).toBe(getDefaultTemplateConfig());
    expect(config.id).toBe(DEFAULT_REPORT_TEMPLATE);
  });

  it('returns a safe valid default config for an empty string', () => {
    const config = getTemplateConfig('' as unknown as ReportTemplate);
    expectValidConfig(config);
    expect(config).toBe(getDefaultTemplateConfig());
  });

  it('returns a safe valid default config for null / undefined', () => {
    expectValidConfig(getTemplateConfig(null));
    expectValidConfig(getTemplateConfig(undefined));
    expectValidConfig(getTemplateConfig());
    expect(getTemplateConfig(null)).toBe(getDefaultTemplateConfig());
    expect(getTemplateConfig(undefined)).toBe(getDefaultTemplateConfig());
  });

  it('returns a safe valid default config for non-string values without throwing', () => {
    const nonStrings: unknown[] = [123, {}, [], true, false, NaN, () => {}, Symbol('x')];
    for (const bad of nonStrings) {
      let config: ReportTemplateConfig | undefined;
      expect(() => {
        config = getTemplateConfig(bad as unknown as ReportTemplate);
      }).not.toThrow();
      expectValidConfig(config);
      expect(config).toBe(getDefaultTemplateConfig());
    }
  });

  it('does not let a prototype-pollution key (e.g. "toString", "constructor") leak a non-config', () => {
    // hasOwnProperty-based lookup must reject inherited Object.prototype keys.
    for (const key of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
      const config = getTemplateConfig(key as unknown as ReportTemplate);
      expectValidConfig(config);
      expect(config).toBe(getDefaultTemplateConfig());
    }
  });

  it('the returned default config is the "full" template, with full section coverage', () => {
    const config = getTemplateConfig('unknown' as unknown as ReportTemplate);
    expect(config.id).toBe('full');
    // "full" enables every section — sanity-check a representative flag set.
    expect(config.sections.executiveSummary).toBe(true);
    expect(config.sections.photoGallery).toBe(true);
    expect(config.sections.warrantyPage).toBe(true);
  });
});
