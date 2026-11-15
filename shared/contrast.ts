/**
 * Color contrast (WCAG 2.x), for the company's chosen colors.
 *
 * The top bar and primary buttons put white text on the company's main color.
 * A light main color (pale yellow, sky blue) would make that text hard to
 * read, so a color that does not reach 4.5:1 against white is darkened, a
 * little at a time, until it does. Pure functions, no DOM, shared by the
 * server (which saves the adjusted color) and the client (live preview).
 */

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** True for a "#RRGGBB" color. */
export const isHexColor = (v: unknown): v is string => typeof v === 'string' && HEX_RE.test(v);

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: number[]) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** WCAG relative luminance of a "#RRGGBB" color, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  if (!isHexColor(hex)) throw new Error(`Not a #RRGGBB color: ${String(hex)}`);
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colors, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The contrast normal-size text needs (WCAG AA). */
export const MIN_TEXT_CONTRAST = 4.5;

/** The accent: thin strips and small labels on white must reach at least this. */
export const MIN_ACCENT_CONTRAST = 3;

/**
 * The color itself when white text reads on it at `min`:1 or better;
 * otherwise the same hue darkened in small steps until it does. Black always
 * passes, so this always ends. Returns the color as uppercase "#RRGGBB".
 */
export function readableWithWhite(hex: string, min = MIN_TEXT_CONTRAST): { color: string; adjusted: boolean; ratio: number } {
  const start = hex.toUpperCase();
  let ratio = contrastRatio(start, '#FFFFFF');
  if (ratio >= min) return { color: start, adjusted: false, ratio };
  const base = rgb(start);
  // 2% darker per step keeps the hue and lands just past the line, not far beyond it.
  for (let k = 0.98; k > 0; k -= 0.02) {
    const color = toHex(base.map((c) => c * k));
    ratio = contrastRatio(color, '#FFFFFF');
    if (ratio >= min) return { color, adjusted: true, ratio };
  }
  return { color: '#000000', adjusted: true, ratio: 21 };
}
