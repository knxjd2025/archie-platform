/**
 * What Archie says it can do for one Roof Lee company
 * (GET .../companies/{roofliCompanyId}/capabilities).
 *
 * Roof Lee reads this before it acts. A capability that is not listed is one
 * Archie does not have for that company, so the safe answer is always the
 * shorter list. Each capability must be worked out here from the same switch
 * the feature itself reads, never typed as a fixed answer.
 *
 *   messages.quiet   every feature of Archie's that texts or emails a customer
 *                    by itself is off for this company. Roof Lee adds no lead,
 *                    changes none and moves no job until it has heard this.
 *                    NOT REPORTED YET: the gate those features read is task A9.
 *   jobs.native      Archie can keep this company's jobs on its own board,
 *                    without JobTread. NOT REPORTED YET: task A8.
 *
 * So today the list is empty for everyone, which Roof Lee reads as "read and
 * add notes only".
 */
import type { Company } from '../../shared/schema';

export async function capabilitiesFor(_company: Company): Promise<string[]> {
  return [];
}
