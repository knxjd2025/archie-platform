/**
 * The Download PDF button, as plain functions with no screen: what is drawn after
 * each step, the file's name, which photo addresses may be fetched, and the one
 * run that makes and hands over the file. The PDF code itself is not here: it is
 * loaded by the click (pdf-loader.ts), so this file is small and always in the page.
 */
import { RR } from './words';

export type PdfPhase = 'idle' | 'preparing' | 'failed';
export interface PdfState { phase: PdfPhase; error: string | null }
export const initialPdf = (): PdfState => ({ phase: 'idle', error: null });

export type PdfAction = { type: 'start' } | { type: 'done' } | { type: 'failed'; error: string };

export function pdfReducer(state: PdfState, a: PdfAction): PdfState {
  switch (a.type) {
    // A second press while it is preparing changes nothing.
    case 'start': return state.phase === 'preparing' ? state : { phase: 'preparing', error: null };
    case 'done': return initialPdf();
    case 'failed': return { phase: 'failed', error: a.error };
  }
}

/** `roof-report-12-elm-street-2026-11-24.pdf`: plain lower case letters, digits and dashes. */
export function pdfFileName(address: string | null, on: Date): string {
  const slug = (address ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/g, '');
  const date = on.toISOString().slice(0, 10);
  return slug ? `roof-report-${slug}-${date}.pdf` : `roof-report-${date}.pdf`;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** The address of one photo copy of THIS report on the app's own signed-in route, or null for anything else. */
export function photoPathFor(reportId: string, address: unknown): string | null {
  if (typeof address !== 'string' || !new RegExp(`^${UUID}$`, 'i').test(reportId)) return null;
  return new RegExp(`^/api/roof-reports/${reportId}/photos/${UUID}/(thumb|working)$`, 'i').test(address) ? address : null;
}

/** Makes the file and hands it over. Whatever goes wrong, the answer is the one plain sentence. */
export async function runPdf(deps: { build: () => Promise<Blob>; save: (file: Blob, name: string) => void }, name: string): Promise<PdfAction> {
  try {
    const file = await deps.build();
    if (!file || file.type !== 'application/pdf') return { type: 'failed', error: RR.pdf.failed };
    deps.save(file, name);
    return { type: 'done' };
  } catch {
    return { type: 'failed', error: RR.pdf.failed };
  }
}

/** Hands a file to the browser as a download. */
export function saveFile(file: Blob, name: string): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
