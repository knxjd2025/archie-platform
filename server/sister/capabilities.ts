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
 *                    Read from isQuiet (./quiet.ts), which asks the same
 *                    switch each of those features asks before it sends.
 *   jobs.native      Archie keeps this company's jobs on its own board,
 *                    without JobTread. Read from keepsOwnJobs, the same switch
 *                    that decides whether a lead may be given a job identity.
 *   photos.native    Archie keeps the photos of this company's own jobs in its
 *                    own private store and hands them to Roof Lee, with the
 *                    customer's agreement (GET .../jobs/{id}/photos/{photoId}).
 *                    Read from keepsOwnJobs and photoStoreConfigured, the same
 *                    switch an upload and that address read: with the store
 *                    off, neither takes or gives a photo.
 */
import type { Company } from '../../shared/schema';
import { keepsOwnJobs } from '../production/native-jobs';
import { photoStoreConfigured } from '../photos/store';
import { isQuiet } from './quiet';

export type Capability = 'messages.quiet' | 'jobs.native' | 'photos.native';

export async function capabilitiesFor(company: Company): Promise<Capability[]> {
  const can: Capability[] = [];
  if (isQuiet(company)) can.push('messages.quiet');
  if (keepsOwnJobs(company)) can.push('jobs.native');
  if (keepsOwnJobs(company) && photoStoreConfigured()) can.push('photos.native');
  return can;
}
