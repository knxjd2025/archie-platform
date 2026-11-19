/**
 * What the screens show for a job Archie keeps itself, and for a company that
 * keeps its own jobs (a company Roof Lee made: server/production/native-jobs.ts,
 * docs/archie/02-roof-lee-link.md "Archie's own jobs").
 *
 * Such a job has no JobTread behind it, and the company's KynexPro belongs to
 * Roof Lee, so nothing on these screens may point at either, or offer a
 * button that would need them. The server says which system keeps a job
 * (`lead.backend` on GET /api/clients/:externalId) and whether the company is
 * one Roof Lee made (`profile.madeByRoofli` on GET /api/auth/me).
 *
 * Every other job and company gets exactly what it always had.
 */
import { atLeast, isNarrowed, type TeamRole } from '../../../shared/rbac';

/** The parts of the client page's lead these choices read. */
export interface JobPageLead {
  externalId: string | null;
  source?: string | null;
  /** 'archie' for a job Archie keeps, 'jobtread' for any other. */
  backend?: string | null;
  /** Where the job sits on the Production board, for a job Archie keeps; null when it is not on it. */
  boardStage?: { key: string; label: string } | null;
}

export interface JobPageView {
  /** "Open in Current CRM": a link to the job in JobTread. */
  openInJobTread: boolean;
  /** The JobTread status picker, or (for a job Archie keeps) the Production board stage, read only. */
  stageControl: 'jobtread' | 'board';
  /** "Start production": put a job Archie keeps that is not on the Production board onto it, at Approved. */
  startProduction: boolean;
  /** An admin's corrections to the customer, job name, address and the rest. */
  accountEditor: boolean;
  /** Call, text and email go through KynexPro; for a job Archie keeps they are the phone's own. */
  contactThroughKynexPro: boolean;
  /** The quick tags, which go to KynexPro. */
  kynexProTags: boolean;
  /** Booking an appointment, which goes on a Google Calendar. */
  booking: boolean;
  /** The switch for whether the customer agreed to photos of the job being used. */
  photoConsent: boolean;
  /** Documents open the job in JobTread. */
  documentsOpenJobTread: boolean;
  noteHeading: string;
  noteSaved: string;
}

/** True for a job Archie keeps itself. */
export const isArchieJob = (lead: Pick<JobPageLead, 'backend'>): boolean => lead.backend === 'archie';

/** What the client page shows for this job. */
export function jobPageView(lead: JobPageLead): JobPageView {
  const archie = isArchieJob(lead);
  return {
    openInJobTread: !archie && !!lead.externalId,
    stageControl: archie ? 'board' : 'jobtread',
    startProduction: archie && !!lead.externalId && !lead.boardStage,
    accountEditor: archie || lead.source === 'jobtread',
    contactThroughKynexPro: !archie,
    kynexProTags: !archie,
    booking: !archie,
    photoConsent: archie,
    documentsOpenJobTread: !archie && !!lead.externalId,
    noteHeading: archie ? 'Add a note' : 'Add a note to Current CRM',
    noteSaved: archie ? 'Note saved' : 'Note added to your CRM',
  };
}

/** The one sentence under the photo switch: what saying yes allows. */
export const PHOTO_CONSENT_LABEL = 'Customer agreed to photos of this job being used';
export const PHOTO_CONSENT_HELP = 'This lets the company use this job\'s photos on its website and social posts, naming only the town, never the address.';

/** What the client page says after the photo switch is saved. */
export function photoConsentSaved(agreed: boolean): string {
  return agreed ? 'Saved: the customer agreed to photos being used.' : 'Saved: this job\'s photos will not be used.';
}

/** Asked before "Start production" puts the job on the Production board. */
export const START_PRODUCTION_CONFIRM = 'Start production for this job? It goes on the Production board at Approved.';
/** Said once it is there. */
export const PRODUCTION_STARTED = 'Production started. The job is on the Production board at Approved.';
/** Under the stage of a job Archie keeps that is not on the Production board yet. */
export const NOT_IN_PRODUCTION = 'Not in production yet';
/** Under the stage of a job Archie keeps that is on the Production board: it moves there, with the board's checks. */
export const MOVES_ON_BOARD = 'Moves on the Production board';

/** Said when photos cannot be added to a job Archie keeps yet (the server says the same: NATIVE_PHOTOS_SOON). */
export const PHOTOS_SOON = 'Adding photos to jobs is coming soon for your company.';

export interface LeadFormView {
  /** "Book an appointment now": needs a calendar a company Roof Lee made does not have in Archie yet. */
  booking: boolean;
  /** The first choice in a sales leader's salesperson picker. */
  repPlaceholder: string;
  /** The line under the form: what adding the lead does. */
  footer: string;
}

/**
 * The lead form (Leads page) for the signed-in person's company. For a company
 * Roof Lee made the lead is kept in Archie only, and who owns it follows the
 * server's rule (server/writes/routes.ts createLeadInArchie): a salesperson
 * or sales leader who adds it owns it unless they pick someone, and anyone
 * else's waits for a manager on the Assignments page.
 */
export function leadFormView(madeByRoofli: boolean, role: TeamRole | null | undefined): LeadFormView {
  if (!madeByRoofli) {
    return {
      booking: true,
      repPlaceholder: 'Sales Rep (default: you)',
      footer: 'Creates a job in your CRM (Status “New Lead”) + a KynexPro contact + a lead here, all in sync. The lead is yours: it shows under your name.',
    };
  }
  const picks = !!role && atLeast(role, 'manager');
  const owns = !!role && role !== 'production' && isNarrowed(role);
  const who = owns
    ? (picks ? 'It is yours unless you pick a salesperson.' : 'It shows under your name.')
    : (picks ? 'If you don\'t pick a salesperson, a manager gives it to one on the Assignments page.' : 'A manager gives it to a salesperson on the Assignments page.');
  return {
    booking: false,
    repPlaceholder: owns ? 'Salesperson (default: you)' : 'Salesperson (optional)',
    footer: `Saves the lead in Archie as a New Lead on the Sales board. ${who}`,
  };
}

/** The line under "added" once the lead is saved, for a company Roof Lee made. */
export const LEAD_SAVED_IN_ARCHIE = 'Saved in Archie, in New Lead on the Sales board.';
