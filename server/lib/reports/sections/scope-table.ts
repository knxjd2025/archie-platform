/**
 * The additional-scope table for a replacement quote: what was added on top
 * of the roof system itself, with what it is and why. Shared by the
 * Proposal, Presentation and Estimate so the three cannot list the scope
 * differently. Returns '' when the report carries no scope lines.
 */
import { esc } from '../report-theme.js';
import { scopeLinesOf, scopeTotalOf } from '../scope-items.js';
import { formatUnit } from '../roof-repair-pricing.js';
import type { SectionStyle } from './style.js';

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const usd2 = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const REQUIREMENT_LABEL: Record<string, string> = {
  code: 'Code requirement',
  manufacturer: 'Manufacturer requirement',
  recommended: 'Recommended',
};

function qtyLabel(l: any): string {
  const q = Number(l.quantity) || 1;
  try { return `${q} ${formatUnit(l.unit, q)}`.trim(); } catch { return String(q); }
}

export interface ScopeTableInput {
  report: any;
  /** The roof-system line's own total, printed above the scope so the sum reads. */
  roofSystemLabel?: string;
  roofSystemTotal?: number;
}

export function scopeTable(input: ScopeTableInput, style: SectionStyle): string {
  const lines = scopeLinesOf(input.report);
  if (!lines.length) return '';
  const scopeTotal = scopeTotalOf(input.report);
  const rows = lines.map((l) => `<tr>
      <td>
        <b>${esc(l.repairName)}</b>${l.scope?.requirement ? ` <span class="scope-badge scope-badge--${esc(l.scope.requirement)}">${esc(REQUIREMENT_LABEL[l.scope.requirement] ?? l.scope.requirement)}</span>` : ''}
        ${l.scope?.description ? `<div class="${esc(style.note)}">${esc(l.scope.description)}</div>` : ''}
      </td>
      <td>${esc(qtyLabel(l))}</td>
      <td>${usd2(Number(l.finalCostPerUnit) || 0)}</td>
      <td><b>${usd2(Number(l.totalFinalCost) || 0)}</b></td>
    </tr>`).join('');
  const roofRow = input.roofSystemTotal != null
    ? `<tr class="scope-roof"><td colspan="3" data-scope-roof-label>${esc(input.roofSystemLabel || 'Roof system')}</td><td><b data-scope-roof-total>${usd(input.roofSystemTotal)}</b></td></tr>`
    : '';
  const grand = input.roofSystemTotal != null ? input.roofSystemTotal + scopeTotal : scopeTotal;
  return `<div class="scope-table-wrap">
    <table class="scope-table">
      <colgroup><col><col><col class="scope-col-each"><col></colgroup>
      <thead><tr><th scope="col">Additional scope</th><th scope="col">Qty</th><th scope="col">Each</th><th scope="col">Total</th></tr></thead>
      <tbody>${roofRow}${rows}</tbody>
      <tfoot><tr><td colspan="3">${input.roofSystemTotal != null ? 'Total investment' : 'Additional scope total'}</td><td><b${input.roofSystemTotal != null ? ' data-scope-grand-total' : ''}>${usd(grand)}</b></td></tr></tfoot>
    </table>
  </div>`;
}

/** Shared CSS for the table, against the --sc-* / document variables each host already declares. */
export const SCOPE_TABLE_CSS = `
.scope-table-wrap { overflow-x: auto; margin-top: var(--sc-5, 20px); }
.scope-table { width: 100%; border-collapse: collapse; font-size: var(--sc-t-sm, 14px); text-align: left; }
.scope-table th, .scope-table td { padding: 10px 12px; border-bottom: 1px solid var(--sc-hairline, var(--line, #e5e7eb)); vertical-align: top; }
.scope-table th { font-size: var(--sc-t-xs, 12px); letter-spacing: 0.06em; text-transform: uppercase; color: var(--sc-ink-soft, var(--muted, #6b7280)); }
.scope-table td:nth-child(n+2), .scope-table th:nth-child(n+2) { white-space: nowrap; text-align: right; }
.scope-table tfoot td { border-bottom: 0; padding-top: 14px; font-weight: 600; }
.scope-roof td { color: var(--sc-ink-soft, var(--muted, #6b7280)); }
.scope-badge { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; vertical-align: middle; }
.scope-badge--code { background: #FDECEC; color: #9F1D1D; }
.scope-badge--manufacturer { background: #EEF2FF; color: #3730A3; }
.scope-badge--recommended { background: #ECFDF5; color: #065F46; }
`;
