/**
 * Group the same problem, seen in many photos, into one finding.
 *
 * Analysing 40+ photos instead of 8 surfaced far more evidence — and a wall of
 * near-identical bullets. A real report: 92 findings from 117 photos, of which
 * twelve were granule loss under four different wordings ("localized granule
 * loss", "minor granule loss on shingles", "localized granule loss on single
 * shingle"…), and five were the same chimney.
 *
 * A customer reading "92 Things We Found" and thirty variations of one problem
 * does not think "thorough". They think padding, and the findings that actually
 * matter get buried. "Curled shingle edges — seen in 8 areas" is both shorter
 * and stronger evidence than eight separate lines.
 *
 * Nothing is discarded: every occurrence is kept on the group, so the photo
 * evidence and the counts survive.
 */

/** Words that describe DEGREE, not the problem — they must not split a group. */
const QUALIFIERS = /\b(minor|slight(?:ly)?|localized|isolated|small|light|moderate|significant|severe|extensive|widespread|possible|potential|apparent|visible|noticeable|some|a few|multiple|several)\b/g;

/** Trailing phrases that name WHERE, not WHAT. */
const LOCATION_TAIL = /\b(on|at|near|around|along|across|over|in)\s+(the\s+)?(single\s+)?(shingles?|roof|slope|area|areas|surface|section|field|deck|edge|edges|ridge|valley|eave|rake|chimney base)\b.*$/;

const PLURALS: Array<[RegExp, string]> = [
  [/\bshingles\b/g, 'shingle'],
  [/\bedges\b/g, 'edge'],
  [/\bareas\b/g, 'area'],
  [/\bcracks\b/g, 'crack'],
  [/\btiles\b/g, 'tile'],
  [/\bvents\b/g, 'vent'],
];

/**
 * Reduce a finding label to what problem it is, ignoring degree, location and
 * plurality — so the four granule-loss wordings collapse to one key.
 */
export function findingKey(label: string, type?: string | null): string {
  let s = String(label || '').toLowerCase();
  s = s.replace(QUALIFIERS, ' ');
  s = s.replace(LOCATION_TAIL, ' ');
  for (const [re, to] of PLURALS) s = s.replace(re, to);
  s = s.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  // Fall back to the raw label when stripping left nothing — better an
  // ungrouped finding than one keyed to the empty string, which would merge
  // every unrelated finding into a single bucket.
  const base = s || String(label || '').toLowerCase().trim();
  return type ? `${String(type).toLowerCase()}::${base}` : base;
}

/** Words that carry no meaning for matching. */
const STOPWORDS = new Set(['and', 'or', 'the', 'a', 'an', 'of', 'with', 'to', 'is', 'are', 'in', 'on', 'at']);

const tokensOf = (key: string): Set<string> =>
  new Set(key.split('::').pop()!.split(/\s+/).filter((t) => t && !STOPWORDS.has(t)));

/**
 * Is `b` the same problem as `a`, described in fewer words?
 *
 * "cracked chimney crown" vs "cracked and deteriorated chimney crown" are one
 * problem, but keying on the remaining words alone keeps them apart. Merge
 * when the shorter label's meaningful tokens are ALL present in the longer —
 * containment, not overlap, so "missing shingle" never merges into "granule
 * loss on shingle" just because they share a word.
 */
export function isNarrowerThan(a: string, b: string): boolean {
  const [ta, tb] = [tokensOf(a), tokensOf(b)];
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (!small.size) return false;
  // A single shared word is not containment — "shingle" would swallow the roof.
  if (small.size < 2) return false;
  for (const t of small) if (!large.has(t)) return false;
  return true;
}

const SEV_RANK: Record<string, number> = { severe: 4, major: 4, high: 4, moderate: 3, medium: 3, minor: 2, low: 2, none: 1 };
const sevRank = (s?: string | null) => SEV_RANK[String(s || '').toLowerCase()] ?? 0;

export interface ConsolidatedFinding {
  id: string;
  label: string;
  type?: string | null;
  severity?: string | null;
  description?: string;
  /** How many photos showed this. */
  occurrences: number;
  /** Photo ids it was seen in, for the evidence trail. */
  photoIds: string[];
  /** Distinct locations mentioned, e.g. "north slope", "chimney base". */
  locations: string[];
}

/**
 * Only the fields this actually reads. Typing it as the full DamageDetection
 * would claim a stricter contract than the code enforces — it reads every
 * field defensively because the vision output varies.
 */
export interface FindingLike {
  id?: string;
  label?: string;
  type?: string | null;
  severity?: string | null;
  description?: string;
  location?: string;
  [k: string]: any;
}

export interface PhotoWithDamages {
  id: string;
  damages?: FindingLike[];
  [k: string]: any;
}

/**
 * Consolidate findings across photos.
 *
 * The kept label is the LONGEST of the group's variants — the most specific
 * wording a rep can defend ("cracked and deteriorated chimney crown" beats
 * "cracked chimney crown"). Severity is the worst seen, because a problem is
 * as serious as its worst instance.
 */
export function consolidateFindings(photos: PhotoWithDamages[]): ConsolidatedFinding[] {
  const groups = new Map<string, ConsolidatedFinding & { _labels: string[]; _descs: string[] }>();

  for (const p of photos ?? []) {
    for (const d of p.damages ?? []) {
      const label = String((d as any).label ?? '').trim();
      if (!label) continue;
      const key = findingKey(label, (d as any).type);
      const loc = String((d as any).location ?? '').trim();
      const existing = groups.get(key);

      if (!existing) {
        groups.set(key, {
          id: (d as any).id ?? key,
          label,
          type: (d as any).type ?? null,
          severity: (d as any).severity ?? null,
          description: (d as any).description ?? '',
          occurrences: 1,
          photoIds: [p.id],
          locations: loc ? [loc] : [],
          _labels: [label],
          _descs: [String((d as any).description ?? '')],
        });
        continue;
      }

      existing.occurrences++;
      if (!existing.photoIds.includes(p.id)) existing.photoIds.push(p.id);
      if (loc && !existing.locations.includes(loc)) existing.locations.push(loc);
      existing._labels.push(label);
      existing._descs.push(String((d as any).description ?? ''));
      // A problem is as serious as its worst instance.
      if (sevRank((d as any).severity) > sevRank(existing.severity)) existing.severity = (d as any).severity ?? existing.severity;
    }
  }

  // Second pass: fold a group into another when its label is the same problem
  // in fewer words. Done after keying so grouping stays deterministic.
  const keys = Array.from(groups.keys()).sort((a, b) => tokensOf(b).size - tokensOf(a).size);
  for (const k of keys) {
    const g = groups.get(k);
    if (!g) continue;
    for (const other of keys) {
      if (other === k) continue;
      const o = groups.get(other);
      if (!o || o === g) continue;
      // Same damage type only — a chimney crack is not a shingle crack.
      if (String(g.type ?? '') !== String(o.type ?? '')) continue;
      if (!isNarrowerThan(k, other)) continue;
      // Fold the smaller-token group into the richer one.
      const keep: typeof g = tokensOf(k).size >= tokensOf(other).size ? g : o;
      const drop: typeof g = keep === g ? o : g;
      if (keep === drop) continue;
      keep.occurrences += drop.occurrences;
      for (const pid of drop.photoIds) if (!keep.photoIds.includes(pid)) keep.photoIds.push(pid);
      for (const loc of drop.locations) if (!keep.locations.includes(loc)) keep.locations.push(loc);
      keep._labels.push(...drop._labels);
      keep._descs.push(...drop._descs);
      if (sevRank(drop.severity) > sevRank(keep.severity)) keep.severity = drop.severity;
      groups.delete(keep === g ? other : k);
      if (keep !== g) break; // this group was the one folded away
    }
  }

  return Array.from(groups.values())
    .map(({ _labels, _descs, ...g }) => ({
      ...g,
      label: _labels.reduce((a, b) => (b.length > a.length ? b : a), _labels[0]),
      description: _descs.reduce((a, b) => (b.length > a.length ? b : a), _descs[0] || ''),
    }))
    // Worst first, then most-seen — the order a rep would walk a customer through.
    .sort((a, b) => (sevRank(b.severity) - sevRank(a.severity)) || (b.occurrences - a.occurrences));
}

/**
 * Places on a ROOF, as opposed to places in a PHOTO.
 *
 * The vision model describes where in the frame it saw something — "center of
 * image", "top right corner", "third shingle row from top". That is useful for
 * annotating a photo and meaningless to a homeowner reading a summary: they
 * cannot walk outside and look at "center of image". Only real roof locations
 * belong in customer-facing text.
 */
const ROOF_PLACE = /\b(north|south|east|west|front|rear|back|left|right|upper|lower|slope|ridge|valley|eave|rake|hip|gable|dormer|chimney|vent|flashing|gutter|soffit|fascia|skylight|garage|porch|addition|elevation|facet)\b/i;
// "corner" is always frame language here — a roof has hips and valleys, not
// corners — so "Top left corner" must not qualify just because it says "left".
const IMAGE_RELATIVE = /\b(image|photo|frame|picture|foreground|background|corner)\b/i;

/** A location is a place, not a sentence about where damage tends to appear. */
const MAX_LOCATION_LEN = 48;

export function isRoofLocation(loc: string): boolean {
  const s = String(loc || '').trim();
  if (!s) return false;
  // "Surrounding chimney base" is a roof place; "center of image" is not, even
  // though both start with a position word.
  if (IMAGE_RELATIVE.test(s)) return false;
  // Anything this long is a description, not a location — "Scattered across the
  // roof surface, more noticeable in the center and lower sections" belongs in
  // the finding's text, not on the end of its title line.
  if (s.length > MAX_LOCATION_LEN) return false;
  return ROOF_PLACE.test(s);
}

/** Roof locations only, deduped and capped for a readable line. */
export function usefulLocations(f: { locations: string[] }, max = 2): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of f.locations || []) {
    if (!isRoofLocation(l)) continue;
    const key = l.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l.trim());
    if (out.length >= max) break;
  }
  return out;
}

/** "seen in 8 photos" / "" for a one-off. */
export function occurrenceLabel(f: ConsolidatedFinding): string {
  if (f.occurrences <= 1) return '';
  return `seen in ${f.occurrences} photos`;
}
