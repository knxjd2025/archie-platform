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
 *   jobs.native      Archie keeps this company's jobs on its own board,
 *                    without JobTread. Read from keepsOwnJobs, the same switch
 *                    that decides whether a lead may be given a job identity.
 */
import type { Company } from '../../shared/schema';
import { keepsOwnJobs } from '../production/native-jobs';

export type Capability = 'messages.quiet' | 'jobs.native';

export async function capabilitiesFor(company: Company): Promise<Capability[]> {
  const can: Capability[] = [];
  if (keepsOwnJobs(company)) can.push('jobs.native');
  return can;
}
