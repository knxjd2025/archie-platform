/**
 * Archie's prices, in one place. Everything else (the Stripe subscription
 * items, the Billing page, the operator page) is worked out from here.
 *
 * Billable seats are the team members who can sign in (active and allowed to
 * sign in). People on the team who cannot sign in are free.
 *
 *   1 seat         Solo $149/month
 *   2 seats        Solo $149 + 1 extra seat at $99 = $248/month (Solo allows 1 extra seat at most)
 *   3 or more      Team $299/month includes 3 seats, + $49 for each seat beyond 3
 *
 * Moving between Solo and Team happens on its own when the seat count crosses
 * from 2 to 3 (or back). A company with nobody who can sign in is billed as 1.
 *
 * Pure: no imports from the server or the browser.
 */

export type Plan = 'solo' | 'team';

/** Which Stripe price a line uses (server/billing/config.ts maps these to price IDs). */
export type PriceKey = 'solo_base' | 'solo_extra' | 'team_base' | 'team_extra';

export const PRICE_KEYS: readonly PriceKey[] = ['solo_base', 'solo_extra', 'team_base', 'team_extra'];

export const PRICES_CENTS: Record<PriceKey, number> = {
  solo_base: 14_900,
  solo_extra: 9_900,
  team_base: 29_900,
  team_extra: 4_900,
};

/** Seats included in each plan's base price. */
export const SOLO_INCLUDED_SEATS = 1;
export const SOLO_MAX_EXTRA_SEATS = 1;
export const TEAM_INCLUDED_SEATS = 3;

export const PLAN_LABEL: Record<Plan, string> = { solo: 'Solo', team: 'Team' };

export interface LineItem {
  key: PriceKey;
  /** e.g. "Team (includes 3 people)" or "Extra person". */
  label: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
}

export interface Quote {
  plan: Plan;
  /** The seats this quote bills for (at least 1). */
  seats: number;
  /** Only lines with a quantity above 0. */
  lineItems: LineItem[];
  monthlyTotalCents: number;
}

const line = (key: PriceKey, label: string, quantity: number): LineItem =>
  ({ key, label, quantity, unitCents: PRICES_CENTS[key], totalCents: PRICES_CENTS[key] * quantity });

/** Seats as a whole number, at least 1 (0, negative or nonsense bills as 1). */
export function billableSeats(seats: number): number {
  const n = Number.isFinite(seats) ? Math.floor(seats) : 1;
  return Math.max(1, n);
}

/** The plan, its lines and the monthly total for a number of seats. */
export function quoteForSeats(rawSeats: number): Quote {
  const seats = billableSeats(rawSeats);
  const lineItems: LineItem[] = [];
  let plan: Plan;
  if (seats <= SOLO_INCLUDED_SEATS + SOLO_MAX_EXTRA_SEATS) {
    plan = 'solo';
    lineItems.push(line('solo_base', 'Solo (1 person)', 1));
    const extra = seats - SOLO_INCLUDED_SEATS;
    if (extra > 0) lineItems.push(line('solo_extra', 'Extra person', extra));
  } else {
    plan = 'team';
    lineItems.push(line('team_base', `Team (includes ${TEAM_INCLUDED_SEATS} people)`, 1));
    const extra = seats - TEAM_INCLUDED_SEATS;
    if (extra > 0) lineItems.push(line('team_extra', 'Extra person', extra));
  }
  return { plan, seats, lineItems, monthlyTotalCents: lineItems.reduce((s, l) => s + l.totalCents, 0) };
}

/** "$149" or "$1,234.50". */
export function formatDollars(cents: number): string {
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/**
 * The bill in one line, e.g.
 *   "Solo $149 = $149/month"
 *   "Solo $149 + 1 extra person x $99 = $248/month"
 *   "Team $299 (includes 3 people) + 2 extra people x $49 = $397/month"
 */
export function describeQuote(q: Quote): string {
  const parts = q.lineItems.map((l) => {
    if (l.key === 'solo_base') return `Solo ${formatDollars(l.unitCents)}`;
    if (l.key === 'team_base') return `Team ${formatDollars(l.unitCents)} (includes ${TEAM_INCLUDED_SEATS} people)`;
    return `${l.quantity} extra ${l.quantity === 1 ? 'person' : 'people'} x ${formatDollars(l.unitCents)}`;
  });
  return `${parts.join(' + ')} = ${formatDollars(q.monthlyTotalCents)}/month`;
}

/** The "How pricing works" table: a few team sizes and what each costs. */
export const PRICING_EXAMPLES: readonly number[] = [1, 2, 3, 4, 5, 10];

/**
 * Which plan and seat count a set of subscription quantities bills for. The
 * reverse of quoteForSeats, for reading back what Stripe holds. Null when the
 * quantities are not a shape quoteForSeats makes (no base, or both bases).
 */
export function seatsFromQuantities(q: Partial<Record<PriceKey, number>>): { plan: Plan; seats: number } | null {
  const n = (k: PriceKey) => Math.max(0, Math.floor(q[k] ?? 0));
  const solo = n('solo_base') > 0;
  const team = n('team_base') > 0;
  if (solo === team) return null;
  return solo
    ? { plan: 'solo', seats: SOLO_INCLUDED_SEATS + n('solo_extra') }
    : { plan: 'team', seats: TEAM_INCLUDED_SEATS + n('team_extra') };
}
