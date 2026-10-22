/**
 * Links a calendar appointment to the client it is about.
 *
 * Google Calendar events carry no job id, so the link has to be inferred. The
 * bar for a match is deliberately high: a wrong link would put one customer's
 * record behind another customer's appointment. When nothing matches
 * confidently the appointment simply stays un-linked, which is the correct
 * outcome for the internal meetings that make up most of the calendar.
 *
 * Two signals, strongest first:
 *   1. street number + street name, from the event location
 *   2. the customer's surname in the event title, but only when the title
 *      looks customer-facing rather than an internal meeting
 */

export interface LinkableLead {
  externalId: string;
  jobName: string | null;
  firstName: string | null;
  lastName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export interface LinkableAppt {
  title: string | null;
  address: string | null;
}

/** Titles that are never about a single customer. */
const INTERNAL_TITLE =
  /\b(sales meeting|leadership|weekly|catch ?up|standup|stand-up|training|payday|reminder|drive ?time|home|office|lunch|pto|vacation|holiday|birthday|mastermind|webinar|q&a|1:1|one on one|interview|all hands)\b/i;

/**
 * "137 Poplin Pl, Lake Wylie, SC 29710" -> "137 poplin".
 * Number plus first street word is specific enough to identify a house while
 * surviving the formatting differences between JobTread and Google Calendar
 * (suite numbers, missing zip, "Dr" vs "Drive").
 */
export function addressKey(raw: string | null | undefined): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d+)\s+([A-Za-z]+)/);
  if (!m) return null;
  return `${m[1]} ${m[2].toLowerCase()}`;
}

/** Surname, from the explicit field or as a fallback from "A Kent 0523". */
export function surnameOf(lead: LinkableLead): string | null {
  const last = (lead.lastName || '').trim();
  if (last && last.toLowerCase() !== 'null') return last.toLowerCase();
  // Job names are "<initial> <Surname> <MMDD>".
  const m = String(lead.jobName || '').match(/^[A-Za-z]\s+([A-Za-z][A-Za-z'-]+)\s+\d{3,4}$/);
  return m ? m[1].toLowerCase() : null;
}

export interface Match {
  externalId: string;
  via: 'address' | 'title';
}

/**
 * Best client for this appointment, or null.
 *
 * An address that matches two different jobs is treated as NO match: a duplex
 * or a repeat customer would otherwise resolve arbitrarily, and showing the
 * wrong customer is worse than showing none.
 */
export function matchAppointment(appt: LinkableAppt, leads: LinkableLead[]): Match | null {
  const key = addressKey(appt.address);
  if (key) {
    const hits = leads.filter((l) => addressKey(l.address) === key);
    if (hits.length === 1) return { externalId: hits[0].externalId, via: 'address' };
    if (hits.length > 1) return null; // ambiguous — refuse rather than guess
  }

  const title = String(appt.title || '').trim();
  if (!title || INTERNAL_TITLE.test(title)) return null;

  const lower = title.toLowerCase();
  const hits = leads.filter((l) => {
    const sn = surnameOf(l);
    // Require >= 3 characters so short surnames don't match inside other words.
    if (!sn || sn.length < 3) return false;
    return new RegExp(`\\b${sn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower);
  });
  return hits.length === 1 ? { externalId: hits[0].externalId, via: 'title' } : null;
}
