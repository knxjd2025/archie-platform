import { describe, it, expect } from 'vitest';
import { ARCHIE_PRIMARY, applyBrandTheme, brandThemeVars, hexToRgb, mix, textOn } from '../brand';
import { NEUTRAL_PROFILE, letterhead } from '../company';
import { resolveCompanyProfile } from '../../../../shared/company';

/**
 * The app's brand-* colors come from the signed-in company, and fall back to
 * Archie's own navy. index.css holds the same defaults for the first paint.
 */
describe('brandThemeVars', () => {
  it("is Archie's navy with no company", () => {
    const v = brandThemeVars(null);
    expect(v['--brand']).toBe('31 58 95');
    expect(hexToRgb(ARCHIE_PRIMARY)).toEqual([31, 58, 95]);
    expect(v['--on-brand']).toBe('255 255 255');
  });

  it('matches the :root defaults in index.css', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(__dirname, '../../index.css'), 'utf8');
    for (const [k, v] of Object.entries(brandThemeVars(null))) expect(css).toContain(`${k}: ${v};`);
  });

  it("uses the company's primary and accent", () => {
    const v = brandThemeVars({ primary: '#B91C1C', primaryDark: '#7F1D1D', accent: '#FFB81C' });
    expect(v['--brand']).toBe('185 28 28');
    expect(v['--brand-dark']).toBe('127 29 29');
    expect(v['--brand-accent']).toBe('255 184 28');
  });

  it('ignores a color that is not a hex value', () => {
    expect(brandThemeVars({ primary: 'red' })['--brand']).toBe('31 58 95');
  });

  it('puts dark text on a light brand so buttons stay readable', () => {
    expect(textOn('#FFE066')).toBe('#111827');
    expect(textOn('#1F3A5F')).toBe('#FFFFFF');
    expect(brandThemeVars({ primary: '#FFE066' })['--on-brand']).toBe('17 24 39');
  });

  it('mixes toward white', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });

  it('sets the variables on the root element', () => {
    const set: Record<string, string> = {};
    const root = { style: { setProperty: (k: string, v: string) => { set[k] = v; } } } as unknown as HTMLElement;
    applyBrandTheme({ primary: '#B91C1C' }, root);
    expect(set['--brand']).toBe('185 28 28');
  });
});

describe('letterhead', () => {
  it('says only what the company entered', () => {
    const p = resolveCompanyProfile({ id: 'c1', name: 'Acme Roofing', branding: { phone: '(555) 010-0000' } });
    const lh = letterhead(p, { address: '1 Main St' });
    expect(lh.head).toContain('Acme Roofing');
    expect(lh.head).toContain('(555) 010-0000');
    expect(lh.head).not.toContain('undefined');
    expect(lh.foot).toBe('<div class="foot">Acme Roofing · 1 Main St · (555) 010-0000</div>');
  });

  it('escapes what goes into the page', () => {
    const p = resolveCompanyProfile({ id: 'c1', name: 'A <b>&</b> B' });
    expect(letterhead(p).head).toContain('A &lt;b&gt;&amp;&lt;/b&gt; B');
  });

  it('is neutral with no company', () => {
    expect(NEUTRAL_PROFILE.displayName).toBe('Your company');
    expect(NEUTRAL_PROFILE.phone).toBe('');
    expect(NEUTRAL_PROFILE.credentials).toEqual([]);
  });
});
