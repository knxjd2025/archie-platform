/**
 * The small copy of a report photo.
 *
 * A report page and a list show a photo many times over; the full cleaned copy
 * (up to 8 MB) is for the report and for analysis. This makes the small one:
 * the picture decoded, shrunk to fit 480 px on its longest side (never
 * enlarged) by averaging the pixels each new pixel covers, and written again
 * as a fresh JPEG. The encoder writes the picture and a bare JFIF header and
 * nothing else, so no location, camera or caption can come through it, and the
 * result is then walked by the same cleaner every stored photo goes through, so
 * a thumbnail is only ever returned if it passes that check.
 *
 * jpeg-js is pure JavaScript (no native code, no dependencies, about 76 KB):
 * Archie had no JPEG library, and this is the one it adds for this.
 *
 * Returns null when the picture cannot be made small: a file that is not a
 * JPEG it can decode, one claiming more than 48 million pixels (a decoder is
 * not given a size it can be made to blow up on), or anything unexpected. The
 * caller then keeps the cleaned copy as the thumbnail, as it did before, so no
 * upload that worked before is refused now.
 */
import jpeg from 'jpeg-js';
import { cleanJpeg } from '../photos/jpeg-clean';

export const THUMB_LONGEST_SIDE = 480;
const THUMB_QUALITY = 75;
/** Pixels, in millions, a picture may claim. A phone's largest is about 50. */
const MAX_MEGAPIXELS = 48;
const MAX_DECODER_MEMORY_MB = 400;

/** Averages the source pixels each destination pixel covers. RGBA in, RGBA out. */
function shrink(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Buffer {
  const out = Buffer.alloc(dw * dh * 4);
  const xs = sw / dw;
  const ys = sh / dh;
  for (let dy = 0; dy < dh; dy++) {
    const y0 = Math.floor(dy * ys);
    const y1 = Math.min(sh, Math.max(y0 + 1, Math.floor((dy + 1) * ys)));
    for (let dx = 0; dx < dw; dx++) {
      const x0 = Math.floor(dx * xs);
      const x1 = Math.min(sw, Math.max(x0 + 1, Math.floor((dx + 1) * xs)));
      let r = 0; let g = 0; let b = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * sw + x0) * 4;
        for (let x = x0; x < x1; x++, i += 4) { r += src[i]; g += src[i + 1]; b += src[i + 2]; }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (dy * dw + dx) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = 255;
    }
  }
  return out;
}

export function makeThumbnail(source: Buffer): Buffer | null {
  try {
    if (!Buffer.isBuffer(source) || source.length < 4) return null;
    const picture = jpeg.decode(source, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_MEGAPIXELS, maxMemoryUsageInMB: MAX_DECODER_MEMORY_MB });
    const { width, height } = picture;
    if (!(width > 0) || !(height > 0) || picture.data.length < width * height * 4) return null;
    const scale = Math.min(1, THUMB_LONGEST_SIDE / Math.max(width, height));
    const dw = Math.max(1, Math.round(width * scale));
    const dh = Math.max(1, Math.round(height * scale));
    const pixels = dw === width && dh === height ? Buffer.from(picture.data.buffer, picture.data.byteOffset, picture.data.byteLength) : shrink(picture.data, width, height, dw, dh);
    const encoded = Buffer.from(jpeg.encode({ data: pixels, width: dw, height: dh }, THUMB_QUALITY).data);
    // The same check every stored photo passes: only a picture's own blocks, ending where it should.
    const checked = cleanJpeg(encoded);
    return checked.ok ? checked.jpeg : null;
  } catch {
    return null;
  }
}
