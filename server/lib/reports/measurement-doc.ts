/**
 * Reads roof measurements out of a measurement report already attached to the
 * job (GAF/Nearmap QuickMeasure, EagleView, Eagle Eye).
 *
 * These are ORDERED, PAID, MEASURED documents. The Solar API estimate the
 * reports fell back to is a satellite guess — on 550 Manning Dr it said
 * 3,699 sq ft / 14 facets where the GAF report measured 4,715 / 17, a 27%
 * difference in the number the whole estimate is built on. When a real
 * measurement exists it wins, every time.
 *
 * Two traps found the hard way:
 *   - JobTread's `url` with a size argument RENDERS a PDF to a JPEG. The bytes
 *     come back with JPEG magic under an application/pdf type and no parser
 *     can read them. `url(original: true)` is the actual file.
 *   - The aerial diagrams that ship alongside ("GAF Report NNNN - NorthImage")
 *     are images of a measurement drawing, not photographs of damage. Feeding
 *     them to damage analysis wastes budget and invents findings.
 */

export interface RoofMeasurementDoc {
  source: 'gaf' | 'eagleview' | 'unknown';
  documentName: string;
  roofAreaSqFt: number | null;
  squares: number | null;
  facets: number | null;
  predominantPitch: string | null;
  ridgesHipsFt: number | null;
  valleysFt: number | null;
  rakesFt: number | null;
  eavesFt: number | null;
  /** Everything that parsed, for showing the customer where numbers came from. */
  raw: Record<string, number | string>;
}

/** Files whose NAME says they are a measurement report. */
const MEASUREMENT_NAME = /(gaf\s*report|quickmeasure|quick\s*measure|eagle\s*view|eagleview|eagle\s*eye|nearmap|roof\s*report|skymeasure|hover)/i;

/**
 * The per-elevation diagrams a measurement report ships with. They are drawings
 * of a roof, not photos of one, so damage analysis must skip them.
 */
const MEASUREMENT_DIAGRAM = /-\s*(north|south|east|west|vertical|top|side)\s*image\s*$/i;

export function isMeasurementDocName(name: string | null | undefined): boolean {
  const n = String(name || '');
  return MEASUREMENT_NAME.test(n) && !MEASUREMENT_DIAGRAM.test(n);
}

/** True for the aerial diagrams that accompany a measurement report. */
export function isMeasurementDiagram(name: string | null | undefined): boolean {
  return MEASUREMENT_DIAGRAM.test(String(name || ''));
}

/**
 * Pull the first number that follows a label.
 *
 * PDF text extraction runs labels and values together — "Roof Area4,715 sq ft",
 * "Roof Facets17" — so this deliberately does not require a separator.
 */
function num(text: string, label: RegExp): number | null {
  const re = new RegExp(`${label.source}\\s*:?\\s*([\\d,]+(?:\\.\\d+)?)`, 'i');
  const m = text.match(re);
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

/** "Predominant Pitch5 / 12" -> "5/12". */
function pitch(text: string): string | null {
  const m = text.match(/(?:predominant\s*)?pitch\s*:?\s*(\d{1,2})\s*[/:]\s*(\d{1,2})/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

export function parseMeasurementText(text: string, documentName = ''): RoofMeasurementDoc | null {
  if (!text) return null;
  // No arbitrary length floor: requiring a roof area below is the real
  // validation, and a length guard only makes the function surprising.

  const roofAreaSqFt = num(text, /roof\s*area/) ?? num(text, /total\s*(?:roof\s*)?area/);
  const facets = num(text, /(?:roof\s*)?facets/) ?? num(text, /number\s*of\s*facets/);
  const p = pitch(text);

  // A measurement report without an area is not a measurement report — better
  // to fall back to the satellite estimate than to publish a half-read one.
  if (roofAreaSqFt == null) return null;

  const source: RoofMeasurementDoc['source'] =
    /nearmap|gaf/i.test(text) ? 'gaf' : /eagle\s*view|eagleview/i.test(text) ? 'eagleview' : 'unknown';

  const ridgesHipsFt = num(text, /ridges\s*\/?\s*hips/) ?? num(text, /ridges/);
  const valleysFt = num(text, /valleys/);
  const rakesFt = num(text, /rakes/);
  const eavesFt = num(text, /eaves/);

  const raw: Record<string, number | string> = {};
  const put = (k: string, v: number | string | null) => { if (v != null) raw[k] = v; };
  put('roofAreaSqFt', roofAreaSqFt); put('facets', facets); put('predominantPitch', p);
  put('ridgesHipsFt', ridgesHipsFt); put('valleysFt', valleysFt);
  put('rakesFt', rakesFt); put('eavesFt', eavesFt);

  return {
    source,
    documentName,
    roofAreaSqFt,
    // Squares are what every downstream price is written in.
    squares: Math.round((roofAreaSqFt / 100) * 10) / 10,
    facets,
    predominantPitch: p,
    ridgesHipsFt,
    valleysFt,
    rakesFt,
    eavesFt,
    raw,
  };
}

export interface JobFileLike {
  name: string;
  type: string;
  url: string | null;
  originalUrl?: string | null;
}

/** Measurement reports on a job, newest-looking first. */
export function findMeasurementDocs<T extends JobFileLike>(files: T[]): T[] {
  return files.filter((f) => isMeasurementDocName(f.name) && /pdf/i.test(f.type || ''));
}

/**
 * Fetch and parse the job's measurement report, if it has one.
 * Fails soft to null — a report must still generate without it.
 */
export async function extractMeasurementsFromFiles(files: JobFileLike[]): Promise<RoofMeasurementDoc | null> {
  for (const f of findMeasurementDocs(files)) {
    // ONLY the original: a sized url is a rendered JPEG, not the PDF.
    const url = f.originalUrl;
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.slice(0, 5).toString('latin1') !== '%PDF-') continue;
      const mod: any = await import('pdf-parse');
      const pdfParse = mod.default || mod;
      const data = await pdfParse(buf);
      const parsed = parseMeasurementText(String(data?.text || ''), f.name);
      if (parsed) return parsed;
    } catch {
      // Corrupt or unreadable file: try the next one.
    }
  }
  return null;
}
