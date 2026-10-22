/** A sweep row this old with no finishedAt was killed, not still running. */
export const STALE_RUN_MS = 6 * 60_000;

/**
 * brain_runs rows that started but never finished — the run was killed (the
 * 300s limit) before it could write its result. Such a row has no errors, so
 * the digest's error query never saw it and a dead sweep read as a clean one.
 */
export function unfinishedRunErrors(
  runs: Array<{ id: number; startedAt: Date; finishedAt: Date | null }>,
  now: Date,
): Array<{ source: string; message: string }> {
  return runs
    .filter((r) => !r.finishedAt && now.getTime() - new Date(r.startedAt).getTime() > STALE_RUN_MS)
    .map((r) => ({
      source: 'sweep',
      message: `sweep #${r.id} started ${new Date(r.startedAt).toISOString()} and never finished — killed by the 300s limit?`,
    }));
}

export function buildDigest(
  loops: Array<{ id: number; owner: string; urgency: string; summary: string; state: string; kind: string; contact: { phone?: string; name?: string } | null }>,
  claimRows: Array<{ customerName: string; stage: string; nextAction: string; nextActionOwner: string; nextActionDue: Date }>,
  // Recent sweep errors (brain_runs.errors) — previously written every run but
  // never read anywhere, so a persistent integration failure (e.g. an expired
  // GHL_PIT_TOKEN) accumulated silently in a table nobody looked at. This is
  // the one email a human actually reads daily, so surface it here.
  recentErrors: Array<{ source: string; message: string }> = [],
): { subject: string; html: string } {
  if (loops.length === 0 && claimRows.length === 0 && recentErrors.length === 0) {
    return { subject: '✅ BRN Brain — all clear', html: '<p>No open loops. Nothing is waiting on anyone. 🎉</p>' };
  }
  const urgent = loops.filter((l) => ['emergency', 'urgent'].includes(l.urgency)).length;
  // Severity order, not alphabetical: localeCompare sorted these emergency,
  // low, normal, urgent — putting the urgent items UNDER the low ones in the
  // one email that's meant to say what needs action first.
  const URGENCY_ORDER = ['emergency', 'urgent', 'normal', 'low'];
  const subject = `🧠 BRN Brain — ${loops.length} open loop${loops.length === 1 ? '' : 's'}${urgent ? ` (${urgent} URGENT)` : ''}${recentErrors.length ? ` ⚠️ ${recentErrors.length} sweep error${recentErrors.length === 1 ? '' : 's'}` : ''}`;
  const byOwner = new Map<string, typeof loops>();
  for (const l of loops) {
    if (!byOwner.has(l.owner)) byOwner.set(l.owner, []);
    byOwner.get(l.owner)!.push(l);
  }
  let html = '';
  for (const [owner, list] of byOwner) {
    html += `<h3>${owner} (${list.length})</h3><ul>`;
    for (const l of list.sort((a, b) => URGENCY_ORDER.indexOf(a.urgency) - URGENCY_ORDER.indexOf(b.urgency))) {
      const c = l.contact ? ` — ${l.contact.name ?? ''} ${l.contact.phone ?? ''}` : '';
      html += `<li>[#${l.id}] <b>${l.urgency.toUpperCase()}</b> ${l.summary}${c} <i>(reply DONE ${l.id} to close)</i></li>`;
    }
    html += '</ul>';
  }
  if (recentErrors.length) {
    html += '<h3>⚠️ Recent sweep errors</h3><ul>';
    for (const e of recentErrors) {
      html += `<li><b>${e.source}</b>: ${e.message}</li>`;
    }
    html += '</ul>';
  }
  if (claimRows.length) {
    html += '<h3>CLAIMS BOARD</h3><ul>';
    for (const c of claimRows) {
      html += `<li>${c.customerName} — ${c.stage} — next: ${c.nextAction} (${c.nextActionOwner}, due ${new Date(c.nextActionDue).toLocaleDateString()})</li>`;
    }
    html += '</ul>';
  }
  return { subject, html };
}
