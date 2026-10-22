// Newest-first ordering for the Approved Documents page.

export interface DatedDoc {
  signedAt: string | null;
  issueDate: string | null;
}

/** The doc's most meaningful date as yyyy-mm-dd ('' when it has none). */
export function docDate(d: DatedDoc): string {
  return (d.signedAt || d.issueDate || '').slice(0, 10);
}

function newestFirst(a: DatedDoc, b: DatedDoc): number {
  const byDay = docDate(b).localeCompare(docDate(a));
  if (byDay !== 0) return byDay;
  return (b.signedAt || '').localeCompare(a.signedAt || '');
}

/**
 * Groups docs by client, newest doc first within each group, and the group
 * holding the most recent doc first overall.
 */
export function groupNewestFirst<T extends DatedDoc>(
  docs: readonly T[],
  keyOf: (d: T) => string,
): [string, T[]][] {
  const byClient = docs.reduce<Record<string, T[]>>((acc, d) => {
    const key = keyOf(d);
    return { ...acc, [key]: [...(acc[key] || []), d] };
  }, {});
  return Object.entries(byClient)
    .map(([client, items]): [string, T[]] => [client, [...items].sort(newestFirst)])
    .sort((a, b) => newestFirst(a[1][0], b[1][0]) || a[0].localeCompare(b[0]));
}
