/**
 * Sending a document out for signature.
 *
 * One request = one document, frozen at the moment it went out, plus a row per
 * signer. Each signer gets their own link, so two people on one deed sign for
 * themselves and the record can say which of them did what, from where.
 *
 * What makes an electronic signature hold up (ESIGN / UETA) is not the picture
 * of a name — it is the record around it: that the signer meant to sign, that
 * they agreed to do it electronically, that the document they saw is the
 * document on file, and that we can say who signed, when, and from where. All
 * of that is what this module describes and what the audit page prints.
 *
 * Pure: no imports, no I/O. Shared by the server, the signing page and the app.
 */

export type SignatureSourceKind = 'report' | 'certificate' | 'letter';

/** draft → sent → signed, with two ways out: the signer declines, or we void it. */
export type SignatureStatus = 'draft' | 'sent' | 'signed' | 'declined' | 'voided';

export type SignatureKind = 'typed' | 'drawn';

export type SignerRole = 'customer' | 'company';

/**
 * 'gps' is the browser's own position — the signer allowed it. 'network' is
 * what the edge inferred from the IP, which is a city, not a doorstep. The
 * difference matters enough that it is printed on the audit page rather than
 * both being called "location".
 */
export type GeoSource = 'gps' | 'network' | 'none';

export interface SignerGeo {
  source: GeoSource;
  lat: number | null;
  lng: number | null;
  /** Radius of the browser's own confidence, in metres. GPS only. */
  accuracyM: number | null;
  /** Reverse-geocoded street address for the coordinates, when one came back. */
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  /** How far the signer was from the property the document is about. */
  distanceFromPropertyM: number | null;
  capturedAt: string;
}

export interface SignerView {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  role: SignerRole;
  signUrl: string | null;
  emailedAt: string | null;
  emailError: string | null;
  textedAt: string | null;
  textError: string | null;
  remindedAt: string | null;
  remindCount: number;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
  signedAt: string | null;
  signedName: string | null;
  signatureKind: SignatureKind | null;
  signatureImage: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  ip: string | null;
  userAgent: string | null;
  geo: SignerGeo | null;
  viewGeo: SignerGeo | null;
}

export interface SignatureRequestView {
  id: number;
  jobExternalId: string;
  sourceKind: SignatureSourceKind;
  sourceRef: string | null;
  title: string;
  docHash: string;
  message: string | null;
  propertyAddress: string | null;
  /**
   * Whether the property's own coordinates are known. When they are not — an
   * address that will not geocode, a new-build lot, a typo — a signature can
   * still record where the signer was, but it cannot be measured against the
   * roof, and the app says so rather than quietly dropping the distance.
   */
  propertyLocated: boolean;
  status: SignatureStatus;
  createdBy: string;
  sentAt: string | null;
  sentBy: string | null;
  completedAt: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  jobtreadFileId: string | null;
  createdAt: string | null;
  signers: SignerView[];
}

export const STATUS_LABEL: Record<SignatureStatus, string> = {
  draft: 'Draft',
  sent: 'Out for signature',
  signed: 'Signed',
  declined: 'Declined',
  voided: 'Voided',
};

export const STATUS_STYLE: Record<SignatureStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-sky-100 text-sky-700',
  signed: 'bg-emerald-100 text-emerald-700',
  declined: 'bg-red-100 text-red-700',
  voided: 'bg-gray-100 text-gray-500',
};

/**
 * The sentence the signer ticks. It has to carry the three things the law
 * cares about — consent to sign electronically, intent to be bound, and that
 * the mark they are making is their signature — in words a homeowner on a
 * phone will actually read.
 */
export const CONSENT_TEXT =
  'I agree to sign this document electronically. I have read it, I intend to be bound by it, '
  + 'and the signature I am entering is my signature.';

/** Printed under the consent tick, because the law also requires they be told they can have it on paper. */
export const PAPER_NOTICE =
  'You can ask us for a paper copy of this document at any time, and a copy is emailed to you the moment it is signed.';

/**
 * The request's status is a fact about its signers, not something set by hand:
 * everybody signed → signed; anybody declined → declined; anybody was written
 * to → sent. Void and draft are the two states the signers cannot produce, so
 * they are passed through.
 */
export function requestStatusFrom(
  signers: Array<Pick<SignerView, 'signedAt' | 'declinedAt' | 'emailedAt' | 'textedAt'>>,
  current: SignatureStatus,
): SignatureStatus {
  if (current === 'voided') return 'voided';
  if (!signers.length) return current === 'draft' ? 'draft' : current;
  if (signers.some((s) => s.declinedAt)) return 'declined';
  if (signers.every((s) => s.signedAt)) return 'signed';
  if (signers.some((s) => s.emailedAt || s.textedAt)) return 'sent';
  return 'draft';
}

/** Who we are still waiting on. */
export const outstandingSigners = (signers: SignerView[]): SignerView[] =>
  signers.filter((s) => !s.signedAt && !s.declinedAt);

export const isOpen = (status: SignatureStatus): boolean => status === 'draft' || status === 'sent';

// ---- Distance -------------------------------------------------------------

const EARTH_R = 6371000;                          // metres
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. Good to a metre or two at street scale. */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** Distance the way somebody would say it out loud: feet up close, miles beyond that. */
export function describeDistance(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return '';
  const feet = meters * 3.28084;
  if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`;
  const miles = meters / 1609.344;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

/**
 * "At the property" is the claim a signature is often making, so it gets its
 * own threshold rather than leaving a reader to judge 40 metres for
 * themselves. 150 m covers a long driveway and ordinary phone GPS drift.
 */
export const AT_PROPERTY_METERS = 150;

export const signedAtProperty = (geo: SignerGeo | null | undefined): boolean =>
  !!geo && geo.source === 'gps' && geo.distanceFromPropertyM != null && geo.distanceFromPropertyM <= AT_PROPERTY_METERS;

/** One line describing where a signature came from, for the audit page and the app. */
export function describeGeo(geo: SignerGeo | null | undefined): string {
  if (!geo || geo.source === 'none') return 'Location not shared';
  const place = geo.address || [geo.city, geo.region].filter(Boolean).join(', ') || null;
  if (geo.source === 'network') {
    return place ? `${place} (approximate, from network)` : 'Approximate location unavailable';
  }
  const coords = geo.lat != null && geo.lng != null ? `${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)}` : '';
  const bits = [place, coords].filter(Boolean).join(' · ');
  const acc = geo.accuracyM != null ? ` ±${Math.round(geo.accuracyM)} m` : '';
  return `${bits}${acc}`;
}

/** How the signature relates to the roof the document is about. */
export function describeProximity(geo: SignerGeo | null | undefined): string {
  if (!geo || geo.distanceFromPropertyM == null) return '';
  if (signedAtProperty(geo)) return 'At the property';
  const d = describeDistance(geo.distanceFromPropertyM);
  return d ? `${d} from the property` : '';
}

/** A device description a person can read, from a user-agent string. */
export function describeDevice(ua: string | null | undefined): string {
  const s = String(ua || '');
  if (!s) return 'Unknown device';
  const os = /iPhone/.test(s) ? 'iPhone'
    : /iPad/.test(s) ? 'iPad'
    : /Android/.test(s) ? 'Android'
    : /Mac OS X|Macintosh/.test(s) ? 'Mac'
    : /Windows/.test(s) ? 'Windows'
    : /Linux/.test(s) ? 'Linux'
    : 'Unknown device';
  const browser = /EdgA?\//.test(s) ? 'Edge'
    : /FxiOS|Firefox/.test(s) ? 'Firefox'
    : /CriOS|Chrome/.test(s) ? 'Chrome'
    : /Safari/.test(s) ? 'Safari'
    : '';
  return browser ? `${os} · ${browser}` : os;
}

// ---- Rendering ------------------------------------------------------------

export const escapeHtml = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const stamp = (iso: string | null | undefined, tz = 'America/New_York'): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })} ET`;
};

/**
 * The signature block appended to the document itself — what a homeowner
 * expects to see at the bottom of something they signed. The audit detail
 * (IP, device, coordinates) is not here; it goes on its own page, so the
 * document reads like a document.
 */
export function signatureBlockHtml(signers: SignerView[]): string {
  const cells = signers.map((s) => {
    const mark = s.signatureImage
      ? `<img src="data:image/jpeg;base64,${s.signatureImage}" alt="Signature of ${escapeHtml(s.name)}" style="max-height:54px;max-width:260px;display:block">`
      : `<span style="font:italic 22px Georgia,serif">${escapeHtml(s.signedName || '')}</span>`;
    const where = describeProximity(s.geo);
    return `<td style="vertical-align:top;padding:0 18px 0 0;min-width:240px">
      <div style="min-height:58px">${s.signedAt ? mark : '<span style="color:#999">Not yet signed</span>'}</div>
      <div style="border-top:1px solid #333;padding-top:5px;font-size:12px">
        <b>${escapeHtml(s.name)}</b>${s.role === 'company' ? ' — Best Roofing Now' : ''}<br>
        ${s.signedAt ? `Signed ${escapeHtml(stamp(s.signedAt))}` : ''}
        ${where ? `<br><span style="color:#666">${escapeHtml(where)}</span>` : ''}
      </div></td>`;
  });

  // Two to a row: wider than that and a phone has to scroll sideways.
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(`<tr>${cells.slice(i, i + 2).join('')}</tr>`);

  return `<div style="margin-top:28px;page-break-inside:avoid">
    <h3 style="font-size:14px;margin:0 0 10px">Signatures</h3>
    <table style="border-collapse:separate;border-spacing:0 16px;width:100%">${rows.join('')}</table>
  </div>`;
}
