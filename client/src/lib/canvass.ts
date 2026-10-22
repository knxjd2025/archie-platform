/** Shapes and display tables for the canvassing screen. */

export interface Measurements {
  measuredSquares: number;
  billableSquares: number;
  roofAreaSqFt: number;
  averagePitch: string;
  segments: number;
  imageryDate: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface Weather {
  current: { description: string; temperatureF: number | null; windMph: number | null; windGustMph: number | null; precipProbabilityPct: number | null } | null;
  windyDays: number;
}

export interface Storm {
  fetchedAt?: string;
  dataQuality?: string;
  sources?: string[];
  searchRadiusMiles?: number;
  events?: import('../../../shared/canvass-intelligence').StormEvidence[];
  totalEvents: number; hailEvents: number; windEvents: number;
  maxHailSize: number | null; maxWindMph: number | null; lastEventDate: string | null; riskLevel: string | null;
  /** Stored beside the storm history on the house; current conditions at the time of the pull. */
  weather?: Weather | null;
}

export interface Property {
  id: number;
  address: string;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  notes: string | null;
  ownerName: string | null;
  phone: string | null;
  email: string | null;
  stormSummary: Storm | null;
  measurements: Measurements | null;
  leadExternalId: string | null;
  knockedBy: string | null;
  updatedAt: string | null;
  /** The rep this house belongs to (lower-cased email) and their name. */
  ownerEmail: string | null;
  ownerRepName: string | null;
  labels: string[];
  followUpAt: string | null;
}

export interface Rep { name: string; email: string }

export interface HousePatch {
  status?: string;
  notes?: string;
  labels?: string[];
  followUpAt?: string | null;
  ownerEmail?: string;
}

export const STATUS_META: Record<string, { label: string; chip: string; dot: string }> = {
  not_knocked:    { label: 'Not knocked',   chip: 'bg-gray-100 text-gray-600',       dot: 'bg-gray-400' },
  no_answer:      { label: 'No answer',     chip: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-400' },
  interested:     { label: 'Interested',    chip: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-500' },
  appointment:    { label: 'Appointment',   chip: 'bg-indigo-100 text-indigo-700',   dot: 'bg-indigo-500' },
  not_interested: { label: 'Not interested',chip: 'bg-gray-100 text-gray-500',       dot: 'bg-gray-300' },
  inspected:      { label: 'Inspected',     chip: 'bg-purple-100 text-purple-700',   dot: 'bg-purple-500' },
  sold:           { label: 'Sold',          chip: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
};
export const STATUS_ORDER = ['not_knocked', 'no_answer', 'interested', 'appointment', 'inspected', 'sold', 'not_interested'];
export const DOT_COLOR: Record<string, string> = {
  not_knocked: '#9ca3af', no_answer: '#f59e0b', interested: '#3b82f6',
  appointment: '#6366f1', not_interested: '#d1d5db', inspected: '#a855f7', sold: '#10b981',
};

export const LABEL_TONE: Record<'damage' | 'info' | 'warn', string> = {
  damage: 'bg-orange-50 border-orange-200 text-orange-800',
  info: 'bg-sky-50 border-sky-200 text-sky-800',
  warn: 'bg-red-50 border-red-200 text-red-700',
};

/** YYYY-MM-DD for a date input, in the rep's own time zone. */
export function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

/** Is a follow-up due today or overdue? */
export function isFollowUpDue(iso: string | null, now = new Date()): boolean {
  const day = toDateInput(iso);
  return !!day && day <= toDateInput(now.toISOString());
}
