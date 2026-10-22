/**
 * Works out which rep a job belongs to when nobody set the Sales Rep field.
 *
 * 400 of 420 leads have no rep, so "who owns this?" cannot be answered by the
 * JobTread dropdown alone. But the work itself leaves a trail: whoever has
 * tasks on the job, comments on it, or an appointment for it on their calendar
 * is the person actually running it.
 *
 * The rules encode how this team works:
 *   - a field rep (Banning, Thomas) on the job IS the rep
 *   - the owner alone on a job means it is his
 *   - the owner ALONGSIDE a field rep means the field rep owns it and the
 *     owner is sharing, not that ownership is ambiguous
 *
 * Everything here is a SUGGESTION with a stated reason and confidence. Nothing
 * auto-applies: 400 silent reassignments would be impossible to unpick, and a
 * wrong owner moves commission.
 */

/** Signals found for one job, by JobTread user name. */
export interface JobEvidence {
  /** Names with a task assigned on this job — the strongest signal. */
  taskAssignees: string[];
  /** Names that commented on the job. */
  commenters: string[];
  /** Mailboxes with a calendar appointment matched to this job. */
  calendarMailboxes: string[];
  /** The JobTread "Sales Rep" custom field, when set. */
  jtSalesRep?: string | null;
}

export interface RepIdentity {
  teamMemberId: number;
  /** JobTread "Sales Rep" / user name, e.g. "Banning Rumsey". */
  repName: string;
  email: string;
  /** True for people who actually run jobs in the field. */
  isFieldRep: boolean;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Suggestion {
  primary: { teamMemberId: number; repName: string } | null;
  secondary: Array<{ teamMemberId: number; repName: string }>;
  confidence: Confidence;
  source: 'jt_sales_rep' | 'jobtread_task' | 'jobtread_comment' | 'calendar' | 'none';
  /** Plain-English why, shown next to the suggestion for review. */
  reason: string;
}

const norm = (s: string) => s.trim().toLowerCase();

function findRep(name: string, reps: RepIdentity[]): RepIdentity | undefined {
  const n = norm(name);
  return reps.find((r) => norm(r.repName) === n || norm(r.email) === n);
}

/** Unique reps named in a list, preserving order and ignoring unknown people. */
function repsIn(names: string[], reps: RepIdentity[]): RepIdentity[] {
  const out: RepIdentity[] = [];
  for (const n of names) {
    const r = findRep(n, reps);
    // Unknown names (office staff, JobTread admins with no app login) are not
    // sales reps and must never be suggested as an owner.
    if (r && !out.some((x) => x.teamMemberId === r.teamMemberId)) out.push(r);
  }
  return out;
}

/**
 * Pick an owner from a set of people on the job.
 *
 * A field rep beats the owner: if Banning is on the job it is Banning's, and
 * James being there too means he is helping. Two field reps is a genuine tie —
 * suggest the first as primary and the other as secondary rather than guessing
 * silently, and mark it lower confidence so a human looks.
 */
function choose(found: RepIdentity[]): { primary: RepIdentity; secondary: RepIdentity[]; tie: boolean } | null {
  if (!found.length) return null;
  const field = found.filter((r) => r.isFieldRep);
  if (field.length === 1) {
    return { primary: field[0], secondary: found.filter((r) => r.teamMemberId !== field[0].teamMemberId), tie: false };
  }
  if (field.length > 1) {
    return { primary: field[0], secondary: found.filter((r) => r.teamMemberId !== field[0].teamMemberId), tie: true };
  }
  // No field rep — whoever is here (typically the owner) takes it.
  return { primary: found[0], secondary: found.slice(1), tie: false };
}

const pick = (r: RepIdentity) => ({ teamMemberId: r.teamMemberId, repName: r.repName });

/**
 * The one field rep whose diary this job is in, if there is exactly one.
 *
 * The rule at the top of this file — a field rep on the job IS the rep, the
 * owner being there too means he is helping — was only ever applied WITHIN a
 * signal. Across signals the owner won by precedence: he is assigned tasks on
 * most jobs, so `tasks` returned him with high confidence and the calendar was
 * never consulted, even when the only appointment was Banning's. Somebody
 * drove to that house, and it was not the person who ticked a task.
 */
function loneFieldRepOnCalendar(ev: JobEvidence, reps: RepIdentity[]): RepIdentity | null {
  const field = repsIn(ev.calendarMailboxes, reps).filter((r) => r.isFieldRep);
  return field.length === 1 ? field[0] : null;
}

export function inferOwner(ev: JobEvidence, reps: RepIdentity[]): Suggestion {
  const none: Suggestion = {
    primary: null, secondary: [], confidence: 'low', source: 'none',
    reason: 'No tasks, comments or calendar events identify a rep — assign by hand.',
  };

  // 1. An explicitly set Sales Rep field is a decision someone already made.
  if (ev.jtSalesRep && ev.jtSalesRep.trim()) {
    const r = findRep(ev.jtSalesRep, reps);
    if (r) {
      return {
        primary: pick(r), secondary: [], confidence: 'high', source: 'jt_sales_rep',
        reason: `JobTread Sales Rep is set to ${r.repName}.`,
      };
    }
  }

  // 2. Tasks — someone was assigned the actual work.
  const taskReps = repsIn(ev.taskAssignees, reps);
  const byTask = choose(taskReps);
  if (byTask && !byTask.primary.isFieldRep) {
    // Only the owner has tasks. If a field rep has the job in their diary,
    // that is the stronger claim.
    const onCalendar = loneFieldRepOnCalendar(ev, reps);
    if (onCalendar) {
      return {
        primary: pick(onCalendar), secondary: [pick(byTask.primary)],
        confidence: 'medium', source: 'calendar',
        reason: `An appointment for this job is on ${onCalendar.repName}'s calendar. `
          + `${byTask.primary.repName} has the tasks, which usually means he is helping.`,
      };
    }
  }
  if (byTask) {
    const shared = byTask.secondary.length ? ` Shared with ${byTask.secondary.map((s) => s.repName).join(', ')}.` : '';
    return {
      primary: pick(byTask.primary),
      secondary: byTask.secondary.map(pick),
      confidence: byTask.tie ? 'medium' : 'high',
      source: 'jobtread_task',
      reason: `${byTask.primary.repName} has tasks assigned on this job.${shared}${
        byTask.tie ? ' Two field reps have tasks — confirm who owns it.' : ''
      }`,
    };
  }

  // 3. Comments — weaker: anyone can comment on anything.
  const commentReps = repsIn(ev.commenters, reps);
  const byComment = choose(commentReps);
  if (byComment && !byComment.primary.isFieldRep) {
    // Same again, and weaker still: the owner comments on everything.
    const onCalendar = loneFieldRepOnCalendar(ev, reps);
    if (onCalendar) {
      return {
        primary: pick(onCalendar), secondary: [pick(byComment.primary)],
        confidence: 'medium', source: 'calendar',
        reason: `An appointment for this job is on ${onCalendar.repName}'s calendar. `
          + `${byComment.primary.repName} commented, which he does on most jobs.`,
      };
    }
  }
  if (byComment) {
    const soleFieldRep = byComment.primary.isFieldRep && !byComment.secondary.some((s) => s.isFieldRep);
    const shared = byComment.secondary.length ? ` Also active: ${byComment.secondary.map((s) => s.repName).join(', ')}.` : '';
    return {
      primary: pick(byComment.primary),
      secondary: byComment.secondary.map(pick),
      // A field rep commenting is a real signal; the owner commenting is not,
      // since he comments on everything.
      confidence: soleFieldRep ? 'medium' : 'low',
      source: 'jobtread_comment',
      reason: `${byComment.primary.repName} commented on this job.${shared}`,
    };
  }

  // 4. Calendar — whose calendar the appointment landed on.
  const calReps = repsIn(ev.calendarMailboxes, reps);
  const byCal = choose(calReps);
  if (byCal) {
    return {
      primary: pick(byCal.primary),
      secondary: byCal.secondary.map(pick),
      confidence: 'medium',
      source: 'calendar',
      reason: `An appointment for this job is on ${byCal.primary.repName}'s calendar.`,
    };
  }

  return none;
}
