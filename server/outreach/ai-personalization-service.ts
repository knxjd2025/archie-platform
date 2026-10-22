/**
 * AI Personalization Service
 *
 * Generates creative, personalized email subject lines and first lines
 * using OpenAI or Anthropic APIs.
 *
 * Features:
 * - Context-aware personalization based on company research
 * - Multiple variations for A/B testing
 * - Industry-specific tone and messaging
 * - Avoidance of spam trigger words
 */

import OpenAI from 'openai';

export interface PersonalizationContext {
  companyName: string;
  industry: string;
  ownerFirstName?: string | null;
  ownerLastName?: string | null;
  city: string;
  state: string;
  yearFounded?: string | null;
  googleRating?: number | null;
  googleReviewCount?: number | null;
  linkedinUrl?: string | null;
  website?: string | null;
  customNotes?: string | null;
}

export interface PersonalizationResult {
  subjectLine: string;
  firstLine: string;
  alternativeSubjects?: string[];
  alternativeFirstLines?: string[];
}

// Spam trigger words to avoid
const SPAM_TRIGGER_WORDS = [
  'free', 'guarantee', 'no obligation', 'winner', 'congratulations',
  'act now', 'limited time', 'urgent', 'exclusive deal', 'click here',
  'buy now', 'order now', 'special promotion', 'risk-free',
];

/**
 * AI Personalization Service using OpenAI
 */
class AIPersonalizationService {
  private openai: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-4o-mini') {
    this.openai = new OpenAI({ apiKey });
    this.model = model;
  }

  /**
   * Generate personalized subject line and first line
   */
  async generatePersonalization(context: PersonalizationContext): Promise<PersonalizationResult> {
    const prompt = this.buildPersonalizationPrompt(context);

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `You are an expert cold email copywriter specializing in B2B outreach for digital marketing services. Your goal is to write subject lines and opening lines that:
1. Create curiosity without being clickbait
2. Feel personal and researched
3. Avoid spam trigger words
4. Are concise (subject under 50 chars, first line under 150 chars)
5. Reference something specific about the company when possible

You help businesses offering SEO, website design, Google Ads, and marketing automation services reach home service companies (roofing, HVAC, plumbing, etc.).

Respond in JSON format only.`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8, // Higher creativity
      max_tokens: 500,
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('No response from AI');
    }

    const result = JSON.parse(content);

    // Validate and clean the result
    return {
      subjectLine: this.cleanSubjectLine(result.subject_line || result.subjectLine),
      firstLine: this.cleanFirstLine(result.first_line || result.firstLine),
      alternativeSubjects: result.alternative_subjects || result.alternativeSubjects,
      alternativeFirstLines: result.alternative_first_lines || result.alternativeFirstLines,
    };
  }

  /**
   * Generate multiple variations for A/B testing
   */
  async generateVariations(
    context: PersonalizationContext,
    count: number = 3
  ): Promise<PersonalizationResult[]> {
    const variations: PersonalizationResult[] = [];

    for (let i = 0; i < count; i++) {
      const result = await this.generatePersonalization(context);
      variations.push(result);

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return variations;
  }

  /**
   * Build the personalization prompt
   */
  private buildPersonalizationPrompt(context: PersonalizationContext): string {
    const yearsInBusiness = context.yearFounded
      ? new Date().getFullYear() - parseInt(context.yearFounded)
      : null;

    let details = `Company: ${context.companyName}
Industry: ${context.industry}
Location: ${context.city}, ${context.state}`;

    if (context.ownerFirstName) {
      details += `\nOwner: ${context.ownerFirstName}${context.ownerLastName ? ' ' + context.ownerLastName : ''}`;
    }

    if (yearsInBusiness) {
      details += `\nYears in business: ${yearsInBusiness} years (founded ${context.yearFounded})`;
    }

    if (context.googleRating && context.googleReviewCount) {
      details += `\nGoogle rating: ${context.googleRating} stars (${context.googleReviewCount} reviews)`;
    }

    if (context.linkedinUrl) {
      details += `\nHas LinkedIn presence`;
    }

    if (context.customNotes) {
      details += `\nAdditional context: ${context.customNotes}`;
    }

    return `Generate a personalized cold email subject line and opening line for this company:

${details}

Context: I'm reaching out to offer digital marketing services (SEO, website design, Google Ads) to help them get more customers.

Requirements:
1. Subject line: Under 50 characters, creates curiosity, uses owner's first name if available
2. First line: Under 150 characters, references something specific about them, compliments authentically
3. Avoid these spam words: ${SPAM_TRIGGER_WORDS.slice(0, 10).join(', ')}
4. Sound human, not salesy
5. Create a sense of relevance, not urgency

Return JSON with these fields:
{
  "subject_line": "the subject line",
  "first_line": "the opening line",
  "alternative_subjects": ["2 more subject line options"],
  "alternative_first_lines": ["2 more first line options"]
}`;
  }

  /**
   * Clean and validate subject line
   */
  private cleanSubjectLine(subject: string): string {
    if (!subject) return 'Quick question about your online presence';

    // Remove quotes if present
    subject = subject.replace(/^["']|["']$/g, '').trim();

    // Truncate if too long
    if (subject.length > 60) {
      subject = subject.substring(0, 57) + '...';
    }

    // Check for spam words and replace
    const lowerSubject = subject.toLowerCase();
    for (const word of SPAM_TRIGGER_WORDS) {
      if (lowerSubject.includes(word)) {
        console.warn(`Subject line contains spam word: ${word}`);
      }
    }

    return subject;
  }

  /**
   * Clean and validate first line
   */
  private cleanFirstLine(firstLine: string): string {
    if (!firstLine) return 'I came across your company and noticed an opportunity to help.';

    // Remove quotes if present
    firstLine = firstLine.replace(/^["']|["']$/g, '').trim();

    // Ensure it ends properly
    if (!firstLine.match(/[.!?]$/)) {
      firstLine += '.';
    }

    // Truncate if too long
    if (firstLine.length > 200) {
      const lastPeriod = firstLine.lastIndexOf('.', 197);
      if (lastPeriod > 100) {
        firstLine = firstLine.substring(0, lastPeriod + 1);
      } else {
        firstLine = firstLine.substring(0, 197) + '...';
      }
    }

    return firstLine;
  }
}

/**
 * Create an AI personalization service instance
 */
export function createAIPersonalizationService(
  apiKey: string,
  model?: string
): AIPersonalizationService {
  return new AIPersonalizationService(apiKey, model);
}

/**
 * Generate personalization without AI (fallback templates)
 */
export function generateTemplatePersonalization(context: PersonalizationContext): PersonalizationResult {
  const { companyName, ownerFirstName, city, yearFounded, googleRating, googleReviewCount, industry } = context;

  const yearsInBusiness = yearFounded
    ? new Date().getFullYear() - parseInt(yearFounded)
    : null;

  // Subject line templates
  let subjectLine: string;
  if (ownerFirstName) {
    const templates = [
      `${ownerFirstName} - quick idea for ${companyName}`,
      `${ownerFirstName}, saw ${companyName}'s work`,
      `Question for ${ownerFirstName} at ${companyName}`,
    ];
    subjectLine = templates[Math.floor(Math.random() * templates.length)];
  } else {
    const templates = [
      `Idea for ${companyName}'s online presence`,
      `${companyName} + more ${city} customers`,
      `Quick question about ${companyName}`,
    ];
    subjectLine = templates[Math.floor(Math.random() * templates.length)];
  }

  // First line templates
  let firstLine: string;
  if (yearsInBusiness && yearsInBusiness > 10) {
    firstLine = `${yearsInBusiness} years serving ${city} homeowners - that's the kind of track record that should dominate Google searches.`;
  } else if (googleRating && googleRating >= 4.5 && googleReviewCount && googleReviewCount > 50) {
    firstLine = `I noticed ${companyName} has a ${googleRating}-star rating with ${googleReviewCount} reviews - that's impressive social proof.`;
  } else if (ownerFirstName) {
    firstLine = `I came across ${companyName} while researching ${industry} companies in ${city}, and your work stood out.`;
  } else {
    firstLine = `I was researching ${industry} companies in ${city} and noticed ${companyName} has room to grow online.`;
  }

  return {
    subjectLine,
    firstLine,
  };
}

/**
 * Batch generate personalizations for multiple leads
 */
export async function batchGeneratePersonalizations(
  service: AIPersonalizationService,
  contexts: PersonalizationContext[],
  delayMs: number = 500
): Promise<Map<string, PersonalizationResult>> {
  const results = new Map<string, PersonalizationResult>();

  for (const context of contexts) {
    try {
      const result = await service.generatePersonalization(context);
      results.set(context.companyName, result);
    } catch (error) {
      console.error(`Failed to personalize for ${context.companyName}:`, error);
      // Use template fallback
      results.set(context.companyName, generateTemplatePersonalization(context));
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  return results;
}

export default AIPersonalizationService;
