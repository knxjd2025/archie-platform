/**
 * What the team advisor (Archie) knows without looking anything up: a checked
 * reference on North Carolina roofing code, permits and licensing and how NC
 * homeowner claims work, plus a brief on the company built from its profile.
 *
 * The NC reference is reference knowledge about one state, not a statement
 * about where the company works. The advisor presents it as "your state's
 * rules" only to a company whose profile says NC (referenceIsHomeState), and
 * labels it as North Carolina reference for everyone else.
 *
 * Every entry says how sure we are. "verified" means it was checked against
 * the primary source (ncleg.gov statute text, the State Fire Marshal's code
 * page) on 2026-09-28; "general" is settled trade practice or the model code
 * text the NC edition is built on; "check locally" means the answer depends on
 * the county or on a document we can't see. The advisor is told to carry that
 * confidence into its answer rather than flatten everything into certainty —
 * a rep who quotes a wrong code section to an inspector loses the job.
 *
 * Kept in code rather than the knowledge_documents table on purpose: it has to
 * be present on every deploy without a seed step, and it changes with the law,
 * which is a code review, not a data edit.
 */

import type { CompanyProfile } from '../../shared/company';

export type Confidence = 'verified' | 'general' | 'check locally';

export interface ReferenceTopic {
  id: string;
  title: string;
  /** Words a question is likely to contain — used to find the topic from free text. */
  keywords: readonly string[];
  body: string;
  sources: readonly string[];
}

export const REFERENCE_CHECKED_ON = '2026-09-28';

export const NC_REFERENCE: readonly ReferenceTopic[] = [
  {
    id: 'code_edition',
    title: 'Which NC building code is in force',
    keywords: ['code', 'edition', '2018', '2024', 'irc', 'residential code', 'building code', 'current'],
    body: `- [verified] The 2018 North Carolina Residential Code (built on the 2015 IRC with NC amendments) has been in effect since Jan 1, 2019 and is still the enforced edition per the NC Office of State Fire Marshal.
- [verified] A 2024 NC code edition was adopted, but its start was pushed back by the General Assembly (S.L. 2025-2): it takes effect 12 months after the State Fire Marshal certifies it has been published and the Residential Code Council is fully constituted. Until then, 2018 governs.
- [check locally] If a question depends on the edition, say "under the 2018 NC Residential Code" and suggest confirming with the county inspector on the permit date — the switch will come with a transition window.
- NC code is enforced by county/city inspections departments. The inspector (the "AHJ") has the final word on interpretation.`,
    sources: ['https://www.ncosfm.gov/codes/codes-current-and-past', 'https://www.ncosfm.gov/news/press-releases/2025/04/07/north-carolina-delays-implementation-2024-state-building-code'],
  },
  {
    id: 'shingle_install',
    title: 'Asphalt shingle requirements (NC Residential Code Ch. 9, R905.2)',
    keywords: ['shingle', 'asphalt', 'slope', 'pitch', 'nails', 'fastener', 'underlayment', 'felt', 'synthetic', 'drip edge', 'ice', 'water shield', 'valley', 'step flashing', 'kickout', 'flashing', 'low slope'],
    body: `Section numbers are the IRC 2015 numbering the 2018 NC code follows; NC amended some of Chapter 9, so quote the rule and invite the inspector to confirm the exact section.
- [general] Minimum slope for asphalt shingles is 2:12. From 2:12 up to (not including) 4:12 the code requires two layers of underlayment (double coverage); 4:12 and steeper needs one layer.
- [general] Shingles go over solid sheathing. Fasteners: corrosion-resistant roofing nails, minimum 12-gauge shank and 3/8" head, long enough to penetrate 3/4" into the deck or through it. Code minimum is 4 nails per strip shingle unless the manufacturer requires more — follow the manufacturer's high-wind pattern (often 6) when the wrapper calls for it; the warranty depends on it.
- [general] Drip edge is required at eaves and rake edges (R905.2.8.5): overlapping pieces at least 2", extending at least 1/4" below the sheathing, underlayment over the drip edge at rakes and under it at eaves.
- [check locally] Ice barrier (R905.1.2) is code-required only where there is a history of ice forming at the eaves; most of the NC Piedmont and coastal plain is not treated that way, and mountain counties are. Many contractors still put ice-and-water at eaves and valleys as their own spec — that is a company choice, not a code demand.
- [general] Valleys: open valleys need metal valley lining; closed/woven valleys need valley underlayment per R905.2.8.2. Step flashing is required where a roof meets a sidewall (R905.2.8.3), and a kickout (diverter) flashing is required where the roof edge ends against a wall (R903.2.1).
- [general] Always install to the manufacturer's instructions — code incorporates them, and they are what the manufacturer warranty is judged against.`,
    sources: ['https://codes.iccsafe.org/content/NCRC2018', 'IRC 2015 R903, R905'],
  },
  {
    id: 'reroof',
    title: 'Reroofing: tear-off vs. overlay (R908)',
    keywords: ['reroof', 'overlay', 'recover', 'layover', 'tear off', 'tearoff', 'layers', 'second layer', 'two layers'],
    body: `- [general] A recover (new shingles over old) is not allowed when the existing roof already has two or more layers, when the existing covering is water-soaked or deteriorated enough that it can't serve as a base, or over slate, clay or cement tile (R908.3.1.1).
- [general] Existing flashing may be reused only if it's in good condition; damaged or rusted flashing gets replaced.
- [general] Even where an overlay is legal, a tear-off lets you see and replace rotten decking, and most manufacturers' enhanced warranties require a tear-off.`,
    sources: ['IRC 2015 R908'],
  },
  {
    id: 'ventilation',
    title: 'Attic ventilation (R806) and climate zone',
    keywords: ['ventilation', 'vent', 'ridge vent', 'soffit', 'intake', 'exhaust', 'attic', 'hot attic', 'nfa', 'climate zone', 'moisture', 'condensation'],
    body: `- [general] Required net free ventilating area is 1/150 of the vented attic floor area. It may drop to 1/300 when 40–50% of the required area is in the upper portion of the attic (within 3 ft of the ridge) with the rest as intake low down — i.e. a balanced soffit + ridge system (R806.2).
- [general] Quick math: 1/300 means 1 sq ft of NFA per 300 sq ft of attic, split about half intake, half exhaust. Don't mix ridge vents with gable or powered vents on the same attic — they short-circuit each other.
- [general] Most of North Carolina's Piedmont and coastal plain sit in IECC climate zone 3A (warm-humid). Mountain counties are 4A/5A.
- Hot attics, rust on nail tips, frost/moisture on sheathing and curling shingles are ventilation symptoms worth documenting on an inspection.`,
    sources: ['IRC 2015 R806', 'IECC climate zone map'],
  },
  {
    id: 'permits',
    title: 'Do we need a permit? (G.S. 160D-1110)',
    keywords: ['permit', 'permitting', 'inspection', 'exempt', 'exemption', '40000', '$40,000', 'county', 'code enforcement', 'decking', 'structural'],
    body: `- [verified] G.S. 160D-1110(c): work on a single-family residence (also farm and commercial buildings) costing $40,000 or less does not need a building permit, as long as it's done to the NC State Building Code — UNLESS it touches load-bearing structure, changes plumbing/HVAC/electrical, uses non-code-compliant materials, or is "the addition of roofing, excluding replacement."
- [verified] So a like-for-like reroof of a house at $40,000 or under is generally permit-exempt; a reroof over $40,000, any structural repair (rafters, trusses, framing), or adding new roof area (an addition, converting a flat area) needs a permit.
- [check locally] Whether sheathing/decking replacement counts as "structural" is the inspector's call — ask the county before telling a homeowner no permit is needed on a job with lots of decking. Exempt work still has to meet code.
- [check locally] Cities and counties can have their own zoning, HOA or historic-district rules (e.g. local historic districts often need a Certificate of Appropriateness for material changes). HOA approval is a separate thing from a permit.
- Jobs across the state line follow that state's rules, not these — check with that county.`,
    sources: ['https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_160D/GS_160D-1110.html', 'https://www.ncosfm.gov/guidance-papers/gs-160d-1110c-application-construction-permit-exceptions/open'],
  },
  {
    id: 'licensing',
    title: 'Contractor licensing in NC (and SC)',
    keywords: ['license', 'licensing', 'licensed', 'general contractor', 'nclbgc', 'unlicensed', 'threshold', 'south carolina', 'sc'],
    body: `- [verified] G.S. 87-1: anyone who bids or performs a construction project costing $40,000 or more must hold a license from the NC Licensing Board for General Contractors. Under $40,000, no NCLBGC license is required. The threshold is the whole project, labor and materials.
- [general] North Carolina has no separate state roofing license (a 2013 bill, H880, proposed one and did not become law). A roofing company doing $40k+ jobs needs the GC license at an appropriate classification and limit.
- [check locally] Watch jobs that start under $40k and grow past it with supplements or change orders — the threshold is judged on the project, so bring in the licensed entity before the contract crosses it.
- [check locally] South Carolina licenses and registers roofers through SC LLR (Residential Builders Commission for residential specialty work); confirm current thresholds with SC LLR before selling in South Carolina.`,
    sources: ['https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_87/GS_87-1.html', 'https://nclbgc.org'],
  },
  {
    id: 'claim_process',
    title: 'How an NC roof insurance claim works',
    keywords: ['claim', 'insurance', 'adjuster', 'acv', 'rcv', 'depreciation', 'holdback', 'recoverable', 'deductible', 'mortgage', 'check', 'xactimate', 'o&p', 'overhead and profit', 'supplement', 'scope', 'estimate', 'hail', 'wind', 'storm'],
    body: `The usual path:
1. Inspection and documentation — photos of each slope, test squares, collateral damage (gutters, vents, siding, soft metals), dates of the storm.
2. The homeowner files the claim with their carrier (they own the policy and the claim). The contractor can meet the adjuster on site to show the damage.
3. The adjuster writes an estimate, usually in Xactimate. Read it line by line against the contractor's scope: squares and waste, drip edge, starter, ridge, ice-and-water, pipe boots, step/counter flashing, steep and high charges, permit if one is needed, overhead & profit when three or more trades are involved.
4. First payment is usually ACV (Actual Cash Value = replacement cost minus depreciation) minus the deductible. On an RCV (Replacement Cost Value) policy the depreciation is recoverable: the carrier releases it after the work is done and the final invoice is sent.
5. Supplements: when the estimate misses items the job really needs (code-required drip edge, hidden decking, extra layers), send the carrier documentation — photos, measurements, the code section. Supplement only what is true and necessary.
6. Checks are often made out to the homeowner AND the mortgage company; the lender endorses or runs it through their loss-draft process, which can take weeks — set expectations early.

Terms to explain to homeowners in plain language:
- [general] Deductible — the homeowner's share, paid by them. Many NC policies have a separate wind/hail or named-storm deductible, often a percentage of the dwelling coverage (e.g. 1–2%) instead of a flat amount — it's on the declarations page.
- [general] ACV vs RCV — ACV policies pay only the depreciated value; RCV policies pay the full replacement cost in two checks.
- [general] Matching — North Carolina has no specific statute requiring an insurer to match undamaged areas; the argument comes from the policy's "like kind and quality" language and whether the product is still made. Never promise a homeowner a full replacement because of matching.`,
    sources: ['Industry practice'],
  },
  {
    id: 'claim_law',
    title: 'NC insurance law a roofer must know',
    keywords: ['law', 'statute', 'deadline', 'time limit', 'sue', 'lawsuit', 'proof of loss', 'appraisal', 'denied', 'denial', 'bad faith', 'unfair', 'ncdoi', 'complaint', 'department of insurance', 'fraud', 'waive deductible', 'public adjuster', 'attorney'],
    body: `- [verified] Deadline to sue the insurer: the NC standard fire policy (G.S. 58-44-16) says suit must be "commenced within three years after inception of the loss." Many homeowner policies echo it — the homeowner should read theirs.
- [verified] Proof of loss: the standard policy asks for a sworn proof of loss within 60 days after the loss unless the insurer extends that in writing. Many modern policies instead say "within 60 days after our request." Tell homeowners to report damage promptly either way.
- [verified] Appraisal: if the homeowner and insurer disagree on the AMOUNT of loss (not on coverage), either can demand appraisal in writing; each side picks a disinterested appraiser within 20 days, and an umpire settles what they can't agree on (G.S. 58-44-16).
- [general] Unfair claim settlement practices (G.S. 58-63-15(11)) include misrepresenting policy facts, not acting reasonably promptly on communications, refusing to pay without a reasonable investigation, not affirming or denying coverage in a reasonable time after proof of loss, and lowballing to force litigation. A homeowner who believes that is happening can file a complaint with the NC Department of Insurance (ncdoi.gov, Consumer Services).
- [verified] Insurance fraud (G.S. 58-2-161): knowingly presenting a false or misleading statement to support a claim — or assisting, abetting or conspiring with someone to do it — is a Class H felony (Class C at $100,000+). For a roofer that means: never inflate damage, never stage or reuse photos, never bill the insurer for work we won't do, and never "waive," "cover" or rebate the deductible while the insurer is billed as if the homeowner paid it.
- [verified] Public adjusting (G.S. Chapter 58, Article 33A) needs a license from NCDOI. Negotiating the claim — coverage, the amount owed, arguing the policy — on the homeowner's behalf is the adjuster's job, not ours. We document the roof, meet the adjuster, and supply our scope and supporting evidence; for a coverage dispute the homeowner can use their agent, a licensed public adjuster, or an attorney. A public adjuster may not take authority to choose who does the repair and must disclose any pay from a contractor (G.S. 58-33A-80).
- This is general information, not legal advice; for a live dispute, point the homeowner to NCDOI or an attorney.`,
    sources: [
      'https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_58/GS_58-44-16.html',
      'https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_58/GS_58-2-161.html',
      'https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_58/GS_58-33A-80.html',
      'https://www.ncleg.gov/EnactedLegislation/Statutes/PDF/ByArticle/Chapter_58/Article_63.pdf',
    ],
  },
  {
    id: 'door_to_door',
    title: 'Canvassing and door-to-door contracts',
    keywords: ['door', 'canvass', 'knock', 'cancel', 'cancellation', 'cooling off', 'three day', '3 day', 'solicitation', 'contract'],
    body: `- [general] The FTC Cooling-Off Rule (16 CFR Part 429) gives a buyer 3 business days to cancel a sale of $130 or more made at their home, and the contractor must give a written notice of that right with the contract. Signing at the kitchen table counts.
- [check locally] North Carolina also regulates home solicitation sales (G.S. Chapter 25A, Article 5) for credit sales, and many towns require a solicitation/peddler permit to canvass — check the town before a knock day. HOA rules and "no soliciting" signs are respected.
- [general] Post-storm, be the calm company: free inspection, honest findings, no pressure on a homeowner with an open claim, no promises about what insurance will pay.`,
    sources: ['https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-429'],
  },
  {
    id: 'climate_storms',
    title: 'North Carolina weather and roofs',
    keywords: ['weather', 'storm season', 'hail season', 'hurricane', 'tropical', 'wind', 'algae', 'streaks', 'heat', 'humidity', 'lifespan', 'how long'],
    body: `- [general] Hail and severe thunderstorms peak roughly March–June; tropical remnants (e.g. Hugo 1989, Helene 2024) bring wind and tree damage in late summer and fall. Winter ice storms are occasional.
- [general] Heat and humidity drive algae (black streaks — Gloeocapsa magma); algae-resistant shingles and zinc/copper strips help. Streaking is cosmetic, not storm damage.
- [general] Typical asphalt roof life here is about 15–25 years depending on product, ventilation and exposure; south- and west-facing slopes age first.
- [general] Hail damage: bruises/fractured mat, granule loss in a random pattern, hits on soft metals. Wind damage: creased, lifted or missing tabs, usually on the windward side and edges. Blistering, cracking from age, and mechanical/foot damage are not storm damage — be honest about which is which.`,
    sources: ['NOAA / NWS climatology'],
  },
];

/** True when the company's profile puts it in North Carolina, so the NC reference is its own state's rules. */
export function referenceIsHomeState(profile: Pick<CompanyProfile, 'state'>): boolean {
  return profile.state === 'NC';
}

/**
 * What the company says about itself, from its profile, for an advisor's
 * system prompt. Built when the prompt is assembled, so an edit to the
 * profile shows up in the next chat. Only what the company has entered is
 * listed; nothing is filled in or guessed.
 */
export function companyBrief(profile: CompanyProfile): string {
  const p = profile;
  const lines: string[] = [];
  const contact = [
    p.address && [p.address, [p.cityState, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    !p.address && p.cityState,
    p.phone && `Phone ${p.phone}`,
    p.email && `Email ${p.email}`,
    p.websiteLabel && `Website ${p.websiteLabel}`,
  ].filter(Boolean);
  lines.push(`- ${p.legalName}${p.legalName !== p.displayName ? ` ("${p.displayName}")` : ''}, a ${p.trade} company.${contact.length ? ` ${contact.join('. ')}.` : ''}`);
  if (p.tagline) lines.push(`- In a line: ${p.tagline}`);
  if (p.foundedYear) lines.push(`- In business since ${p.foundedYear}.`);
  if (p.serviceArea) lines.push(`- Service area: ${p.serviceArea}`);
  if (p.licenses.length) lines.push(`- Licenses: ${p.licenses.join('; ')}`);
  if (p.certifications.length) lines.push(`- Certifications: ${p.certifications.join('; ')}`);
  if (p.credentials.length) lines.push(`- Credentials: ${p.credentials.join('; ')}`);
  if (p.trustStats.length) lines.push(`- Track record: ${p.trustStats.join('; ')}`);
  if (p.workmanshipWarranty) lines.push(`- Workmanship warranty: ${p.workmanshipWarranty}`);
  else if (p.workmanshipYears) lines.push(`- Workmanship warranty: ${p.workmanshipYears} years`);
  if (p.financingLine || p.financing) lines.push(`- Financing: ${[p.financingLine, p.financing && `through ${p.financing.partner} (${p.financing.applyUrl})`].filter(Boolean).join(' ')}`);
  for (const plan of p.maintenancePlans) lines.push(`- Maintenance plan "${plan.name}": ${plan.text}`);
  if (p.serviceFacts.length) lines.push(`- Service promises: ${p.serviceFacts.join(' ')}`);
  if (p.promise) lines.push(`- Our promise: ${p.promise}`);
  if (p.values.length) lines.push(`- Values: ${p.values.map((v) => `${v.title} (${v.text})`).join('; ')}`);
  if (p.whyUs.length) lines.push(`- Why customers choose us: ${p.whyUs.join('; ')}`);
  if (p.community.length) lines.push(`- Community: ${p.community.join('; ')}`);
  return `THE COMPANY — ${p.displayName} (from the company profile; these are the only company facts you have)
${lines.join('\n')}
- Anything not listed here (a warranty length, a certification, a price, a service area, a year) has not been entered: do not state it. Say you'd need to check with the office.`;
}

const tokens = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9$ ]/g, ' ').split(/\s+/).filter((t) => t.length > 1);

/** Score a topic against free text: keyword phrase hits count most, then title words. */
export function scoreTopic(topic: ReferenceTopic, query: string): number {
  const q = ` ${query.toLowerCase()} `;
  const qTokens = new Set(tokens(query));
  let score = 0;
  for (const k of topic.keywords) {
    if (k.includes(' ') ? q.includes(k) : qTokens.has(k.toLowerCase())) score += k.includes(' ') ? 3 : 2;
  }
  for (const w of tokens(topic.title)) if (w.length > 3 && qTokens.has(w)) score += 1;
  return score;
}

export interface ReferenceLookup {
  topics: { id: string; title: string; body: string; sources: readonly string[] }[];
  checkedOn: string;
  note?: string;
  available?: { id: string; title: string }[];
}

/** Find reference topics by id or by free text. Returns the best matches, never throws. */
export function lookupReference(params: { topic?: unknown; query?: unknown }, max = 3): ReferenceLookup {
  const available = NC_REFERENCE.map((t) => ({ id: t.id, title: t.title }));
  const topicId = typeof params.topic === 'string' ? params.topic.trim() : '';
  const query = typeof params.query === 'string' ? params.query.trim() : '';
  const out = (list: readonly ReferenceTopic[]) =>
    list.map(({ id, title, body, sources }) => ({ id, title, body, sources }));

  if (topicId) {
    const hit = NC_REFERENCE.find((t) => t.id === topicId);
    if (hit) return { topics: out([hit]), checkedOn: REFERENCE_CHECKED_ON };
  }
  if (query) {
    const ranked = NC_REFERENCE
      .map((t) => ({ t, s: scoreTopic(t, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, max)
      .map((x) => x.t);
    if (ranked.length) return { topics: out(ranked), checkedOn: REFERENCE_CHECKED_ON };
  }
  return {
    topics: [],
    checkedOn: REFERENCE_CHECKED_ON,
    note: 'No reference topic matched. Pick one of the available topics, or answer from general knowledge and say so.',
    available,
  };
}

/** One line per topic, for the system prompt — so the model knows what it can pull. */
export function referenceIndex(): string {
  return NC_REFERENCE.map((t) => `- ${t.id}: ${t.title}`).join('\n');
}
