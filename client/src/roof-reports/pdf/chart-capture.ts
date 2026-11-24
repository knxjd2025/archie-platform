/**
 * The two charts the PDF carries, drawn on a plain canvas and returned as PNG
 * pictures. No chart library: the PDF library is already the one large thing the
 * PDF costs, and these are two bar charts.
 *
 * They draw only from report NUMBERS. Every piece of text written on a chart is a
 * count (a whole number from 0 to 99,999), a four digit year between 1900 and
 * 2100, or one of a fixed set of words written in this file. Nothing a person or
 * a model wrote reaches a canvas: a damage kind this file has no word for is
 * drawn as "Other", whatever it was called. Every text is drawn with a width
 * limit, so a long one cannot run off the picture.
 *
 * A chart that cannot be drawn (no canvas, nothing to show) is null, and the PDF
 * is made without it.
 */

export interface Ctx2D {
  fillStyle: string; strokeStyle: string; font: string; textAlign: string; textBaseline: string; lineWidth: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; stroke(): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  scale(x: number, y: number): void;
}
export interface Surface { width: number; height: number; getContext(kind: '2d'): Ctx2D | null; toDataURL(type: string): string }
export type MakeSurface = (width: number, height: number) => Surface | null;

/** The one place a canvas is made in a browser. Anything else (a test) hands in its own. */
export const domSurface: MakeSurface = (width, height) => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as Surface;
};

/** The words a damage bar may carry. A kind with no word here is "Other". */
export const DAMAGE_LABELS: Record<string, string> = {
  hail_impact: 'Hail impact', hail_bruise: 'Hail bruise', hail_granule_loss: 'Granule loss', granule_loss: 'Granule loss',
  wind_lift: 'Wind lift', wind_lifted_shingle: 'Lifted shingle', wind_creased_shingle: 'Creased shingle', wind_missing_shingle: 'Missing shingle', missing_shingles: 'Missing shingles',
  flashing_damaged: 'Flashing damage', flashing_damage: 'Flashing damage', water_leak_stain: 'Leak stain', ponding_water: 'Ponding water', water_ponding: 'Ponding water',
  age_cracking: 'Cracking', age_curling: 'Curling', age_bald_spots: 'Bald spots', surface_alligatoring: 'Alligatoring', bio_moss_algae: 'Moss or algae',
  debris_tree_impact: 'Debris impact', mechanical_foot_traffic: 'Foot traffic wear', structural_sagging: 'Sagging',
  membrane_blistering: 'Blistering', membrane_puncture: 'Puncture', membrane_seam_failure: 'Seam failure', membrane_shrinkage: 'Shrinkage',
  cracked_shingles: 'Cracked shingles', curling_shingles: 'Curling shingles', pipe_boot_failure: 'Pipe boot failure', ridge_cap_damage: 'Ridge cap damage',
};

const MAX_COUNT = 99_999;
const MAX_YEARS = 12;
const MAX_BARS = 6;
const PIXEL_RATIO = 2;
const INK = '#374151';
const GRID = '#e5e7eb';
const HAIL = '#d97706';
const WIND = '#2563eb';
const DAMAGE = '#b91c1c';

/** A count from the report: a whole number from 0 to 99,999, anything else 0. */
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_COUNT, Math.max(0, Math.round(v))) : 0);

/** The wording of a damage kind: a fixed word, or Other. Never the kind's own text. */
export const damageLabel = (type: unknown): string => (typeof type === 'string' && Object.hasOwn(DAMAGE_LABELS, type) ? DAMAGE_LABELS[type] : 'Other');

const PNG = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

/** Draws one chart: sets the surface up, runs `draw`, and hands back the picture, or null when anything stops it. */
function paint(make: MakeSurface, width: number, height: number, draw: (c: Ctx2D) => void): string | null {
  try {
    const surface = make(width * PIXEL_RATIO, height * PIXEL_RATIO);
    const ctx = surface?.getContext('2d');
    if (!surface || !ctx) return null;
    ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    draw(ctx);
    const url = surface.toDataURL('image/png');
    return typeof url === 'string' && PNG.test(url) ? url : null;
  } catch {
    return null;
  }
}

/** Text with a width limit, always. */
const text = (c: Ctx2D, t: string, x: number, y: number, maxWidth: number, align: 'left' | 'center' | 'right' = 'center') => {
  c.textAlign = align;
  c.fillText(t, x, y, maxWidth);
};

/** Storm events by year: a hail bar and a wind bar for each of the latest twelve years. */
export function captureStormTimelineChart(eventsByYear: unknown, make: MakeSurface = domSurface): string | null {
  if (!eventsByYear || typeof eventsByYear !== 'object' || Array.isArray(eventsByYear)) return null;
  const rows = Object.entries(eventsByYear as Record<string, unknown>)
    .filter(([k]) => /^\d{4}$/.test(k) && Number(k) >= 1900 && Number(k) <= 2100)
    .map(([k, v]) => ({ year: Number(k), hail: count((v as { hail?: unknown } | null)?.hail), wind: count((v as { wind?: unknown } | null)?.wind) }))
    .sort((a, b) => a.year - b.year)
    .slice(-MAX_YEARS);
  const top = Math.max(0, ...rows.map((r) => Math.max(r.hail, r.wind)));
  if (rows.length === 0 || top === 0) return null;
  const W = 600; const H = 250; const left = 40; const bottom = 40; const topPad = 34; const plotH = H - bottom - topPad; const plotW = W - left - 16;
  return paint(make, W, H, (c) => {
    c.font = '11px Helvetica, Arial, sans-serif';
    c.fillStyle = INK; c.textBaseline = 'middle';
    c.strokeStyle = GRID; c.lineWidth = 1;
    c.beginPath(); c.moveTo(left, topPad + plotH); c.lineTo(left + plotW, topPad + plotH); c.stroke();
    const slot = plotW / rows.length;
    const bar = Math.min(26, slot / 2 - 4);
    rows.forEach((r, i) => {
      const cx = left + slot * i + slot / 2;
      for (const [n, dx, color] of [[r.hail, -bar - 1, HAIL], [r.wind, 1, WIND]] as const) {
        const h = Math.max(1, (n / top) * plotH);
        c.fillStyle = color;
        c.fillRect(cx + dx, topPad + plotH - h, bar, h);
        c.fillStyle = INK;
        text(c, String(n), cx + dx + bar / 2, topPad + plotH - h - 8, 30);
      }
      text(c, String(r.year), cx, topPad + plotH + 16, 50);
    });
    c.fillStyle = HAIL; c.fillRect(W - 150, 10, 12, 12); c.fillStyle = INK; text(c, 'Hail', W - 132, 16, 40, 'left');
    c.fillStyle = WIND; c.fillRect(W - 80, 10, 12, 12); c.fillStyle = INK; text(c, 'Wind', W - 62, 16, 40, 'left');
  });
}

/** Damage found, by kind: up to six horizontal bars, the largest first. */
export function captureDamageChart(types: unknown, make: MakeSurface = domSurface): string | null {
  if (!Array.isArray(types)) return null;
  const merged = new Map<string, number>();
  for (const t of types) {
    const n = count((t as { count?: unknown } | null)?.count);
    if (n > 0) { const label = damageLabel((t as { type?: unknown } | null)?.type); merged.set(label, Math.min(MAX_COUNT, (merged.get(label) ?? 0) + n)); }
  }
  const rows = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_BARS);
  if (rows.length === 0) return null;
  const top = rows[0][1];
  const W = 500; const rowH = 34; const H = 20 + rows.length * rowH; const left = 150; const plotW = W - left - 50;
  return paint(make, W, H, (c) => {
    c.font = '12px Helvetica, Arial, sans-serif';
    c.textBaseline = 'middle';
    rows.forEach(([label, n], i) => {
      const y = 10 + i * rowH;
      c.fillStyle = INK;
      text(c, label, left - 10, y + rowH / 2 - 2, left - 16, 'right');
      c.fillStyle = DAMAGE;
      const w = Math.max(2, (n / top) * plotW);
      c.fillRect(left, y + 4, w, rowH - 14);
      c.fillStyle = INK;
      text(c, String(n), left + w + 6, y + rowH / 2 - 2, 44, 'left');
    });
  });
}
