/**
 * Every sentence a person reads in the roof report screens, in one place, so
 * the words test can walk all of them. Plain English, no long dashes, no codes,
 * no names from inside the app.
 *
 * `plainMessage` is how a failed request becomes something to show: the server
 * writes a plain sentence for every refusal (api.ts hands it over as the
 * error's message), and that sentence passes. Anything that looks like a status
 * code, data, a timeout notice or an internal name is replaced by the sentence
 * written for that action.
 */
import { REPORT_KINDS } from '../../../shared/roof-reports';

export const RR = {
  page: {
    title: 'Roof reports',
    subtitle: 'Inspections, measurements and storm history for a roof.',
    make: 'Make a roof report',
  },
  list: {
    searchLabel: 'Search reports',
    searchPlaceholder: 'Search by address, customer or title',
    statusLabel: 'Status',
    kindLabel: 'Kind',
    searching: 'Looking...',
    emptyTitle: 'No roof reports yet.',
    emptyHint: 'Make one from an address, with or without photos.',
    noMatch: 'No reports match that search.',
    loadFailed: 'The reports could not be loaded. Please try again.',
    retry: 'Try again',
    open: 'Open',
    archive: 'Archive',
    confirmArchive: 'Archive this report? It leaves this list and can\'t be opened again here.',
    yesArchive: 'Yes, archive',
    keepIt: 'Keep it',
    archiving: 'Archiving...',
    archived: 'Report archived.',
    archiveFailed: 'The report could not be archived. Please try again.',
    noCustomer: 'No customer named',
    beingMade: 'Still being made. This takes a minute or two.',
    couldNotFinish: 'The report could not be finished.',
    previous: 'Previous page',
    next: 'Next page',
    openFor: (address: string | number) => `Open the report for ${address}`,
    archiveFor: (address: string | number) => `Archive the report for ${address}`,
  },
} as const;

const STATUS_LABEL: Record<string, string> = {
  generating: 'Being made',
  ready: 'Ready',
  failed: 'Could not finish',
  archived: 'Archived',
};

/** A report's status in plain words. */
export const statusLabel = (status: string): string => STATUS_LABEL[status] ?? 'Not ready';

/** The kinds a report holds, in the order the filter lists them, as plain words. */
export function kindsLabel(kinds: readonly string[]): string {
  return REPORT_KINDS.filter((k) => kinds.includes(k.value)).map((k) => k.label).join(', ');
}

/** Things that mean the text is not for a person: a code, data, a network notice or an internal name. */
const NOT_PLAIN = [
  /\bHTTP\b/i, /\b[1-5]\d\d\b/, /[{}<>[\]]/, /\u2014/, /_/, /\\/, /timed out|time out|timeout/i,
  /fetch|network|offline|abort|ECONN|ENOTFOUND|socket/i, /\b\w*Error\b|Exception|undefined|null|NaN|stack|constraint|violates|syntax/i,
];

/**
 * The sentence to show for a failed action: the server's own when it is a plain
 * one, else `fallback`. Never a status code, JSON, a timeout notice or a name.
 */
export function plainMessage(error: unknown, fallback: string): string {
  const raw = error && typeof error === 'object' && 'message' in error ? (error as { message: unknown }).message : null;
  if (typeof raw !== 'string') return fallback;
  const text = raw.trim();
  if (text.length < 8 || text.length > 220) return fallback;
  if (!/^[A-Z]/.test(text) || !/[.!?]$/.test(text)) return fallback;
  return NOT_PLAIN.some((re) => re.test(text)) ? fallback : text;
}
