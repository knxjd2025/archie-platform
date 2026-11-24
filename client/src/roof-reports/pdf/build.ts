/**
 * Makes the PDF in the browser: the one module the Download PDF button loads, and
 * the only one that loads the PDF library (`pdf-loader.ts` reaches it with a
 * dynamic import, so the page everyone opens never carries it).
 *
 * The photos come through the signed-in photo route of THIS report, the small
 * copy of each, one at a time as a few at once; a photo that cannot be fetched is
 * left out and the rest still go in. Nothing is fetched from anywhere else.
 */
import { createElement } from 'react';
import { pdf } from '@react-pdf/renderer';
import { photoPathFor } from '../pdf-model';
import { captureDamageChart, captureStormTimelineChart } from './chart-capture';
import { pdfContent, type PdfCompany, type PdfPhotoInput } from './content';
import { RoofReportPDF } from './RoofReportPDF';

export interface PdfSource {
  id: string;
  title: string | null;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  customerName: string | null;
  inspectionDate: string | null;
  inspectorNotes: string | null;
  report: Record<string, unknown> | null;
  photos: Array<{ id: string; category: string | null; thumbUrl: string }>;
}

const MAX_PHOTO_BYTES = 6_000_000;
const CONCURRENT = 4;

function toDataUrl(bytes: ArrayBuffer, type: string): string {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

/** One photo as a picture held in memory, or null. Only this report's own signed-in route is ever asked. */
export async function fetchPhoto(reportId: string, photo: PdfSource['photos'][number], get: typeof fetch = fetch): Promise<PdfPhotoInput | null> {
  const path = photoPathFor(reportId, photo.thumbUrl);
  if (!path) return null;
  try {
    const res = await get(path, { credentials: 'same-origin' });
    const type = res.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (!res.ok || (type !== 'image/jpeg' && type !== 'image/png')) return null;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) return null;
    return { id: photo.id, category: photo.category, dataUrl: toDataUrl(bytes, type) };
  } catch {
    return null;
  }
}

async function fetchPhotos(source: PdfSource): Promise<PdfPhotoInput[]> {
  const found: Array<PdfPhotoInput | null> = new Array(source.photos.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENT, source.photos.length) }, async () => {
    while (next < source.photos.length) { const i = next++; found[i] = await fetchPhoto(source.id, source.photos[i]); }
  }));
  return found.filter((p): p is PdfPhotoInput => p !== null);
}

/** The finished PDF, as a file in memory. */
export async function buildReportPdf(source: PdfSource, company: PdfCompany): Promise<Blob> {
  const report = source.report;
  const photos = await fetchPhotos(source);
  const content = pdfContent({
    company, title: source.title ?? '', address: source.address, cityStateZip: [source.city, [source.state, source.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    customerName: source.customerName ?? '', inspectionDate: source.inspectionDate, inspectorNotes: source.inspectorNotes ?? '', report, photos, generatedOn: new Date(),
  });
  const storm = (report?.stormHistory as { eventsByYear?: unknown } | undefined)?.eventsByYear;
  const damage = (report?.damageAnalysis as { damageTypes?: unknown } | undefined)?.damageTypes;
  const charts = { storm: captureStormTimelineChart(storm), damage: captureDamageChart(damage) };
  return pdf(createElement(RoofReportPDF, { content, charts }) as never).toBlob();
}
