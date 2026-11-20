/**
 * THE crew check (Stage D, docs/archie/02-roof-lee-link.md, "Crews and
 * install dates"). The one question every crew route asks, and the only way a
 * crew member reaches a job: is this job booked for the crew this person is on?
 *
 * It never asks ownsLead (server/access/rep-scope.ts), and nothing widens
 * ownsLead for crews: two routes that return money check only ownsLead.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { leads, productionPipeline, type CrewAssignment, type Lead } from '../../shared/schema';
import type { SessionUser } from '../access/rep-scope';
import { getCurrentCompany } from '../tenant/companies';
import { isNativeJobId, keepsOwnJobs } from '../production/native-jobs';
import { CREW_ROLE } from '../../shared/crews';
import { assignmentFor, crewOfPerson } from './store';

/** The company keeps its own jobs. Every crew and install route is 404 for any other company. */
export async function ownJobsCompany(): Promise<boolean> {
  return keepsOwnJobs(await getCurrentCompany());
}

export async function leadOf(jobKey: string): Promise<Lead | null> {
  if (!isNativeJobId(jobKey)) return null;
  const [lead] = await db.select().from(leads).where(eq(leads.externalId, jobKey));
  return lead ?? null;
}

export async function tradesOf(jobKey: string): Promise<Array<{ key: string; done: boolean }> | null> {
  const [row] = await db.select({ trades: productionPipeline.trades }).from(productionPipeline).where(eq(productionPipeline.jobExternalId, jobKey));
  return row?.trades ?? null;
}

/**
 * THE crew check. A job a crew member may open: the company keeps its own
 * jobs, the person is on the Production role and on an active crew, and the
 * job is booked for that crew. Anything else is null (answered 404), the same
 * as a job that is not there.
 */
export async function crewJobFor(user: SessionUser, jobKey: string): Promise<{ lead: Lead; assignment: CrewAssignment; crewName: string } | null> {
  if (user?.role !== CREW_ROLE || !isNativeJobId(jobKey)) return null;
  if (!(await ownJobsCompany())) return null;
  const crew = await crewOfPerson(user.email);
  if (!crew) return null;
  const assignment = await assignmentFor(jobKey);
  if (!assignment || assignment.crewId !== crew.crewId) return null;
  const lead = await leadOf(jobKey);
  if (!lead) return null;
  return { lead, assignment, crewName: crew.crewName };
}

