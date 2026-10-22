/**
 * Turn a generated roof report's estimate into real JobTread records:
 *   • a customer proposal   (document type customerOrder, signature-ready)
 *   • the job budget         (cost items on the job)
 *   • a material/work order  (document type vendorOrder, at cost)
 *
 * Everything is created as a DRAFT. Nothing reaches a customer or vendor until
 * someone explicitly activates signing or sends it.
 */
import { JobTreadClient, JT_DOC_TEMPLATES, type JobTreadDocLine } from '../integrations/jobtread';
import { currentProfile } from '../tenant/context';

/** A line as the Reports API returns it (lib/roof-repair-pricing RepairEstimate). */
interface ReportLine {
  repairName?: string;
  name?: string;
  quantity?: number;
  unit?: string;
  finalCostPerUnit?: number;   // customer price per unit
  baseCostPerUnit?: number;    // our cost per unit
  totalFinalCost?: number;
  totalBaseCost?: number;
}

/**
 * Pull priced line items out of a report payload. Falls back to a single
 * summary line when the report only carries a total, so a proposal can still
 * be produced. Returns [] when there's nothing priced to work with.
 */
export function linesFromReport(report: any): JobTreadDocLine[] {
  const est = report?.repair_estimate ?? report?.repairEstimate ?? null;
  const raw: ReportLine[] = Array.isArray(est?.lineItems) ? est.lineItems : [];

  const lines = raw
    .map((l) => {
      const name = (l.repairName || l.name || '').toString().trim();
      const quantity = Number(l.quantity) || 1;
      const unitPrice = Number(
        l.finalCostPerUnit ?? (l.totalFinalCost != null ? Number(l.totalFinalCost) / quantity : NaN),
      );
      const unitCost = Number(
        l.baseCostPerUnit ?? (l.totalBaseCost != null ? Number(l.totalBaseCost) / quantity : NaN),
      );
      if (!name || !Number.isFinite(unitPrice) || unitPrice <= 0) return null;
      return {
        name,
        ...(l.unit ? { description: `Per ${l.unit}` } : {}),
        quantity,
        unitPrice: Math.round(unitPrice * 100) / 100,
        ...(Number.isFinite(unitCost) && unitCost > 0 ? { unitCost: Math.round(unitCost * 100) / 100 } : {}),
      } as JobTreadDocLine;
    })
    .filter(Boolean) as JobTreadDocLine[];

  if (lines.length) return lines;

  // No itemised estimate — fall back to the report's total as one line.
  const total = Number(report?.total_estimate ?? est?.subtotalFinal ?? 0);
  if (total > 0) {
    return [{ name: 'Roofing work per inspection report', quantity: 1, unitPrice: Math.round(total * 100) / 100 }];
  }
  return [];
}

/** Material/work order lines: same scope, priced at our cost. */
export function costLines(lines: JobTreadDocLine[]): JobTreadDocLine[] {
  return lines
    .filter((l) => l.unitCost != null && l.unitCost > 0)
    .map((l) => ({ name: l.name, description: l.description, quantity: l.quantity, unitPrice: l.unitCost as number }));
}

export interface PushResult {
  proposal?: { ok: boolean; documentId?: string; error?: string };
  budget?: { ok: boolean; created: number; error?: string };
  materialOrder?: { ok: boolean; documentId?: string; error?: string };
  lineCount: number;
}

export async function pushReportToJobTread(params: {
  jobId: string;
  report: any;
  customerName: string;
  customerEmail?: string | null;
  address?: string | null;
  companyName?: string;
  want: { proposal: boolean; budget: boolean; materialOrder: boolean };
  /** Insurance claim vs retail sale — picks the JobTread document template. */
  insurance?: boolean;
  attachFileIds?: string[];
  taxRate?: number;
}): Promise<PushResult> {
  const jt = new JobTreadClient();
  const lines = linesFromReport(params.report);
  const out: PushResult = { lineCount: lines.length };
  if (!lines.length) return out;

  const company = params.companyName || currentProfile().legalName;
  // JobTread rejects a free-text document name — it must be one of its
  // templates, and the template is what tells the office whether this is a
  // claim or a retail sale.
  const proposalName = params.insurance ? JT_DOC_TEMPLATES.insuranceProposal : JT_DOC_TEMPLATES.retailProposal;

  if (params.want.proposal) {
    out.proposal = await jt.createJobDocument({
      jobId: params.jobId,
      type: 'customerOrder',
      name: proposalName,
      fromName: company,
      toName: params.customerName,
      toEmailAddress: params.customerEmail || undefined,
      toAddress: params.address || undefined,
      lines,
      taxRate: params.taxRate,
      requireSignature: true,
      signatureDisclaimer: 'By signing, you accept the scope and pricing in this proposal.',
      description: params.report?.executive_summary ? String(params.report.executive_summary).slice(0, 32768) : undefined,
      attachFileIds: params.attachFileIds,
    });
  }

  if (params.want.budget) {
    out.budget = await jt.addJobBudgetItems(params.jobId, lines);
  }

  if (params.want.materialOrder) {
    const cl = costLines(lines);
    out.materialOrder = cl.length
      ? await jt.createJobDocument({
          jobId: params.jobId,
          type: 'vendorOrder',
          name: JT_DOC_TEMPLATES.workOrder,
          fromName: company,
          toName: 'Vendor (to assign)',
          lines: cl,
        })
      : { ok: false, error: 'No cost figures on the estimate to build an order from.' };
  }

  return out;
}
