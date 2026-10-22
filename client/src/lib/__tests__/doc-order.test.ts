import { describe, it, expect } from 'vitest';
import { groupNewestFirst, docDate } from '../doc-order';

const doc = (customer: string, signedAt: string | null, issueDate: string | null) => ({ customer, signedAt, issueDate });

describe('groupNewestFirst', () => {
  it('puts the client with the most recent approval first, not alphabetical', () => {
    const groups = groupNewestFirst(
      [
        doc('Adams', '2026-01-05T12:00:00.000Z', null),
        doc('Zimmer', '2026-10-10T12:00:00.000Z', null),
        doc('Miller', null, '2026-06-01'),
      ],
      (d) => d.customer,
    );
    expect(groups.map(([c]) => c)).toEqual(['Zimmer', 'Miller', 'Adams']);
  });

  it('sorts docs newest first inside a client, undated last', () => {
    const [[, items]] = groupNewestFirst(
      [doc('A', null, null), doc('A', '2026-02-01T00:00:00.000Z', null), doc('A', null, '2026-09-01')],
      (d) => d.customer,
    );
    expect(items.map(docDate)).toEqual(['2026-09-01', '2026-02-01', '']);
  });

  it('ranks an approved-but-unsigned doc by its issue date, not ahead of everything', () => {
    const groups = groupNewestFirst(
      [doc('Old', null, '2025-03-01'), doc('New', '2026-10-01T00:00:00.000Z', null)],
      (d) => d.customer,
    );
    expect(groups[0][0]).toBe('New');
  });
});
