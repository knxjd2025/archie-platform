/**
 * Build the estimate by talking to it.
 *
 * The line list is the single source of truth. This turns "add chimney
 * flashing, eight fifty" or "bump the shingles to 6 squares and drop the vent"
 * into the NEW list, which the editor then shows for the rep to check and
 * save. It never writes on its own: a price is something a rep has to defend
 * at a kitchen table, so a person confirms it.
 */
import { WRITING_MODEL, assistConfigured, client } from '../ai/assist-service';
import type { CustomLineInput } from '../lib/reports/estimate-editing';

export interface ChatEditResult {
  lines: CustomLineInput[];
  /** Plain-English summary of what changed, shown above the form. */
  summary: string;
}

const SYSTEM = `You edit a roofing repair estimate's line items.

You are given the CURRENT lines as JSON and an instruction from a sales rep.
Return the COMPLETE new list of lines after applying the instruction.

Rules:
- Output ONLY a JSON object: {"lines":[{"name":string,"quantity":number,"unit":string,"unitPrice":number}],"summary":string}
- Return EVERY line that should remain, not just the changed ones. Omitting a line deletes it.
- Keep untouched lines exactly as they were — same name, quantity, unit and unitPrice.
- unitPrice is the price per unit charged to the customer, in dollars. Never a total.
- "eight fifty" means 850. "$1.2k" means 1200. Read spoken numbers sensibly.
- Common units: sq (squares), lf (linear feet), ea (each), hr.
- NEVER invent a price the rep did not give. If they add an item with no price, use 0 and say so in the summary.
- summary is one short sentence describing what you changed.`;

/** Strip code fences and pull the first JSON object out of a model reply. */
export function parseChatEdit(raw: string): ChatEditResult | null {
  if (!raw) return null;
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(obj?.lines)) return null;
    const lines: CustomLineInput[] = obj.lines
      .map((l: any) => ({
        name: String(l?.name ?? '').trim(),
        // Only a missing quantity means one. A 0 from the model ("drop the
        // gutters to zero") used to be billed as one unit at full price.
        quantity: l?.quantity == null ? 1 : Number(l.quantity),
        unit: String(l?.unit ?? 'ea').trim() || 'ea',
        unitPrice: Number(l?.unitPrice),
      }))
      // A line with no usable name, a non-numeric price or no positive
      // quantity would be refused by the pricing layer; discarding it here
      // keeps the summary honest, and a zero quantity reads as "remove it".
      .filter((l: CustomLineInput) => l.name && Number.isFinite(l.unitPrice) && l.unitPrice >= 0
        && Number.isFinite(l.quantity) && (l.quantity as number) > 0);
    return { lines, summary: String(obj?.summary || 'Updated the estimate.').slice(0, 300) };
  } catch {
    return null;
  }
}

export function estimateChatConfigured(): boolean {
  return assistConfigured();
}

export async function editEstimateByChat(
  currentLines: CustomLineInput[],
  instruction: string,
): Promise<ChatEditResult | { error: string }> {
  if (!estimateChatConfigured()) {
    return { error: 'Conversational editing needs FAL_AI_API_KEY or OPENROUTER_API_KEY set on the server.' };
  }
  const msg = String(instruction || '').trim();
  if (!msg) return { error: 'Say what you want changed.' };

  try {
    // A rep is waiting on this with a customer in front of them; a hung
    // request is worse than a refusal.
    const res = await client().chat.completions.create({
      model: WRITING_MODEL,
      temperature: 0.1, // pricing edits are transcription, not creativity
      max_tokens: 2400,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `CURRENT LINES:\n${JSON.stringify(currentLines, null, 1)}\n\nINSTRUCTION:\n${msg}`,
        },
      ],
    }, { timeout: 60_000, maxRetries: 0 });
    const parsed = parseChatEdit(res.choices?.[0]?.message?.content || '');
    if (!parsed) return { error: "I couldn't turn that into line items — try naming the item and the price." };
    return parsed;
  } catch (e: any) {
    return { error: e?.message || 'The assistant could not be reached.' };
  }
}

// ---------------------------------------------------------------------------
// Whole-document chat: one place to ask for any change
// ---------------------------------------------------------------------------

const DOC_SYSTEM = `You edit a roof report for Best Roofing Now. A customer reads the result, so accuracy matters more than polish.

You are given the report's editable fields as JSON and an instruction from a sales rep.
Return ONLY a JSON object describing the changes to make — no markdown fence, no prose outside it:
{
  "reply": "one or two sentences telling the rep what you changed, or why you couldn't",
  "draft": {
    "title": "...",                                  // optional
    "executiveSummary": "...",                       // optional
    "inspectorNotes": "...",                         // optional
    "findings": { "<id>": { "label": "...", "description": "..." } },   // optional
    "photos": [ { "id": "photo-3", "caption": "..." } ],                // optional
    "lines":  [ { "name": "...", "quantity": 1, "unit": "sq", "unitPrice": 0 } ]  // optional, COMPLETE replacement list
  }
}

Rules:
- Include in "draft" ONLY the fields you are changing. Omit everything else.
- "lines" is a COMPLETE replacement: include every line that should remain. Omitting one deletes it.
- You may reword any text, retitle, and edit captions and finding descriptions.
- You may change prices ONLY when the rep gives the number. NEVER invent or adjust a price they did not state.
- NEVER change a severity, a measurement, a roof age, a storm date, or hail/wind figures. Those come from the photo analysis, the measurement report and NOAA. If asked, refuse that part in "reply" and explain where it has to be corrected.
- You cannot swap a photo's image — say the rep should use the photo picker for that.
- If you cannot do something, still return valid JSON with an empty draft and say why in "reply".`;

export interface DocChatResult {
  reply: string;
  draft: Record<string, any>;
}

export function parseDocChat(raw: string): DocChatResult | null {
  if (!raw) return null;
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    const draft = obj?.draft && typeof obj.draft === 'object' ? obj.draft : {};
    // A model that returns prose with no draft has refused or misunderstood —
    // surfacing its reply is more useful than a generic failure.
    return { reply: String(obj?.reply || 'Done.').slice(0, 600), draft };
  } catch {
    return null;
  }
}

/**
 * Ask for any change to the report. Returns a DRAFT for the editor to preview —
 * it never writes. The rep approves what they can see.
 */
export async function editReportByChat(
  editable: Record<string, any>,
  instruction: string,
): Promise<DocChatResult | { error: string }> {
  if (!estimateChatConfigured()) {
    return { error: 'Conversational editing needs FAL_AI_API_KEY or OPENROUTER_API_KEY set on the server.' };
  }
  const msg = String(instruction || '').trim();
  if (!msg) return { error: 'Say what you want changed.' };

  try {
    const res = await client().chat.completions.create({
      model: WRITING_MODEL,
      temperature: 0.3,
      max_tokens: 3000,
      messages: [
        { role: 'system', content: DOC_SYSTEM },
        { role: 'user', content: `REPORT FIELDS:\n${JSON.stringify(editable, null, 1).slice(0, 24000)}\n\nINSTRUCTION:\n${msg}` },
      ],
    }, { timeout: 75_000, maxRetries: 0 });
    const parsed = parseDocChat(res.choices?.[0]?.message?.content || '');
    if (!parsed) return { error: "I couldn't turn that into a change — try being more specific about which part of the report." };
    return parsed;
  } catch (e: any) {
    return { error: e?.message || 'The assistant could not be reached.' };
  }
}
