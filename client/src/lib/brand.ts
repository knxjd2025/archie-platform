/**
 * The app's colors, from the signed-in company.
 *
 * Tailwind's `brand-*` classes (buttons, badges, selected chips) read CSS
 * variables on :root (see tailwind.config.js and index.css). Before anyone is
 * signed in, or while the company has not picked colors, they hold Archie's
 * own neutral navy. Once /api/auth/me answers, applyBrandTheme() swaps in the
 * company's primary and accent colors.
 *
 * Pure helpers here (no React) so the auth provider can call them without an
 * import cycle, and so they can be tested on their own.
 */

/** Archie's own default primary, used when there is no company yet. */
export const ARCHIE_PRIMARY = '#1F3A5F';
/** Archie's own default accent (thin rules, small labels). */
export const ARCHIE_ACCENT = '#C9A04B';
/** The product name, wherever the app means itself rather than the company. */
export const PRODUCT_NAME = 'Archie';

const HEX_RE = /^#?([0-9a-f]{6})$/i;

/** "#1F3A5F" → [31, 58, 95], or null when it is not a 6-digit hex color. */
export function hexToRgb(hex: string | null | undefined): [number, number, number] | null {
  const m = HEX_RE.exec((hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb: [number, number, number]) =>
  `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;

/** Move a color toward another by `amount` (0–1). */
export function mix(hex: string, toward: string, amount: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(toward);
  if (!a || !b) return hex;
  return toHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * amount) as [number, number, number]);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Text color that reads on top of `hex`: white on dark colors, near-black on
 * light ones, so a company with a yellow brand still gets legible buttons.
 */
export function textOn(hex: string): string {
  const l = luminance(hex);
  // Contrast against white vs. against #111827, whichever is higher.
  const vsWhite = 1.05 / (l + 0.05);
  const vsDark = (l + 0.05) / (luminance('#111827') + 0.05);
  return vsWhite >= vsDark ? '#FFFFFF' : '#111827';
}

const triplet = (hex: string) => (hexToRgb(hex) ?? hexToRgb(ARCHIE_PRIMARY)!).join(' ');

export interface BrandColors {
  primary: string;
  primaryDark?: string;
  accent?: string;
  /**
   * The main color the company picked on the Company page, for the app's
   * chrome (tailwind `ink-*`: the top bar and other navy surfaces). Unset
   * keeps Archie's own navy, exactly as before companies could choose.
   */
  ink?: string;
}

/** Archie's chrome navy and its two darker shades (tailwind `ink`, `ink-dark`, `ink-deep`). */
export const ARCHIE_INK = { DEFAULT: '#1F3A5F', dark: '#16293F', deep: '#0F1C2C' } as const;

/** Scale each channel toward black: `amount` 0 keeps the color, 1 is black. */
function shade(hex: string, amount: number): string {
  const rgb = hexToRgb(hex)!;
  return toHex(rgb.map((c) => c * (1 - amount)) as [number, number, number]);
}

/**
 * The ink shades for a main color: the color itself, and two darker ones in
 * the same steps Archie's own navy takes. No color: Archie's exact values.
 */
export function inkShades(main?: string | null): { DEFAULT: string; dark: string; deep: string } {
  if (!hexToRgb(main)) return { ...ARCHIE_INK };
  const m = `#${hexToRgb(main)!.map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  return { DEFAULT: m, dark: shade(m, 0.3).toUpperCase(), deep: shade(m, 0.52).toUpperCase() };
}

/**
 * The CSS variables for a set of brand colors, as "r g b" triplets so
 * Tailwind's opacity modifiers (bg-brand/20) keep working. No colors → Archie.
 */
export function brandThemeVars(colors?: BrandColors | null): Record<string, string> {
  const primary = hexToRgb(colors?.primary) ? colors!.primary : ARCHIE_PRIMARY;
  const dark = hexToRgb(colors?.primaryDark) ? colors!.primaryDark! : mix(primary, '#000000', 0.25);
  const accent = colors ? (hexToRgb(colors.accent) ? colors.accent! : primary) : ARCHIE_ACCENT;
  return {
    '--brand': triplet(primary),
    '--brand-light': triplet(mix(primary, '#FFFFFF', 0.15)),
    '--brand-dark': triplet(dark),
    '--brand-accent': triplet(accent),
    '--on-brand': triplet(textOn(primary)),
    ...inkVars(colors?.ink),
  };
}

function inkVars(main?: string | null): Record<string, string> {
  const ink = inkShades(main);
  return { '--ink': triplet(ink.DEFAULT), '--ink-dark': triplet(ink.dark), '--ink-deep': triplet(ink.deep) };
}

/**
 * Put the company's colors on :root (or Archie's when `colors` is null). The
 * header is ink, so the browser's theme color follows ink too.
 */
export function applyBrandTheme(colors: BrandColors | null | undefined, root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null): void {
  if (!root) return;
  for (const [k, v] of Object.entries(brandThemeVars(colors))) root.style.setProperty(k, v);
  const meta = typeof document !== 'undefined' ? document.querySelector('meta[name="theme-color"]') : null;
  if (meta) meta.setAttribute('content', inkShades(colors?.ink).DEFAULT.toLowerCase());
}
