import jpeg from 'jpeg-js';

/** A small real JPEG (96 by 72), different for each number, as a data address. For tests only. */
export function jpegDataUrl(n: number): string {
  const w = 96; const h = 72; const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; data[i] = (60 + n * 30 + x) % 256; data[i + 1] = (90 + y) % 256; data[i + 2] = (30 + n * 17) % 256; data[i + 3] = 255; }
  return `data:image/jpeg;base64,${Buffer.from(jpeg.encode({ data, width: w, height: h }, 80).data).toString('base64')}`;
}
