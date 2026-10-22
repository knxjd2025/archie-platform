/**
 * Pulls everything JobTread knows about a job — photos, messages/comments,
 * documents (estimates/invoices) and daily logs — and shapes it into the
 * Reports API's inputs, so a generated report reflects the real job file
 * rather than just the address.
 *
 * Photos become `photos: [{url, caption}]` (JobTread's signed CDN links are
 * publicly fetchable, so the Reports API can download and analyze them).
 * Everything else becomes a compact `inspector_notes` briefing.
 */
import { JobTreadClient } from '../integrations/jobtread';
import { extractMeasurementsFromFiles, isMeasurementDiagram } from '../lib/reports/measurement-doc.js';

/**
 * How many of a job's photos the report may use.
 *
 * Was 8, chosen to control spend — but real jobs carry far more (measured:
 * 99, 100 and 97 images on live jobs), so a report was being written from
 * under a tenth of the evidence, and tear-off photos that only exist once
 * were simply never looked at.
 *
 * The ceiling that actually matters is the 300s function limit, not a count,
 * so the vision pass now runs against a time budget and reports what it got
 * through. REPORT_MAX_PHOTOS still caps it for cost control.
 */
export const MAX_PHOTOS = Math.min(Math.max(Number(process.env.REPORT_MAX_PHOTOS) || 120, 1), 400);
const MAX_NOTES_CHARS = 6000;

export interface JobContext {
  photos: { url: string; caption?: string }[];
  notes: string;
  counts: { photos: number; files: number; messages: number; documents: number; dailyLogs: number };
  /** Measurements read from a GAF/EagleView report on the job, when present. */
  measurementDoc?: import('../lib/reports/measurement-doc').RoofMeasurementDoc | null;
}

export const isImage = (type: string, name = ''): boolean =>
  /^image\//i.test(type || '') || /\.(jpe?g|png|heic|webp)$/i.test(name || '');

const short = (s: string, n = 220) => {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const day = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

/**
 * Gather a job's context. Every source is best-effort: a failure in one
 * (or an empty job) never blocks report generation.
 */
export async function gatherJobContext(
  jobId: string,
  opts: { maxPhotos?: number } = {},
): Promise<JobContext> {
  const jt = new JobTreadClient();
  const maxPhotos = Math.min(Math.max(opts.maxPhotos ?? MAX_PHOTOS, 0), 400);

  const [filesR, commentsR, docsR, logsR] = await Promise.allSettled([
    jt.getJobFiles(jobId, Math.max(maxPhotos * 2, 60)),
    jt.getJobComments(jobId, 15),
    jt.getJobEstimates(jobId, 10),
    jt.getJobDailyLogs(jobId, 10),
  ]);

  const files = filesR.status === 'fulfilled' ? filesR.value.files : [];
  const comments = commentsR.status === 'fulfilled' ? commentsR.value.comments : [];
  const docs = docsR.status === 'fulfilled' ? docsR.value.estimates : [];
  const logs = logsR.status === 'fulfilled' ? logsR.value.logs : [];

  // The per-elevation diagrams that ship with a measurement report are
  // drawings of a roof, not photographs of one — analysing them as damage
  // wastes the photo budget and invents findings.
  const images = files.filter((f) => f.url && isImage(f.type, f.name) && !isMeasurementDiagram(f.name));

  // A measured report beats a satellite estimate: on 550 Manning Dr the
  // Solar API said 3,699 sq ft where the GAF report measured 4,715.
  const measurementDoc = await extractMeasurementsFromFiles(files).catch(() => null);
  const photos = images.slice(0, maxPhotos).map((f) => ({
    url: f.url as string,
    caption: short(f.description || f.folder || f.name, 120),
  }));

  // Non-image attachments are named (not fetched) so the report can reference them.
  const otherFiles = files.filter((f) => !isImage(f.type, f.name));

  const lines: string[] = [];
  if (comments.length) {
    lines.push('NOTES & MESSAGES ON THIS JOB (most recent first):');
    for (const c of comments.slice(0, 12)) {
      const who = c.author || (c.isFromEmail ? 'email' : 'team');
      lines.push(`- [${day(c.createdAt)}] ${who}: ${short(c.message)}`);
    }
  }
  if (docs.length) {
    lines.push('', 'DOCUMENTS ON FILE:');
    for (const d of docs.slice(0, 10)) {
      const amt = d.price ? ` — $${Math.round(d.price).toLocaleString()}` : '';
      lines.push(`- ${d.name}${d.number ? ` #${d.number}` : ''}${amt}${d.status ? ` (${d.status})` : ''}${d.issueDate ? `, ${day(d.issueDate)}` : ''}`);
    }
  }
  if (logs.length) {
    lines.push('', 'DAILY LOGS:');
    for (const l of logs.slice(0, 8)) {
      const wx = [l.weather, l.maxTemp != null ? `${Math.round(l.maxTemp)}°` : null].filter(Boolean).join(' ');
      lines.push(`- [${day(l.date)}]${wx ? ` (${wx})` : ''} ${short(l.notes)}`);
    }
  }
  if (otherFiles.length) {
    lines.push('', 'OTHER FILES ATTACHED:');
    for (const f of otherFiles.slice(0, 15)) lines.push(`- ${f.name}${f.folder ? ` (${f.folder})` : ''}`);
  }
  if (images.length > photos.length) {
    lines.push('', `(${images.length} job photos on file; the ${photos.length} most recent are attached to this report.)`);
  }

  const notes = lines.join('\n').slice(0, MAX_NOTES_CHARS);

  return {
    photos,
    notes,
    counts: { photos: photos.length, files: files.length, messages: comments.length, documents: docs.length, dailyLogs: logs.length },
    measurementDoc,
  };
}
