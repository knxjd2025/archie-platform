import { describe, it, expect } from 'vitest';
import { contrastRatio, isHexColor, readableWithWhite, relativeLuminance } from '../contrast';

describe('contrast', () => {
  it('knows the end points', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 6);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 6);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 6);
  });

  it('is the same either way round', () => {
    expect(contrastRatio('#1F3A5F', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#1F3A5F'), 10);
  });

  it('matches published values', () => {
    // WebAIM's checker: #767676 on white is 4.54:1, #777777 is 4.48:1.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it('keeps a color that already reads with white text', () => {
    expect(readableWithWhite('#1f3a5f')).toMatchObject({ color: '#1F3A5F', adjusted: false });
    expect(readableWithWhite('#14532D').adjusted).toBe(false);
  });

  it('darkens a light color until white text reads on it', () => {
    for (const light of ['#FFE066', '#87CEEB', '#FFFFFF', '#00FF00', '#777777']) {
      const r = readableWithWhite(light);
      expect(r.adjusted).toBe(true);
      expect(isHexColor(r.color)).toBe(true);
      expect(contrastRatio(r.color, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
      expect(r.ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the hue while darkening', () => {
    const { color } = readableWithWhite('#87CEEB'); // sky blue stays blue
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
  });

  it('stops close to the line rather than going to black', () => {
    const { color } = readableWithWhite('#FFE066');
    expect(contrastRatio(color, '#FFFFFF')).toBeLessThan(5.5);
  });

  it('only accepts #RRGGBB', () => {
    expect(isHexColor('#1F3A5F')).toBe(true);
    expect(isHexColor('#fff')).toBe(false);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('1F3A5F')).toBe(false);
    expect(() => relativeLuminance('red')).toThrow();
  });
});
