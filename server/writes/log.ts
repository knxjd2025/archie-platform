import { db } from '../db';
import { writeLog, type NewWriteLog } from '../../shared/schema';

/**
 * Record a write-back action. Never throws — a logging failure must never fail
 * the underlying action the user took.
 */
export async function logWrite(entry: Omit<NewWriteLog, 'id' | 'createdAt'>): Promise<void> {
  try {
    await db.insert(writeLog).values(entry);
  } catch (e: any) {
    console.warn('[write_log] failed to record write:', e?.message || e);
  }
}
