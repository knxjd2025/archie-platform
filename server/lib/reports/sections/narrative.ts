/**
 * Render narrative text (the synthesizer's "## Header" / "- bullet" /
 * paragraph convention) as an HTML fragment in the host document's classes.
 * Shared by the Proposal and Presentation so both show the same text the
 * same way. Returns '' for empty text.
 */
import { esc } from '../report-theme.js';
import type { SectionStyle } from './style.js';

export function narrativeHtml(text: string | null | undefined, style: SectionStyle): string {
  const clean = String(text ?? '').trim().replace(/\*\*/g, '');
  if (!clean) return '';
  const out: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const raw of clean.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    const header = line.match(/^#{1,6}\s+(.*)$/);
    if (header) { closeList(); out.push(`<h3 class="nar-h">${esc(header[1].replace(/[:]\s*$/, ''))}</h3>`); continue; }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      if (!inList) { out.push(`<ul class="nar-list ${esc(style.body)}">`); inList = true; }
      out.push(`<li>${esc(bullet[1])}</li>`);
      continue;
    }
    closeList();
    const label = line.match(/^([A-Z][A-Za-z &/]{2,40}):\s*$/);
    if (label) { out.push(`<h3 class="nar-h">${esc(label[1])}</h3>`); continue; }
    const inline = line.match(/^([A-Z][A-Za-z &/]{2,40}):\s+(.*)$/);
    out.push(inline
      ? `<p class="${esc(style.body)}"><b>${esc(inline[1])}:</b> ${esc(inline[2])}</p>`
      : `<p class="${esc(style.body)}">${esc(line)}</p>`);
  }
  closeList();
  return `<div class="narrative">${out.join('\n')}</div>`;
}

export const NARRATIVE_CSS = `
.narrative .nar-h { font-family: var(--sc-font-display, inherit); font-size: var(--sc-t-lg, 18px); margin: var(--sc-5, 20px) 0 var(--sc-2, 8px); }
.narrative .nar-list { margin: var(--sc-2, 8px) 0 var(--sc-4, 16px); padding-left: 1.2em; line-height: 1.7; }
.narrative .nar-list li { margin: 4px 0; }
.narrative p + p { margin-top: var(--sc-3, 12px); }
`;
