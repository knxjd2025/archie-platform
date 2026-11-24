/**
 * What goes into the PDF, as plain text made from the saved report: no screen
 * and no library, so it can be held by tests. Everything a person or a model
 * wrote (the summary, a finding, the notes, a caption, a company's name) is
 * cleaned and cut to a length first (`pdfText`), a section with nothing in it is
 * left out, and no stored address is ever drawn: photos come in as pictures the
 * caller already fetched, and only a JPEG or PNG picture held in the page counts.
 */
import { PHOTO_KIND_LABEL } from '../words';
import { REPORT_PHOTO_CATEGORIES, type ReportPhotoCategory } from '../../../../shared/roof-reports';
import { damageLabel } from './chart-capture';

export interface PdfPhotoInput { id: string; category: string | null; dataUrl: string }
export interface PdfCompany { name: string; phone: string; email: string; website: string }

export interface PdfInput {
  company: PdfCompany;
  title: string;
  address: string;
  cityStateZip: string;
  customerName: string;
  inspectionDate: string | null;
  inspectorNotes: string;
  /** The saved report, as the editor holds it. Read defensively: any piece may be missing or the wrong shape. */
  report: Record<string, unknown> | null;
  photos: PdfPhotoInput[];
  generatedOn: Date;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿­]/g;

/** Plain text for the PDF's built-in fonts: no control or invisible characters, no emoji, no dash that is not a hyphen, one kind of line break, cut to `max`. */
export function pdfText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  let t = raw.replace(/\r\n?/g, '\n').replace(/[“”„]/g, '"').replace(/[‘’‚]/g, "'")
    .replace(/\s*—\s*/g, ', ').replace(/–/g, '-').replace(/…/g, '...').replace(/ /g, ' ')
    .replace(INVISIBLE, '').replace(CONTROL, '');
  // Anything the built-in fonts cannot draw (beyond Latin-1) goes: emoji, symbols, other scripts.
  t = t.replace(/[^\n -~¡-ÿ]/g, ' ');
  t = t.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').replace(/ +/g, ' ').trim();
  return t.length > max ? `${t.slice(0, Math.max(0, max - 1)).trimEnd()}.` : t;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const WORD: Record<string, string> = {
  critical: 'Critical', high: 'High', moderate: 'Moderate', medium: 'Medium', low: 'Low', minor: 'Minor', advisory: 'Advisory', cosmetic: 'Cosmetic', none: 'None',
};
const severityWord = (v: unknown): string => (typeof v === 'string' && Object.hasOwn(WORD, v) ? WORD[v] : 'Noted');

const CONDITION: Record<string, string> = {
  none: 'No damage was found.', low: 'The roof shows minor wear.', medium: 'The roof shows moderate damage.', high: 'The roof shows significant damage.', critical: 'The roof shows severe damage.',
};

const money = (n: number | null): string => (n === null ? '' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
const day = (d: Date | null, utc: boolean): string => (d && !Number.isNaN(d.getTime())
  ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...(utc ? { timeZone: 'UTC' } : {}) })
  : '');

const PICTURE = /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const MAX_PICTURE_CHARS = 8_000_000;

export interface PdfContent {
  cover: { company: string; title: string; address: string; cityStateZip: string; customer: string; inspected: string; made: string };
  footer: string;
  condition: string[];
  summary: string;
  findings: Array<{ title: string; severity: string; narrative: string; action: string }>;
  damage: Array<{ label: string; count: number; severity: string }>;
  storm: { lines: string[]; years: Record<number, { hail: number; wind: number; total: number }> } | null;
  photos: Array<{ dataUrl: string; caption: string }>;
  estimate: { rows: Array<{ item: string; quantity: string; each: string; total: string }>; total: string } | null;
  measurements: { lines: string[] } | null;
  notes: string;
  disclaimer: string;
  /** The titles of the sections that are in, in order. */
  sections: string[];
}

export const DISCLAIMER = 'This report describes what could be seen in the photos and found in the storm records available on the day it was made. It is not a guarantee of insurance coverage or of a roof\'s future condition.';

export function pdfContent(input: PdfInput): PdfContent {
  const report = obj(input.report);
  const company = pdfText(input.company?.name, 100);
  const footer = [company, pdfText(input.company?.phone, 40), pdfText(input.company?.email, 100)].filter(Boolean).join('  |  ');

  const findings = arr(report.structuredFindings).map(obj).map((f) => ({
    title: pdfText(f.title, 150), severity: severityWord(f.severity), narrative: pdfText(f.narrative, 2000), action: pdfText(f.repairAction, 400),
  })).filter((f) => f.title || f.narrative).slice(0, 40);

  const analysis = obj(report.damageAnalysis);
  const damage = arr(analysis.damageTypes).map(obj).map((d) => ({ label: damageLabel(d.type), count: Math.max(0, Math.round(num(d.count) ?? 0)), severity: severityWord(d.severity) })).filter((d) => d.count > 0).slice(0, 20);

  const condition: string[] = [];
  const overall = typeof analysis.overallSeverity === 'string' && Object.hasOwn(CONDITION, analysis.overallSeverity) ? CONDITION[analysis.overallSeverity] : '';
  if (overall) condition.push(overall);
  const analysed = num(analysis.totalPhotosAnalyzed); const withDamage = num(analysis.photosWithDamage);
  if (analysed !== null && analysed > 0 && withDamage !== null) condition.push(`${withDamage} of ${analysed} ${plural(analysed, 'photo shows', 'photos show')} damage.`);

  const stormRaw = obj(report.stormHistory);
  const years: Record<number, { hail: number; wind: number; total: number }> = {};
  for (const [k, v] of Object.entries(obj(stormRaw.eventsByYear))) {
    if (!/^\d{4}$/.test(k)) continue;
    const e = obj(v);
    years[Number(k)] = { hail: Math.max(0, Math.round(num(e.hail) ?? 0)), wind: Math.max(0, Math.round(num(e.wind) ?? 0)), total: Math.max(0, Math.round(num(e.total) ?? 0)) };
  }
  const total = num(stormRaw.totalEvents) ?? 0;
  let storm: PdfContent['storm'] = null;
  if (total > 0 || Object.keys(years).length > 0) {
    const lines: string[] = [];
    const radius = num(stormRaw.searchRadiusMiles); const span = num(stormRaw.yearsAnalyzed);
    const kinds = [`${num(stormRaw.hailEvents) ?? 0} hail`, `${num(stormRaw.windEvents) ?? 0} wind`, ...((num(stormRaw.tornadoEvents) ?? 0) > 0 ? [`${num(stormRaw.tornadoEvents)} tornado`] : [])].join(', ');
    lines.push(`${total} storm ${plural(total, 'report', 'reports')}${radius ? ` within ${radius} ${plural(radius, 'mile', 'miles')}` : ''}${span ? ` in the last ${span === 1 ? 'year' : `${span} years`}` : ''}: ${kinds}.`);
    const hail = num(stormRaw.largestHailInches); const wind = num(stormRaw.highestWindMph);
    if (hail) lines.push(`Largest hail reported: ${hail} ${plural(hail, 'inch', 'inches')}.`);
    if (wind) lines.push(`Highest wind reported: ${wind} mph.`);
    storm = { lines, years };
  }

  const est = obj(report.repairEstimate);
  const rows = arr(est.lineItems).map(obj).map((l) => ({
    item: pdfText(l.repairName, 120), quantity: `${num(l.quantity) ?? 0} ${pdfText(l.unit, 16)}`.trim(), each: money(num(l.finalCostPerUnit)), total: money(num(l.totalFinalCost)),
  })).filter((r) => r.item).slice(0, 60);
  const estimate = rows.length ? { rows, total: money(num(est.total) ?? rows.reduce((s, r) => s + (Number(r.total.replace(/[$,]/g, '')) || 0), 0)) } : null;

  const m = obj(report.measurementReport);
  const squares = num(m.totalSquares);
  let measurements: PdfContent['measurements'] = null;
  if (squares && squares > 0) {
    const lines = [`Total roof area: ${squares} ${plural(squares, 'square', 'squares')}${num(m.totalAdjustedSqFt) ? ` (${Math.round(num(m.totalAdjustedSqFt)!).toLocaleString('en-US')} sq ft)` : ''}.`];
    const pitch = pdfText(m.averagePitch, 20); if (pitch) lines.push(`Average pitch: ${pitch}.`);
    const waste = num(m.wastePercentage); if (waste) lines.push(`Waste allowance: ${waste}%.`);
    const edges = obj(m.edgeLengths);
    for (const [key, label] of [['ridge', 'Ridge'], ['hip', 'Hip'], ['valley', 'Valley'], ['eave', 'Eave'], ['rake', 'Rake']] as const) { const v = num(edges[key]); if (v && v > 0) lines.push(`${label}: ${Math.round(v).toLocaleString('en-US')} ft.`); }
    measurements = { lines };
  }

  const summaries = new Map(arr(analysis.photos).map(obj).map((p) => [String(p.id), pdfText(p.aiSummary, 160)] as const));
  const photos = input.photos.filter((p) => typeof p?.dataUrl === 'string' && p.dataUrl.length <= MAX_PICTURE_CHARS && PICTURE.test(p.dataUrl)).slice(0, 40).map((p) => {
    const kind = (REPORT_PHOTO_CATEGORIES as readonly string[]).includes(p.category ?? '') ? PHOTO_KIND_LABEL[p.category as ReportPhotoCategory] : '';
    const what = summaries.get(p.id) ?? '';
    return { dataUrl: p.dataUrl, caption: pdfText([kind && what ? `${kind}.` : kind, what].filter(Boolean).join(' '), 200) };
  });

  const summary = pdfText(report.executiveSummary, 4000);
  const notes = pdfText(input.inspectorNotes, 4000);
  const sections = [
    ...(summary || condition.length ? ['Summary'] : []), ...(findings.length ? ['Findings'] : []), ...(damage.length ? ['Damage found'] : []), ...(storm ? ['Storm history'] : []),
    ...(photos.length ? ['Photos'] : []), ...(estimate ? ['Estimate'] : []), ...(measurements ? ['Measurements'] : []), ...(notes ? ['Notes'] : []),
  ];
  return {
    cover: {
      company, title: 'Roof report', address: pdfText(input.address, 160), cityStateZip: pdfText(input.cityStateZip, 100), customer: pdfText(input.customerName, 100),
      inspected: input.inspectionDate ? day(new Date(input.inspectionDate), true) : '', made: day(input.generatedOn, false),
    },
    footer, condition, summary, findings, damage, storm, photos, estimate, measurements, notes, disclaimer: DISCLAIMER, sections,
  };
}
