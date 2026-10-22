import { db } from '../db';
import { watchCursors } from '../../shared/schema';
import { and, desc, eq } from 'drizzle-orm';

/**
 * A saved position in watch_cursors, keyed by (source, channel).
 *
 * The table has no unique index on the key, and setCursor checks then inserts,
 * so two sweeps racing on a new key can both insert. Without an order the read
 * took whichever row Postgres returned first, which could be the older mark, and
 * an SMS control command already applied would be applied again. The newest row
 * is the last write, so it wins.
 */
export async function getCursor(source: string, channel: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(watchCursors)
    .where(and(eq(watchCursors.source, source), eq(watchCursors.channel, channel)))
    .orderBy(desc(watchCursors.id))
    .limit(1);
  return row?.cursor ?? null;
}

export async function setCursor(source: string, channel: string, cursor: string): Promise<void> {
  const existing = await getCursor(source, channel);
  if (existing === null) {
    await db.insert(watchCursors).values({ source, channel, cursor });
  } else {
    await db
      .update(watchCursors)
      .set({ cursor, updatedAt: new Date() })
      .where(and(eq(watchCursors.source, source), eq(watchCursors.channel, channel)));
  }
}
