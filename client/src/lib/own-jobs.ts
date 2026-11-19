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

/** The parts of the KynexPro status (GET /api/integrations/ghl/connection) the screens read. */
export interface KynexProStatusLike { connected: boolean; heldByRoofLee?: boolean }

/**
 * The admin's "Connect KynexPro" reminder: only while KynexPro could be
 * connected here and is not. A company Roof Lee made never connects it (Roof
 * Lee looks after it), so its admin is never asked to.
 */
export const kynexProBannerShows = (s: KynexProStatusLike): boolean => !s.connected && !s.heldByRoofLee;

/** What the KynexPro card says for such a company (the server refuses a connection in the same words: KYNEXPRO_IS_ROOF_LEES). */
export const KYNEXPRO_HELD_BY_ROOF_LEE = 'Roof Lee looks after your KynexPro, so Archie does not connect to it.';

/** The words of the account editor (components/AccountEditor.tsx). */
export interface AccountEditorWords { save: string; saved: string; footnote: string }

/**
 * For a job Archie keeps the edit is saved on the job in Archie and nowhere
 * else (server/client-account/routes.ts), and there is no CRM, estimate or
 * task list behind it, so nothing points at one. Every other job: as before.
 */
export function accountEditorWords(archie: boolean): AccountEditorWords {
  if (!archie) {
    return {
      save: 'Save to Current CRM',
      saved: 'Account saved to your CRM ✅',
      footnote: 'Projected value and the schedule come from the estimate and tasks in your CRM, so they\'re changed there. Reps, stage, phone/email and commission each have their own edit on this page.',
    };
  }
  return {
    save: 'Save',
    saved: 'Account saved ✅',
    footnote: 'Reps, phone/email and commission each have their own edit on this page. The stage moves on the Production board.',
  };
}

/** Same rule as the server's isNativeJobId (server/production/native-jobs.ts): a job key Archie made itself. */
const ARCHIE_JOB_KEY = /^archie-[0-9a-f]{32}$/;

/** True for a job key Archie made itself: such a job belongs to a company Roof Lee made. */
export const isArchieJobKey = (key: string | null | undefined): key is string => typeof key === 'string' && ARCHIE_JOB_KEY.test(key);

/**
 * The key Call, Text and Email go through KynexPro with (components/ContactActions.tsx),
 * or null for the phone's own apps. A job Archie keeps belongs to a company
 * whose KynexPro is Roof Lee's, so on every screen it gets the phone's own.
 */
export function contactRouteKey(key: string | null | undefined): string | null {
  if (!key || isArchieJobKey(key)) return null;
  return key;
}

/** Said where a company Roof Lee made would book (the server refuses in the same words: NATIVE_BOOKING_UNAVAILABLE). */
export const BOOKING_NOT_YET = 'Booking is not available for your company yet.';

/** What the Schedule's availability board offers (components/AvailabilityBoard.tsx). */
export interface AvailabilityBoardView {
  /** Clicking an open time opens the booking form. */
  booking: boolean;
  /** The line under the board's legend. */
  hint: string;
}

/**
 * A company Roof Lee made has no calendar in Archie yet, so its board books
 * nothing: an open time does not open the form, which would make a new lead
 * on every try and book none. Every other company: as before.
 */
export function availabilityBoardView(madeByRoofli: boolean): AvailabilityBoardView {
  return madeByRoofli ? { booking: false, hint: BOOKING_NOT_YET } : { booking: true, hint: 'Click an open time to book it.' };
}

/** What a job's roof reports offer (components/RoofReports.tsx). */
export interface RoofReportsView {
  /** "→ Current CRM": send a finished report to the job software as a proposal, budget and order. */
  sendToJobSoftware: boolean;
  /** The "use what is on file for this job" switch, or null when the job has nothing on file to use. */
  jobFileLabel: string | null;
  /** The line under "Generate report". */
  footnote: string;
  /** The line under the tier picker. */
  tierNote: string;
}

/**
 * A job Archie keeps has no job software behind it to read from or send to
 * (and no photos of its own yet), so the report is built and kept here, with
 * no CRM in the words. Every other job: as before.
 */
export function roofReportsView(externalId: string | null | undefined): RoofReportsView {
  if (!isArchieJobKey(externalId)) {
    return {
      sendToJobSoftware: true,
      jobFileLabel: 'Use this job\'s Current CRM file',
      footnote: 'Pulls the job’s photos, notes and documents from your CRM, analyses the photos for damage, and builds the report here. Takes 2–5 minutes — you can leave this page and come back.',
      tierNote: 'All three show on the document as a comparison; the tier you pick here is the one priced and pushed to your CRM.',
    };
  }
  return {
    sendToJobSoftware: false,
    jobFileLabel: null,
    footnote: 'Analyses the photos you add for damage and builds the report here. Takes 2 to 5 minutes, and you can leave this page and come back.',
    tierNote: 'All three show on the document as a comparison; the tier you pick here is the one priced.',
  };
}

/** What a job's commission statement offers (components/JobCommission.tsx). */
export interface CommissionView {
  /** "Save PDF to job": files the statement on the job in the job software. Preview always opens it. */
  savePdfToJob: boolean;
}

/** A job Archie keeps has nowhere to file the statement yet; Preview still opens it. */
export function commissionView(externalId: string | null | undefined): CommissionView {
  return { savePdfToJob: !isArchieJobKey(externalId) };
}

/** Words on company-wide screens that once named the CRM (canvassing, the Leads list, the Assignments page). */
export interface CompanyWords {
  canvassConvertAsk: (address: string) => string;
  canvassConverted: string;
  /** After a canvassed door's details, once it is a lead. */
  canvassIsLead: string;
  /** The Leads list with nothing in it. */
  leadsEmpty: string;
  /** How the Assignments page works out owners. */
  assignmentsHow: string;
}

/**
 * A company Roof Lee made keeps its leads in Archie (no CRM, and its
 * KynexPro is Roof Lee's), so these screens name neither. Every other
 * company: exactly as before.
 */
export function companyWords(madeByRoofli: boolean): CompanyWords {
  if (!madeByRoofli) {
    return {
      canvassConvertAsk: (address) => `Create a lead in your CRM for ${address}?`,
      canvassConverted: 'Lead created in your CRM ✅',
      canvassIsLead: ' · ✅ in Current CRM',
      leadsEmpty: '📭 No leads yet. New leads from KynexPro and your CRM show up here automatically.',
      assignmentsHow: 'We read who has tasks on each CRM job, who commented on it, and whose calendar the appointment landed on. A field rep on the job is the rep; if you\'re on it alone it\'s yours. Nothing is assigned until you accept it.',
    };
  }
  return {
    canvassConvertAsk: (address) => `Make ${address} a lead? It goes in New Lead on the Sales board.`,
    canvassConverted: 'Lead saved in New Lead on the Sales board ✅',
    canvassIsLead: ' · ✅ a lead',
    leadsEmpty: '📭 No leads yet. Leads Roof Lee adds, and the ones your team adds here, show up here.',
    assignmentsHow: 'Pick a salesperson for each job nobody owns yet. Nothing is assigned until you press Assign.',
  };
}

/** A Production board card's words (pages/production.tsx). */
export interface BoardCardWords {
  /** The job's status in the job software, under the card. */
  showOtherStatus: boolean;
  notePlaceholder: string;
}

/** A job Archie keeps has no status in other job software, and its notes are kept in Archie. */
export function boardCardWords(externalId: string | null | undefined): BoardCardWords {
  return isArchieJobKey(externalId)
    ? { showOtherStatus: false, notePlaceholder: 'Add a note…' }
    : { showOtherStatus: true, notePlaceholder: 'Add a note to Current CRM…' };
}

/** The line under the rep picker (components/JobReps.tsx). A job Archie keeps tells no CRM who its rep is. */
export function jobRepsNote(externalId: string | null | undefined): string {
  const commission = 'An existing commission record keeps its reps, adjust those in the commission box below.';
  return isArchieJobKey(externalId) ? commission : `Also updates the Sales Rep in your CRM. ${commission}`;
}
