import { getKnowledgeService, type KnowledgeCategory } from './knowledge-service';

interface KnowledgeSeedItem {
  title: string;
  content: string;
  category: KnowledgeCategory;
  tags: string[];
}

// Initial knowledge base for Best Roofing Now LLC
const KNOWLEDGE_SEED: KnowledgeSeedItem[] = [
  // Company Information
  {
    title: 'Company Overview',
    category: 'company',
    tags: ['about', 'overview', 'introduction'],
    content: `Best Roofing Now LLC is a professional roofing company serving the Charlotte, NC metropolitan area. We specialize in residential and commercial roofing services including roof replacements, repairs, inspections, and maintenance.

Founded with a commitment to quality and customer satisfaction, Best Roofing Now has built a reputation for reliable, honest, and professional roofing services. Our team consists of licensed, bonded, and insured professionals who take pride in their work.

Core Values:
- Quality Workmanship: We never cut corners and use only premium materials
- Customer First: Every customer is treated like family
- Transparency: Honest assessments and upfront pricing
- Timeliness: We respect your time and complete projects on schedule
- Safety: All work follows OSHA guidelines and best practices

Business Hours: Monday-Friday 7am-6pm, Saturday 8am-2pm
Emergency Services: Available 24/7 for storm damage and urgent repairs`,
  },
  {
    title: 'Contact Information',
    category: 'company',
    tags: ['contact', 'phone', 'address', 'email'],
    content: `Best Roofing Now LLC Contact Information:

Main Office: Charlotte, NC
Service Area: Greater Charlotte Metropolitan Area

For new customer inquiries and estimates, our AI team responds within minutes during business hours. For urgent matters, emergency services are available 24/7.

Response Time Commitment:
- New leads: Response within 5 minutes
- Estimate requests: Scheduled within 24-48 hours
- Emergency repairs: On-site within 2-4 hours`,
  },

  // Services
  {
    title: 'Roof Replacement Services',
    category: 'services',
    tags: ['replacement', 'new roof', 'installation'],
    content: `Full Roof Replacement Services

Best Roofing Now provides complete roof replacement services for residential and commercial properties. Our replacement process includes:

1. Initial Inspection & Assessment
   - Comprehensive roof evaluation
   - Photo documentation
   - Structural assessment
   - Ventilation analysis

2. Material Options
   - Architectural Shingles (most popular, 30-50 year warranty)
   - 3-Tab Shingles (economical option, 20-25 year warranty)
   - Metal Roofing (premium durability, 40-70 year lifespan)
   - Flat/Low-Slope Systems (TPO, EPDM, Modified Bitumen)
   - Tile and Slate (premium options for specific applications)

3. Installation Process
   - Complete tear-off of existing roofing
   - Inspection of decking, repair as needed
   - Installation of ice & water shield in valleys and edges
   - Premium synthetic underlayment
   - New drip edge and flashing
   - Ridge vent installation for proper ventilation
   - New roof installation with manufacturer specifications
   - Thorough cleanup with magnetic nail sweep

4. Warranty Coverage
   - Workmanship warranty: 10 years
   - Manufacturer warranty: Varies by product (25-50 years)
   - We are certified installers for GAF, Owens Corning, and CertainTeed

Typical Timeline: 1-3 days for residential, varies for commercial`,
  },
  {
    title: 'Roof Repair Services',
    category: 'services',
    tags: ['repair', 'fix', 'leak', 'damage'],
    content: `Roof Repair Services

We handle all types of roof repairs, from minor fixes to major restoration:

Common Repairs We Handle:
- Leak Detection & Repair: Using thermal imaging and water testing to find and fix leaks
- Storm Damage: Hail damage, wind damage, fallen debris
- Shingle Replacement: Missing, cracked, or curling shingles
- Flashing Repairs: Around chimneys, vents, skylights, and walls
- Gutter Issues: Repairs, cleaning, and replacement
- Soffit & Fascia: Rot repair and replacement
- Ventilation Problems: Ridge vents, turbines, and attic fans
- Emergency Repairs: Tarping and temporary fixes for urgent situations

Repair Process:
1. Inspection and assessment
2. Detailed estimate with photos
3. Scheduling at your convenience
4. Professional repair
5. Final inspection and cleanup

Most repairs completed in 1-4 hours. Emergency repairs available 24/7.`,
  },
  {
    title: 'Roof Inspection Services',
    category: 'services',
    tags: ['inspection', 'assessment', 'evaluation'],
    content: `Professional Roof Inspection Services

We offer comprehensive roof inspections for:
- Pre-purchase home inspections
- Annual maintenance inspections
- Post-storm damage assessments
- Insurance claim documentation
- Warranty inspections

Our Inspection Includes:
1. Exterior Assessment
   - Shingle/material condition
   - Flashing integrity
   - Gutter condition
   - Ventilation systems
   - Chimney and skylight seals

2. Interior Assessment (when accessible)
   - Attic inspection
   - Ventilation adequacy
   - Signs of leaks or moisture
   - Insulation condition

3. Documentation
   - Detailed written report
   - Photo documentation
   - Recommendations for repairs
   - Estimated remaining lifespan
   - Cost estimates for any needed work

Inspection Duration: 30-60 minutes
Report Delivery: Same day digital report`,
  },

  // Pricing Guidelines
  {
    title: 'Pricing Overview',
    category: 'pricing',
    tags: ['cost', 'price', 'estimate', 'quote'],
    content: `Pricing Guidelines for Roofing Services

Note: All estimates are customized based on the specific property. These are general ranges for the Charlotte area.

Roof Replacement (per square = 100 sq ft):
- 3-Tab Shingles: $350-$450 per square
- Architectural Shingles: $450-$650 per square
- Premium Architectural: $600-$800 per square
- Metal Roofing: $800-$1,400 per square

Typical Residential Project (2,000 sq ft home, ~20-25 squares):
- Basic replacement: $8,000-$12,000
- Mid-range: $12,000-$18,000
- Premium: $18,000-$25,000+

Roof Repairs:
- Minor repairs (few shingles): $150-$400
- Moderate repairs (small leak, flashing): $400-$1,000
- Major repairs (multiple areas): $1,000-$3,000
- Emergency tarping: $200-$500

Inspections:
- Standard inspection: $150-$250
- Pre-purchase detailed: $250-$400
- Insurance documentation: $200-$350

Factors Affecting Price:
- Roof pitch/steepness (steeper = more labor)
- Roof complexity (multiple levels, dormers)
- Accessibility
- Material quality selected
- Decking repair needs
- Permit requirements

We provide FREE estimates for all replacement projects. Inspection fees may be waived when scheduling repair/replacement work.`,
  },

  // Service Area
  {
    title: 'Service Area - Charlotte Metro',
    category: 'service_area',
    tags: ['location', 'area', 'coverage', 'charlotte'],
    content: `Best Roofing Now Service Area

Primary Service Area - Charlotte, NC Metro:
We proudly serve Charlotte and the surrounding counties within approximately 45 miles of uptown Charlotte.

North Carolina Counties:
- Mecklenburg County (Charlotte, Huntersville, Cornelius, Davidson, Matthews, Mint Hill, Pineville)
- Union County (Monroe, Indian Trail, Waxhaw, Stallings, Wesley Chapel)
- Cabarrus County (Concord, Kannapolis, Harrisburg)
- Gaston County (Gastonia, Belmont, Mount Holly)
- Lincoln County (Lincolnton, Denver)
- Iredell County (Mooresville, Statesville - southern portions)
- Rowan County (Salisbury - southern portions)
- Stanly County (Albemarle - western portions)
- Anson County (Wadesboro - northwestern portions)

South Carolina (within Charlotte metro):
- York County (Rock Hill, Fort Mill, Tega Cay, Lake Wylie)
- Lancaster County (Lancaster, Indian Land)

Popular Charlotte Neighborhoods We Serve:
- Ballantyne, SouthPark, Myers Park
- Dilworth, Plaza Midwood, NoDa
- University Area, Highland Creek
- Steele Creek, Arboretum
- Lake Norman communities
- South Charlotte / Providence area

For locations outside our primary service area, please contact us - we may be able to accommodate your project.`,
  },
  {
    title: 'Charlotte ZIP Codes Served',
    category: 'service_area',
    tags: ['zip', 'zipcode', 'location'],
    content: `Charlotte Area ZIP Codes We Service

Mecklenburg County:
28031, 28036, 28078, 28105, 28134, 28202, 28203, 28204, 28205, 28206, 28207, 28208, 28209, 28210, 28211, 28212, 28213, 28214, 28215, 28216, 28217, 28226, 28227, 28262, 28269, 28270, 28273, 28274, 28277, 28278, 28280, 28282

Union County:
28079, 28103, 28104, 28110, 28112, 28173, 28174

Cabarrus County:
28025, 28027, 28075, 28081, 28083

Gaston County:
28006, 28012, 28016, 28034, 28052, 28054, 28056, 28098, 28101, 28120

Lincoln County:
28037, 28092

York County (SC):
29707, 29708, 29715, 29730, 29732, 29745

Lancaster County (SC):
29720

If your ZIP code is not listed, please contact us - we may still be able to help!`,
  },

  // Industry Knowledge
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

  // FAQ
  {
    title: 'Common Questions - General',
    category: 'faq',
    tags: ['questions', 'faq', 'common'],
    content: `Frequently Asked Questions

Q: How long does a roof replacement take?
A: Most residential roofs take 1-3 days. Factors include size, complexity, weather, and material type.

Q: Do I need to be home during the work?
A: No, but we need access to your property. We'll coordinate entry and keep you updated via text/call.

Q: Will my homeowner's insurance cover a new roof?
A: Coverage depends on your policy and the cause of damage. Storm damage is often covered. Age-related wear typically isn't. We can help document damage for claims.

Q: Can you install a new roof over my existing one?
A: In some cases, yes (up to 2 layers allowed by code). However, we recommend full tear-off for best results and warranty coverage.

Q: How do I know if I need repair or replacement?
A: Generally, if damage affects less than 30% of the roof and it's under 15 years old, repair may be sufficient. We'll give an honest assessment.

Q: What happens if it rains during my project?
A: We monitor weather closely. If rain is expected, we'll either complete sections that can be sealed or cover exposed areas with tarps.

Q: Do you handle permits?
A: Yes, we pull all required permits and schedule inspections as needed.

Q: What payment options do you offer?
A: We accept cash, check, credit cards, and offer financing through approved partners.`,
  },
  {
    title: 'Insurance Claims Process',
    category: 'faq',
    tags: ['insurance', 'claims', 'storm', 'damage'],
    content: `Working With Insurance for Roof Claims

Step-by-Step Claims Process:

1. Document the Damage
   - Take photos/videos of visible damage
   - Note the date the damage occurred
   - Don't make permanent repairs yet

2. Contact Your Insurance
   - File a claim promptly
   - Get a claim number
   - Ask about deductible and coverage

3. Schedule Our Inspection
   - We provide detailed damage assessment
   - Photos and documentation for your adjuster
   - Written scope of needed repairs

4. Meet With Adjuster
   - We can meet with your adjuster on-site
   - We advocate for full, proper repairs
   - Clarify any scope differences

5. Review Settlement
   - Compare adjuster's scope to actual needs
   - We help identify any missed items
   - Supplemental claims if needed

6. Proceed With Repairs
   - Sign contract once claim is approved
   - We work with insurance timelines
   - Handle any depreciation recoverable

What's Typically Covered:
- Hail damage
- Wind damage
- Fallen trees/debris
- Sudden water damage

What's Typically NOT Covered:
- Normal wear and tear
- Lack of maintenance
- Pre-existing damage
- Cosmetic-only damage

We work with all major insurance companies and have experience maximizing claim approvals.`,
  },

  // Scripts
  {
    title: 'Lead Follow-Up Scripts',
    category: 'scripts',
    tags: ['sms', 'text', 'follow-up', 'scripts'],
    content: `Lead Response Scripts

Initial Contact (Immediate):
"Hi [Name], this is Best Roofing Now! We received your request for [service]. Thanks for reaching out! A team member will call you within the hour to discuss your needs. Reply STOP to opt out."

No Answer Follow-Up (Same Day):
"Hi [Name], we tried calling about your roofing inquiry. We'd love to help! When's a good time to chat? You can also reply here with questions."

Next Day Follow-Up:
"Hi [Name], just following up on your roofing request. We have openings this week for free estimates. Would [day] work for you?"

Estimate Confirmation:
"Hi [Name], confirming your estimate appointment for [date/time]. Our estimator [name] will arrive in a company vehicle. See you then!"

Post-Estimate Follow-Up (No Decision):
"Hi [Name], thanks for meeting with us! Just checking if you have any questions about the estimate. We're here to help whenever you're ready."

Review Request (After Job Completion):
"Hi [Name], we hope you're enjoying your new roof! If you're happy with our work, we'd really appreciate a Google review. It helps us help more homeowners like you. [link]"`,
  },

  // Competitors
  {
    title: 'Competitive Positioning',
    category: 'competitors',
    tags: ['competition', 'differentiation', 'why us'],
    content: `Why Choose Best Roofing Now

Our Differentiators:

1. Speed of Service
   - Lead response in minutes, not days
   - Estimates scheduled within 48 hours
   - Most projects completed faster than industry average

2. Transparency
   - Detailed written estimates
   - No hidden fees or surprise charges
   - Clear communication throughout project

3. Quality Assurance
   - Certified installers for major manufacturers
   - Extended workmanship warranty
   - Post-installation inspection included

4. Technology-Forward
   - AI-assisted customer service for instant responses
   - Drone inspections for accurate assessments
   - Digital project tracking and updates

5. Local Expertise
   - Charlotte-based, not a national franchise
   - Understanding of local building codes
   - Relationships with local suppliers

6. Customer Care
   - Direct access to project manager
   - Lifetime support for questions
   - Referral rewards program

When comparing to other contractors, ask:
- Are they licensed, bonded, and insured?
- Do they have manufacturer certifications?
- What's their workmanship warranty length?
- Will they provide local references?
- Do they pull permits for the work?

We're happy to answer all these questions upfront.`,
  },

  // Review Responses
  {
    title: 'Review Response Templates',
    category: 'reviews',
    tags: ['google', 'review', 'response', 'templates'],
    content: `Review Response Templates

5-Star Review Response:
"Thank you so much for the wonderful review, [Name]! We're thrilled that you're happy with your new roof. It was a pleasure working with you, and we appreciate you trusting Best Roofing Now with your home. If you ever need anything in the future, we're just a call away!"

4-Star Review Response:
"Thanks for the great review, [Name]! We're glad we could help with your roofing needs. If there's anything we could have done to earn that 5th star, we'd love to hear your feedback. Thanks again for choosing Best Roofing Now!"

3-Star Review Response:
"Thank you for your feedback, [Name]. We strive for excellence on every project, and we're sorry we didn't fully meet your expectations. We'd appreciate the chance to discuss how we can make this right. Please reach out to us directly at [contact]."

Negative Review Response (Professional):
"[Name], we're sorry to hear about your experience. This isn't the level of service we aim to provide. We take all feedback seriously and would like to resolve any concerns. Please contact us directly at [contact] so we can address this personally."

Response to Unverified/Suspicious Review:
"We don't have a record of this service in our system. Please contact us directly at [contact] with your project details so we can look into this further."

Best Practices:
- Respond within 24-48 hours
- Keep responses professional and grateful
- Never argue publicly
- Take negative discussions offline
- Thank all reviewers for their time`,
  },

  // Legal/Warranty
  {
    title: 'Warranty Information',
    category: 'legal',
    tags: ['warranty', 'guarantee', 'coverage'],
    content: `Warranty Coverage Details

Best Roofing Now Workmanship Warranty:
- Duration: 10 years from installation date
- Covers: Installation defects, labor-related issues
- Includes: Leaks due to improper installation, flashing failures, ventilation issues caused by installation
- Transferable: Yes, to new homeowner (one time)

Manufacturer Material Warranties:
We are certified installers, qualifying your roof for enhanced manufacturer warranties:

GAF Golden Pledge:
- 50-year material warranty
- 25-year workmanship coverage (through GAF)
- Covers labor costs for repairs

Owens Corning Platinum:
- Lifetime material warranty
- 25-year workmanship coverage
- 50-year non-prorated coverage

CertainTeed 5-Star:
- 50-year material warranty
- 25-year workmanship coverage
- Wind warranty up to 130 mph

What Voids Warranties:
- Unauthorized repairs or modifications
- Failure to address known issues
- Improper ventilation (not caused by us)
- Acts of God (separate from storm damage claims)
- Lack of reasonable maintenance

Warranty Claims Process:
1. Contact us with concern
2. We inspect at no charge
3. Document any issues
4. Coordinate with manufacturer if needed
5. Complete repairs under warranty

Keep your warranty certificate and inspection reports in a safe place.`,
  },
];

/**
 * Seed the knowledge base with initial data
 */
export async function seedKnowledgeBase(): Promise<void> {
  const service = getKnowledgeService();

  console.log('[RAG] Starting knowledge base seed...');

  for (const item of KNOWLEDGE_SEED) {
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

  console.log(`[RAG] Knowledge base seeded with ${KNOWLEDGE_SEED.length} documents`);
}
