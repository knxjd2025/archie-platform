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
import { MAX_REPORT_PHOTOS, REPORT_KINDS, type ReportPhotoCategory } from '../../../shared/roof-reports';

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
  wizard: {
    title: 'New roof report',
    stepOf: (step: number | string, total: number | string) => `Step ${step} of ${total}`,
    back: 'Back',
    next: 'Next',
    close: 'Close',
    saveAndClose: 'Save and close',
    comesNext: 'Review and making the report come next.',
    keptDraft: (ago: string) => `We kept your draft from ${ago}.`,
    startOver: 'Start over',
    saved: 'Saved on this device. Kept for 24 hours.',
    stepsLabel: 'Steps',
    photosBusy: 'Photos are still being added.',
    photosBusyAdvance: 'Photos are still being added. Please wait a moment.',
  },
  where: {
    title: 'Where is the roof?',
    address: 'Street address',
    city: 'City',
    state: 'State',
    chooseState: 'Choose a state',
    zip: 'ZIP code (optional)',
    zipBad: 'Please enter a 5 digit ZIP code.',
    jobHeading: 'Link to a job (optional)',
    jobHelp: 'Pick a job to keep this report with it. You can only pick jobs you can see.',
    jobSearch: 'Search your jobs',
    jobSearching: 'Looking...',
    jobNone: 'No jobs match that.',
    jobSearchFailed: 'Jobs could not be searched. Please try again.',
    jobFound: 'Jobs found',
    linkTo: (label: string | number) => `Link to ${label}`,
    linkedTo: (label: string | number) => `Linked to ${label}`,
    removeLink: 'Remove link',
  },
  photos: {
    title: 'Add photos (optional)',
    cap: `A report holds up to ${MAX_REPORT_PHOTOS} photos.`,
    capReached: `That is the most photos a report holds (${MAX_REPORT_PHOTOS}).`,
    added: (n: number, more: number) => `${n} photo${n === 1 ? '' : 's'} added. ${more} more ${more === 1 ? 'fits' : 'fit'}.`,
    privacy: 'Photos are kept private. Location data is removed.',
    dropHere: 'Drag photos here, or press to choose them.',
    zoneLabel: 'Photo drop area. Drag pictures here, or use the Choose photos button.',
    choose: 'Choose photos',
    camera: 'Take a photo',
    kindLabel: 'What the next photos show',
    notSure: 'Not sure',
    gettingReady: 'Getting ready...',
    uploading: (percent: number) => `Uploading ${percent}%`,
    done: 'Added',
    failed: 'Not saved',
    retry: 'Try again',
    remove: 'Remove',
    removeFor: (name: string | number) => `Remove photo ${name}`,
    retryFor: (name: string | number) => `Try again with photo ${name}`,
    progressFor: (name: string | number) => `Uploading ${name}`,
    notSaved: 'The photo couldn\'t be saved. Please try again.',
    unreadable: 'That picture could not be read. Try a JPEG or PNG.',
    tooSlow: 'That photo took too long to send. Please try again.',
    leftOutFull: (n: number) => `${n} photo${n === 1 ? ' was' : 's were'} left out because a report holds ${MAX_REPORT_PHOTOS}.`,
    leftOutNotPicture: (n: number) => `${n} file${n === 1 ? ' was' : 's were'} left out because ${n === 1 ? 'it is' : 'they are'} not ${n === 1 ? 'a picture' : 'pictures'}.`,
    progress: (done: number, total: number) => `${done} of ${total} photos added.`,
    failedLine: (n: number) => `${n} photo${n === 1 ? '' : 's'} did not save and will be left out.`,
  },
} as const;

/** What each kind of photo is called on screen. The keys are the ones the server accepts. */
export const PHOTO_KIND_LABEL: Record<ReportPhotoCategory, string> = {
  overview: 'Whole roof',
  roof_surface: 'Roof surface',
  flashing: 'Flashing',
  vent: 'Vents and pipes',
  chimney: 'Chimney',
  gutter: 'Gutters',
  interior: 'Inside the house',
  closeup: 'Close up',
  other: 'Something else',
};

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
