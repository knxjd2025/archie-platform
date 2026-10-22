import { getKnowledgeService, type KnowledgeCategory } from './knowledge-service';
import { currentProfile } from '../tenant/context';
import type { CompanyProfile } from '../../shared/company';

interface KnowledgeSeedItem {
  title: string;
  content: string;
  category: KnowledgeCategory;
  tags: string[];
}

/*
 * The starting knowledge base for one company, seeded once per company (as
 * that company) when its knowledge base is empty.
 *
 * Two kinds of documents:
 * - Company documents, written from the company's profile at seed time. They
 *   state only what the company entered; a fact it has not entered is left
 *   out, never filled in. (The advisors also get the profile itself in their
 *   system prompt when each chat starts, so a later profile edit reaches them
 *   even though these documents were written earlier.)
 * - Trade knowledge for the company's trade: how the work is done, what the
 *   materials are, how insurance claims work. General, not claims about any
 *   one company. Only roofing has trade documents so far.
 */

const list = (items: readonly string[]): string => items.map((i) => `- ${i}`).join('\n');
const section = (heading: string, body: string): string => (body.trim() ? `${heading}\n${body}` : '');
const join = (...parts: string[]): string => parts.filter((p) => p.trim()).join('\n\n');

/** Company documents: what this company says about itself, from its profile. */
export function companyKnowledge(p: CompanyProfile): KnowledgeSeedItem[] {
  const name = p.displayName;
  const docs: KnowledgeSeedItem[] = [];

  docs.push({
    title: 'Company Overview',
    category: 'company',
    tags: ['about', 'overview', 'introduction'],
    content: join(
      `${p.legalName} is a ${p.trade} company${p.cityState ? ` based in ${p.cityState}` : ''}.${p.tagline ? ` ${p.tagline}` : ''}`,
      p.foundedYear ? `In business since ${p.foundedYear}.` : '',
      p.story ? `${p.story.heading}\n${p.story.paragraphs.join('\n\n')}` : '',
      p.promise ? `Our promise: ${p.promise}` : '',
      section('Our values:', list(p.values.map((v) => `${v.title}: ${v.text}`))),
      section('Licenses:', list(p.licenses)),
      section('Certifications:', list(p.certifications)),
      section('Credentials:', list(p.credentials)),
      section('Track record:', list(p.trustStats)),
      section('Community:', list(p.community)),
    ),
  });

  const contact = [
    p.address && `Office: ${[p.address, [p.cityState, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}`,
    !p.address && p.cityState && `Based in: ${p.cityState}`,
    p.phone && `Phone: ${p.phone}`,
    p.email && `Email: ${p.email}`,
    p.website && `Website: ${p.website}`,
    p.reviewUrl && `Leave a review: ${p.reviewUrl}`,
    ...p.links.map((l) => `${l.label}: ${l.url}`),
  ].filter((l): l is string => !!l);
  docs.push({
    title: 'Contact Information',
    category: 'company',
    tags: ['contact', 'phone', 'address', 'email'],
    content: join(
      `${p.legalName} contact information:`,
      contact.length ? contact.join('\n') : 'No contact details have been entered in the company profile yet. Ask the office.',
      section('Service promises:', list(p.serviceFacts)),
    ),
  });

  docs.push({
    title: 'Service Area',
    category: 'service_area',
    tags: ['location', 'area', 'coverage'],
    content: p.serviceArea
      ? `${name} serves: ${p.serviceArea}\n\nFor a location that is not clearly inside this area, check with the office before saying yes or no.`
      : `${name} has not described its service area in the company profile yet. Before telling a customer whether their address is served, check with the office.`,
  });

  const warranty = p.workmanshipWarranty || (p.workmanshipYears ? `${p.workmanshipYears}-year workmanship warranty` : '');
  docs.push({
    title: 'Warranty Information',
    category: 'legal',
    tags: ['warranty', 'guarantee', 'coverage'],
    content: join(
      warranty
        ? `${name} workmanship warranty: ${warranty}. For the exact terms (what it covers, whether it transfers), see the written warranty given with the contract.`
        : `${name} has not entered its workmanship warranty in the company profile. Do not quote a warranty length; ask the office for the written terms.`,
      section('Certifications that can qualify a job for enhanced manufacturer warranties:', list(p.certifications)),
      `Manufacturer material warranties come from the manufacturer and depend on the product and on the installer's certification level. Enhanced manufacturer warranties are only available through installers the manufacturer has certified for them.`,
    ),
  });

  const payment = [
    p.financingLine,
    p.financing && `Financing partner: ${p.financing.partner}. Apply at ${p.financing.applyUrl}`,
  ].filter((l): l is string => !!l);
  if (payment.length || p.maintenancePlans.length) {
    docs.push({
      title: 'Financing and Maintenance Plans',
      category: 'pricing',
      tags: ['financing', 'payment', 'maintenance', 'plan'],
      content: join(
        section('Financing:', payment.join('\n')),
        section('Maintenance plans:', list(p.maintenancePlans.map((m) => `${m.name}${m.tag ? ` (${m.tag})` : ''}: ${m.text}`))),
      ),
    });
  }

  docs.push({
    title: `Why Choose ${name}`,
    category: 'competitors',
    tags: ['competition', 'differentiation', 'why us'],
    content: join(
      section(`Reasons customers choose ${name}:`, list(p.whyUs)),
      section('Credentials:', list(p.credentials)),
      `When a customer is comparing contractors, these are fair questions to ask any of them:
- Are they licensed (where the state requires it) and insured?
- Do they hold manufacturer certifications, and for which warranties?
- How long is their workmanship warranty, and is it in writing?
- Will they provide local references?
- Do they pull permits where the work needs one?

Answer them for ${name} only from the facts above or the company profile.`,
    ),
  });

  docs.push({
    title: 'Lead Follow-Up Scripts',
    category: 'scripts',
    tags: ['sms', 'text', 'follow-up', 'scripts'],
    content: `Lead Response Scripts

Initial Contact (Immediate):
"Hi [Name], this is ${name}! We received your request for [service]. Thanks for reaching out! A team member will call you soon to talk about what you need. Reply STOP to opt out."

No Answer Follow-Up (Same Day):
"Hi [Name], we tried calling about your request. We'd love to help! When's a good time to chat? You can also reply here with questions."

Next Day Follow-Up:
"Hi [Name], just following up on your request. Would [day] work for us to come take a look?"

Estimate Confirmation:
"Hi [Name], confirming your appointment for [date/time]. [Rep name] from ${name} will see you then!"

Post-Estimate Follow-Up (No Decision):
"Hi [Name], thanks for meeting with us! Just checking if you have any questions about the estimate. We're here to help whenever you're ready."

Review Request (After Job Completion):
"Hi [Name], we hope you're enjoying the finished work! If you're happy with it, we'd really appreciate a review. It helps us help more homeowners like you. ${p.reviewUrl || '[review link]'}"`,
  });

  docs.push({
    title: 'Review Response Templates',
    category: 'reviews',
    tags: ['google', 'review', 'response', 'templates'],
    content: `Review Response Templates

5-Star Review Response:
"Thank you so much for the wonderful review, [Name]! We're thrilled you're happy with the work. It was a pleasure working with you, and we appreciate you trusting ${name} with your home. If you ever need anything, we're just a call away!"

4-Star Review Response:
"Thanks for the great review, [Name]! We're glad we could help. If there's anything we could have done to earn that 5th star, we'd love to hear your feedback. Thanks again for choosing ${name}!"

3-Star Review Response:
"Thank you for your feedback, [Name]. We aim for excellent work on every project, and we're sorry we didn't fully meet your expectations. We'd appreciate the chance to make this right. Please reach out to us directly at ${p.phone || p.email || '[contact]'}."

Negative Review Response (Professional):
"[Name], we're sorry to hear about your experience. This isn't the level of service we aim to provide. We take all feedback seriously and would like to resolve your concerns. Please contact us directly at ${p.phone || p.email || '[contact]'} so we can address this personally."

Response to Unverified/Suspicious Review:
"We don't have a record of this service in our system. Please contact us directly at ${p.phone || p.email || '[contact]'} with your project details so we can look into this further."

Best Practices:
- Respond within 24-48 hours
- Keep responses professional and grateful
- Never argue publicly
- Take negative discussions offline
- Thank all reviewers for their time`,
  });

  return docs;
}

/** General roofing knowledge: how the work is done and how claims work. No company claims. */
const ROOFING_KNOWLEDGE: KnowledgeSeedItem[] = [
  {
    title: 'Roof Replacement: What It Involves',
    category: 'services',
    tags: ['replacement', 'new roof', 'installation'],
    content: `What a full roof replacement usually involves

1. Inspection and assessment
   - Roof evaluation with photo documentation
   - Decking and structure check
   - Ventilation check

2. Material options
   - Architectural (dimensional) shingles: the most common choice
   - 3-tab shingles: the economy option
   - Metal roofing: long lifespan, higher upfront cost
   - Flat/low-slope systems: TPO, EPDM, modified bitumen
   - Tile and slate: premium options for specific homes

3. Installation
   - Tear-off of the existing roofing
   - Decking inspection and replacement where rotten or damaged
   - Ice and water shield where the scope or code calls for it (often valleys and eaves)
   - Underlayment over the rest of the deck
   - Drip edge and new flashing
   - Ridge or other exhaust ventilation balanced with intake
   - Shingles installed to the manufacturer's instructions (the manufacturer warranty depends on it)
   - Cleanup, including a magnetic sweep for nails

A typical house takes 1-3 days, depending on size, complexity and weather.
Warranty and certifications vary by company: see the company's Warranty Information document.`,
  },
  {
    title: 'Roof Repair: Common Problems',
    category: 'services',
    tags: ['repair', 'fix', 'leak', 'damage'],
    content: `Common roof repairs

- Leaks: find the entry point (often flashing, a pipe boot or a valley), not just the stain
- Storm damage: hail, wind, fallen debris
- Shingle replacement: missing, cracked or curling shingles
- Flashing: around chimneys, vents, skylights and walls
- Gutters, soffit and fascia: rot, sagging, overflow
- Ventilation: ridge vents, turbines, attic fans
- Emergency tarping to stop water until a permanent repair

A good repair visit: inspect, photograph, give a written estimate, repair, and show the finished work.`,
  },
  {
    title: 'Roof Inspections: What Gets Checked',
    category: 'services',
    tags: ['inspection', 'assessment', 'evaluation'],
    content: `What a roof inspection covers

Common reasons: buying or selling a home, annual maintenance, after a storm, insurance claim documentation, warranty checks.

Exterior: shingle or membrane condition, flashing, gutters, ventilation, chimney and skylight seals.
Interior (when accessible): attic ventilation, signs of leaks or moisture, insulation.
Documentation: written findings, photos, recommended repairs, estimated remaining life.`,
  },
  {
    title: 'Roof Pricing: What Drives the Cost',
    category: 'pricing',
    tags: ['cost', 'price', 'estimate', 'quote'],
    content: `What drives the price of roofing work

Roofing is priced by the square (100 sq ft of roof surface). What moves the price:
- Roof size, and waste from cuts on complex roofs
- Pitch: steeper roofs need more labor and safety equipment
- Complexity: multiple levels, dormers, valleys, penetrations
- Access to the roof and the property
- Material selected
- Decking that has to be replaced once the old roof is off
- Number of existing layers to tear off
- Permit requirements where the job needs one

Prices vary by region and company: quote this company's prices only from its own price lists or estimates, never from general internet numbers.`,
  },
  {
    title: 'Roofing Materials Guide',
    category: 'industry',
    tags: ['materials', 'shingles', 'types'],
    content: `Roofing Materials Guide

Asphalt Shingles (Most Common):

1. 3-Tab Shingles
   - Most economical option
   - Flat appearance
   - 20-25 year lifespan
   - Wind resistance: up to 60 mph
   - Best for: Budget-conscious homeowners

2. Architectural (Dimensional) Shingles
   - Multi-layered for depth and dimension
   - 30-50 year lifespan
   - Wind resistance: up to 130 mph
   - Better warranty options
   - Best for: Most homeowners (best value)

3. Premium/Designer Shingles
   - Mimics slate, wood shake, or tile
   - 40-50+ year lifespan
   - Enhanced curb appeal
   - Best for: Upscale homes, historic properties

Metal Roofing:
- Standing seam: Most durable, modern look
- Metal shingles: Traditional appearance with metal benefits
- 40-70 year lifespan
- Energy efficient (reflects heat)
- Excellent in storms
- Higher upfront cost, lowest lifetime cost

Flat/Low-Slope Options:
- TPO (Thermoplastic): Energy efficient, UV resistant
- EPDM (Rubber): Durable, economical
- Modified Bitumen: Traditional, reliable

Premium Options:
- Slate: 100+ year lifespan, very heavy
- Clay/Concrete Tile: 50+ years, Mediterranean look
- Cedar Shake: Natural beauty, requires maintenance`,
  },
  {
    title: 'Signs You Need a New Roof',
    category: 'industry',
    tags: ['warning', 'signs', 'replacement', 'age'],
    content: `Warning Signs That Indicate Roof Replacement May Be Needed

Age-Related Signs:
- Roof is 20+ years old (asphalt shingles)
- Multiple repairs in recent years
- Neighbors with similar homes are replacing roofs

Visible Exterior Signs:
- Missing, cracked, or curling shingles
- Bald spots where granules are missing
- Granules accumulating in gutters
- Sagging areas on the roof
- Daylight visible through roof boards
- Moss or algae growth (indicates moisture retention)

Interior Signs:
- Water stains on ceilings or walls
- Peeling paint near rooflines
- Mold or mildew in attic
- Increased energy bills (poor insulation/ventilation)
- Musty odors in upper floors

Storm Damage Indicators:
- Dents or dimples in shingles (hail)
- Lifted or peeling shingles (wind)
- Debris impact damage
- Flashing damage or displacement

If you notice any of these signs, schedule an inspection. Early detection can save significant repair costs and prevent interior damage.`,
  },
  {
    title: 'Common Questions - General',
    category: 'faq',
    tags: ['questions', 'faq', 'common'],
    content: `Frequently Asked Questions (general roofing answers)

Q: How long does a roof replacement take?
A: Most residential roofs take 1-3 days. Size, complexity, weather and material all matter.

Q: Do I need to be home during the work?
A: Usually not, but the crew needs access to the property. The office will coordinate.

Q: Will my homeowner's insurance cover a new roof?
A: It depends on the policy and the cause of damage. Storm damage is often covered; age-related wear usually isn't. A contractor can document the damage for the claim.

Q: Can a new roof go over my existing one?
A: Sometimes: building codes generally allow at most two layers, and not over a deteriorated roof. A full tear-off lets the decking be checked and is required for most enhanced manufacturer warranties.

Q: How do I know if I need a repair or a replacement?
A: It depends on the roof's age, how widespread the damage is, and whether matching shingles are still made. An inspection gives an honest answer.

Q: What happens if it rains during my project?
A: Crews watch the weather, work in sections that can be sealed the same day, and tarp anything left open.

Q: Do I need a permit?
A: Permit rules depend on the state, county and size of the job. Ask the office whether your job needs one.

Q: What payment options are there?
A: See the company's Financing and Maintenance Plans document, or ask the office.`,
  },
  {
    title: 'Insurance Claims Process',
    category: 'faq',
    tags: ['insurance', 'claims', 'storm', 'damage'],
    content: `How a roof insurance claim usually works

1. Document the damage
   - Photos/videos of visible damage
   - The date of the storm
   - Temporary repairs (a tarp) only; no permanent repairs before the adjuster sees it

2. The homeowner files the claim
   - The homeowner owns the policy and the claim
   - Get a claim number; ask about the deductible and coverage

3. Inspection
   - The contractor documents the damage with photos and a written scope

4. Adjuster visit
   - The contractor can meet the adjuster on site to show the damage and explain the scope
   - Negotiating coverage on the homeowner's behalf is public adjusting, which needs a license in most states; the homeowner can use their agent, a licensed public adjuster, or an attorney for a coverage dispute

5. Review the settlement
   - Compare the adjuster's scope to what the job needs
   - Send documented supplements for real, necessary items the estimate missed

6. The work and the final payment
   - On a replacement-cost policy, recoverable depreciation is usually released after the work is done and the final invoice is sent
   - Checks are often made out to the homeowner and the mortgage company

Typically covered: hail, wind, fallen trees and debris, sudden water damage.
Typically not covered: normal wear and tear, lack of maintenance, pre-existing damage.

Never inflate damage, bill the insurer for work that won't be done, or waive or rebate a deductible: that is insurance fraud.`,
  },
];

/** Trade knowledge by trade. Trades not listed get only the company documents. */
const TRADE_KNOWLEDGE: Record<string, KnowledgeSeedItem[]> = {
  roofing: ROOFING_KNOWLEDGE,
};

/** Every document to seed for a company: its own documents, then its trade's. */
export function knowledgeSeed(profile: CompanyProfile): KnowledgeSeedItem[] {
  return [...companyKnowledge(profile), ...(TRADE_KNOWLEDGE[profile.trade.toLowerCase()] ?? [])];
}

/**
 * Seed the current company's knowledge base. Runs as the company (seedCompany
 * in server/seed.ts), so the documents are its own and written from its profile.
 */
export async function seedKnowledgeBase(): Promise<void> {
  const service = getKnowledgeService();
  const items = knowledgeSeed(currentProfile());

  console.log('[RAG] Starting knowledge base seed...');

  for (const item of items) {
    try {
      await service.addDocument({
        title: item.title,
        content: item.content,
        category: item.category,
        tags: item.tags,
        source: 'initial_seed',
        active: true,
      });
      console.log(`[RAG] Added: ${item.title}`);
    } catch (error: any) {
      console.error(`[RAG] Failed to add "${item.title}":`, error.message);
    }
  }

  console.log(`[RAG] Knowledge base seeded with ${items.length} documents`);
}
