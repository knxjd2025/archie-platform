/**
 * Conversational report refinement.
 *
 * A rep reads a generated report and wants a change — "shorten the summary",
 * "the second photo is the north slope, not the south", "say the flashing is
 * urgent". This applies those edits.
 *
 * The hard rule: the AI may rewrite PROSE ONLY. It never touches severities,
 * measurements, storm events, damage counts or a single dollar figure. Those come
 * from photo analysis, NOAA and the pricing table, and a customer-facing document
 * that quietly rewrites its own numbers on request is a liability, not a feature.
 * Edits are applied to the stored data model and the HTML is re-rendered from it,
 * so the document and its data can never drift apart.
 */

/** The only fields a refinement is allowed to change. */
export interface ReportPatch {
  title?: string;
  executiveSummary?: string;
  aiSummary?: string;
  inspectorNotes?: string;
  /** Prose edits to individual findings, keyed by the damage id. */
  findings?: Record<string, { label?: string; description?: string }>;
  /** Prose edits to photo captions, keyed by the photo id. */
  photoCaptions?: Record<string, string>;
}

export interface RefineResult {
  data: any;
  patch: ReportPatch;
  /** Human-readable list of what actually changed, for the chat transcript. */
  changes: string[];
}

const MAX_LEN = { title: 160, executiveSummary: 4000, aiSummary: 4000, inspectorNotes: 6000, label: 160, description: 1200, caption: 300 };

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/**
 * A compact, numbered view of everything the model is allowed to edit. Sending
 * the whole report invites the model to "helpfully" restate figures; it can only
 * rewrite what it can see.
 */
// 12 was set when a report analysed 8 photos. It now analyses up to 40, so a
// rep asking to fix wording on photo 30 was told it did not exist.
export const SURFACE_LIMITS = { photos: 40, findingsPerPhoto: 6, text: 400 };

/** The summary paragraph the report actually renders. */
export const summaryText = (data: any): string =>
  data?.damageAnalysis?.aiSummary || data?.executiveSummary || '';

export function buildEditableSurface(data: any): string {
  const lines: string[] = [];
  const cut = (v: unknown): string => String(v ?? '').slice(0, SURFACE_LIMITS.text);
  if (data?.title) lines.push(`title: ${data.title}`);
  // The paragraph the report prints under its "Executive Summary" heading lives
  // at damageAnalysis.aiSummary. Exposing it as "aiSummary" meant a rep asking
  // to "shorten the executive summary" was told no such field exists.
  const summary = summaryText(data);
  if (summary) lines.push(`executiveSummary: ${summary}`);
  if (data?.inspectorNotes) lines.push(`inspectorNotes: ${data.inspectorNotes}`);

  const allPhotos: any[] = data?.damageAnalysis?.photos ?? [];
  const photos = allPhotos.slice(0, SURFACE_LIMITS.photos);
  photos.forEach((p, i) => {
    if (p?.caption) lines.push(`photo[${p.id ?? i}].caption: ${cut(p.caption)}`);
    for (const d of (p?.damages ?? []).slice(0, SURFACE_LIMITS.findingsPerPhoto)) {
      if (!d?.id) continue;
      // Severity and type are shown as read-only context so the model can write
      // accurate prose about a finding without being able to change the finding.
      lines.push(`finding[${d.id}]: label="${cut(d.label)}" severity=${d.severity ?? '?'} (read-only) description="${cut(d.description)}"`);
    }
  });
  // Say so rather than silently editing a subset of the report.
  if (allPhotos.length > photos.length) {
    lines.push(`(${allPhotos.length - photos.length} further photo(s) not shown and not editable in this turn)`);
  }
  return lines.join('\n') || '(nothing editable on this report)';
}

export const REFINE_SYSTEM = `You edit roof inspection reports for Best Roofing Now. A customer will read the result, so accuracy matters more than polish.

You may ONLY rewrite wording. You must NEVER change or introduce:
- severities, damage counts, or whether damage exists
- measurements, square footage, pitch, or roof age
- storm events, dates, or hail/wind figures
- any dollar amount

If the user asks you to change one of those, refuse that part and say why — the numbers come from the photo analysis, NOAA storm data and the pricing table, and must be corrected at the source.

Reply with ONLY a JSON object, no markdown fence:
{
  "reply": "one or two sentences to the rep describing what you changed, or why you couldn't",
  "patch": {
    "title": "...",                         // optional
    "executiveSummary": "...",              // optional — the report's summary paragraph
    "inspectorNotes": "...",                // optional
    "findings": { "<finding id>": { "label": "...", "description": "..." } },
    "photoCaptions": { "<photo id>": "..." }
  }
}

Include ONLY the keys you are actually changing. An empty "patch" ({}) is correct when nothing should change. Keep the company's voice: plain, warm, professional — never alarmist, never salesy.`;

/**
 * Pull the patch out of a model reply. Models wrap JSON in prose or fences often
 * enough that a bare JSON.parse loses real edits.
 */
export function parseRefineResponse(raw: string): { reply: string; patch: ReportPatch } {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  let body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start !== -1 && end > start) body = body.slice(start, end + 1);

  try {
    const parsed = JSON.parse(body);
    return {
      reply: clean(parsed?.reply, 800) || 'Updated the report.',
      patch: (parsed?.patch && typeof parsed.patch === 'object') ? parsed.patch as ReportPatch : {},
    };
  } catch {
    // No usable JSON: treat the whole thing as a message and change nothing.
    // Silently applying a half-parsed patch to a customer document is worse.
    return { reply: clean(raw, 800) || 'I could not apply that change.', patch: {} };
  }
}

/**
 * Apply a patch to the report data. Returns a new object — the caller decides
 * whether to persist — plus a description of every change for the transcript.
 */
export function applyReportPatch(data: any, patch: ReportPatch): RefineResult {
  const next = structuredClone(data ?? {});
  const changes: string[] = [];

  const top = clean(patch.title, MAX_LEN.title);
  if (top && top !== next.title) { next.title = top; changes.push('title'); }

  const notes = clean(patch.inspectorNotes, MAX_LEN.inspectorNotes);
  if (notes && notes !== next.inspectorNotes) { next.inspectorNotes = notes; changes.push('inspector notes'); }

  // executiveSummary and aiSummary are the same paragraph on the page. Writing a
  // top-level executiveSummary field changed nothing visible while still
  // reporting "updated executive summary", so both land on the rendered one.
  const exec = clean(patch.executiveSummary, MAX_LEN.executiveSummary) || clean(patch.aiSummary, MAX_LEN.aiSummary);
  if (exec && exec !== summaryText(next)) {
    if (next.damageAnalysis) next.damageAnalysis.aiSummary = exec;
    else next.executiveSummary = exec;
    changes.push('executive summary');
  }

  const photos: any[] = next?.damageAnalysis?.photos ?? [];

  for (const [id, caption] of Object.entries(patch.photoCaptions ?? {})) {
    const text = clean(caption, MAX_LEN.caption);
    const photo = photos.find((p) => String(p?.id) === String(id));
    if (text && photo && photo.caption !== text) { photo.caption = text; changes.push(`caption for ${id}`); }
  }

  for (const [id, edit] of Object.entries(patch.findings ?? {})) {
    for (const photo of photos) {
      const finding = (photo?.damages ?? []).find((d: any) => String(d?.id) === String(id));
      if (!finding) continue;
      const label = clean(edit?.label, MAX_LEN.label);
      const description = clean(edit?.description, MAX_LEN.description);
      if (label && label !== finding.label) { finding.label = label; changes.push(`label for ${id}`); }
      if (description && description !== finding.description) { finding.description = description; changes.push(`description for ${id}`); }
    }
  }

  return { data: next, patch, changes };
}

/** One turn of the refinement conversation, stored on the report itself. */
export interface RefineTurn {
  role: 'user' | 'assistant';
  text: string;
  at: string;
  by?: string;
  changes?: string[];
}

/** Keep the transcript bounded — old turns add cost without adding context. */
export const MAX_TURNS = 40;

export function appendTurns(data: any, turns: RefineTurn[]): any {
  const existing: RefineTurn[] = Array.isArray(data?.refinementChat) ? data.refinementChat : [];
  return { ...data, refinementChat: [...existing, ...turns].slice(-MAX_TURNS) };
}

/** Recent transcript as plain text, so the model can follow "no, the other one". */
export function transcriptForPrompt(data: any, turnsBack = 8): string {
  const chat: RefineTurn[] = Array.isArray(data?.refinementChat) ? data.refinementChat : [];
  return chat.slice(-turnsBack).map((t) => `${t.role === 'user' ? 'Rep' : 'You'}: ${t.text}`).join('\n');
}
