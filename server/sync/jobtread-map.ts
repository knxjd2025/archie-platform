export interface JtDocument {
  id: string; type: string; status: string;
  number?: number; name?: string; toName?: string;
  price?: number; balance?: number;
  issueDate?: string | null; dueDate?: string | null; signedAt?: string | null;
  job?: { name?: string };
}

const money = (n?: number): string | null => (n === undefined || n === null ? null : String(n));

export function mapDeal(d: JtDocument) {
  return {
    sourceId: d.id,
    customer: d.toName ?? null,
    amount: money(d.price),
    type: d.name ?? null,
    status: d.status ?? null,
    issueDate: d.issueDate ?? null,
    signedAt: d.signedAt ? new Date(d.signedAt) : null,
    jobRef: d.job?.name ?? null,
  };
}

export function mapInvoice(d: JtDocument) {
  return {
    sourceId: d.id,
    kind: d.type === 'vendorBill' ? ('ap' as const) : ('ar' as const),
    party: d.toName ?? null,
    amount: money(d.price),
    balance: money(d.balance),
    dueDate: d.dueDate ?? null,
    issueDate: d.issueDate ?? null,
    status: d.status ?? null,
    jobRef: d.job?.name ?? null,
  };
}
