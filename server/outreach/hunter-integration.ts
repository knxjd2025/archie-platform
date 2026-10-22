/**
 * Hunter.io Integration
 *
 * Handles email finding and verification using Hunter.io API.
 * Features:
 * - Domain search (find all emails for a company)
 * - Email finder (find specific person's email)
 * - Email verifier (check if email is deliverable)
 */

const HUNTER_API_BASE = 'https://api.hunter.io/v2';

export interface HunterEmail {
  value: string;
  type: 'personal' | 'generic';
  confidence: number;
  first_name?: string;
  last_name?: string;
  position?: string;
  department?: string;
  linkedin?: string;
  twitter?: string;
  phone_number?: string;
}

export interface HunterDomainSearchResult {
  domain: string;
  disposable: boolean;
  webmail: boolean;
  accept_all: boolean;
  pattern?: string;
  organization?: string;
  emails: HunterEmail[];
}

export interface HunterEmailFinderResult {
  email: string;
  score: number;
  domain: string;
  accept_all: boolean;
  first_name?: string;
  last_name?: string;
  position?: string;
  company?: string;
  linkedin?: string;
  twitter?: string;
  sources: Array<{
    domain: string;
    uri: string;
    extracted_on: string;
  }>;
}

export interface HunterVerificationResult {
  email: string;
  status: 'valid' | 'invalid' | 'accept_all' | 'webmail' | 'disposable' | 'unknown';
  score: number;
  regexp: boolean;
  gibberish: boolean;
  disposable: boolean;
  webmail: boolean;
  mx_records: boolean;
  smtp_server: boolean;
  smtp_check: boolean;
  accept_all: boolean;
  block: boolean;
  sources: Array<{
    domain: string;
    uri: string;
    extracted_on: string;
  }>;
}

export interface HunterAccountInfo {
  email: string;
  plan_name: string;
  plan_level: number;
  reset_date: string;
  team_id: number | null;
  calls: {
    used: number;
    available: number;
  };
}

class HunterClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const searchParams = new URLSearchParams({
      api_key: this.apiKey,
      ...params,
    });

    const url = `${HUNTER_API_BASE}${endpoint}?${searchParams}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Hunter API error (${response.status}): ${errorData.errors?.[0]?.details || response.statusText}`
      );
    }

    const data = await response.json();
    return data.data;
  }

  /**
   * Get account information and usage
   */
  async getAccountInfo(): Promise<HunterAccountInfo> {
    return this.request<HunterAccountInfo>('/account');
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getAccountInfo();
      return true;
    } catch (error) {
      console.error('Hunter connection test failed:', error);
      return false;
    }
  }

  /**
   * Search for emails by domain
   * Finds all email addresses associated with a company domain
   */
  async domainSearch(
    domain: string,
    options?: {
      type?: 'personal' | 'generic';
      department?: string;
      limit?: number;
    }
  ): Promise<HunterDomainSearchResult> {
    const params: Record<string, string> = { domain };

    if (options?.type) params.type = options.type;
    if (options?.department) params.department = options.department;
    if (options?.limit) params.limit = String(options.limit);

    return this.request<HunterDomainSearchResult>('/domain-search', params);
  }

  /**
   * Find email for a specific person
   * Uses first name, last name, and domain to find email
   */
  async findEmail(
    domain: string,
    firstName?: string,
    lastName?: string,
    fullName?: string
  ): Promise<HunterEmailFinderResult | null> {
    const params: Record<string, string> = { domain };

    if (firstName) params.first_name = firstName;
    if (lastName) params.last_name = lastName;
    if (fullName) params.full_name = fullName;

    try {
      return await this.request<HunterEmailFinderResult>('/email-finder', params);
    } catch (error: any) {
      // Hunter returns 404 if no email found - this is expected
      if (error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Verify if an email address is deliverable
   */
  async verifyEmail(email: string): Promise<HunterVerificationResult> {
    return this.request<HunterVerificationResult>('/email-verifier', { email });
  }

  /**
   * Get email count for a domain (free, doesn't use credits)
   */
  async getEmailCount(domain: string): Promise<{ total: number; personal: number; generic: number }> {
    return this.request<{ total: number; personal: number; generic: number }>('/email-count', {
      domain,
    });
  }
}

/**
 * Create a Hunter client instance
 */
export function createHunterClient(apiKey: string): HunterClient {
  return new HunterClient(apiKey);
}

/**
 * Extract domain from website URL
 */
export function extractDomain(websiteUrl: string): string {
  try {
    const url = new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    // If URL parsing fails, try to extract domain directly
    return websiteUrl
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];
  }
}

/**
 * Generate common email patterns for a person
 */
export function generateEmailPatterns(
  firstName: string,
  lastName: string,
  domain: string
): string[] {
  const f = firstName.toLowerCase();
  const l = lastName.toLowerCase();
  const fi = f.charAt(0);
  const li = l.charAt(0);

  return [
    `${f}@${domain}`, // john@company.com
    `${f}.${l}@${domain}`, // john.smith@company.com
    `${f}${l}@${domain}`, // johnsmith@company.com
    `${fi}${l}@${domain}`, // jsmith@company.com
    `${f}${li}@${domain}`, // johns@company.com
    `${l}@${domain}`, // smith@company.com
    `${l}.${f}@${domain}`, // smith.john@company.com
    `${fi}.${l}@${domain}`, // j.smith@company.com
    `${f}_${l}@${domain}`, // john_smith@company.com
    `${fi}${li}@${domain}`, // js@company.com
  ];
}

/**
 * Find the best email for a lead
 * Tries multiple strategies in order of reliability
 */
export async function findBestEmail(
  client: HunterClient,
  lead: {
    website?: string | null;
    ownerFirstName?: string | null;
    ownerLastName?: string | null;
    companyName: string;
  }
): Promise<{
  email: string | null;
  confidence: number;
  source: 'hunter_finder' | 'hunter_domain' | 'pattern' | 'generic';
}> {
  if (!lead.website) {
    return { email: null, confidence: 0, source: 'generic' };
  }

  const domain = extractDomain(lead.website);

  // Strategy 1: Try to find specific person's email
  if (lead.ownerFirstName && lead.ownerLastName) {
    try {
      const result = await client.findEmail(domain, lead.ownerFirstName, lead.ownerLastName);
      if (result && result.score >= 50) {
        return {
          email: result.email,
          confidence: result.score,
          source: 'hunter_finder',
        };
      }
    } catch (error) {
      console.error('Hunter email finder error:', error);
    }
  }

  // Strategy 2: Search domain for any personal emails
  try {
    const domainResult = await client.domainSearch(domain, { type: 'personal', limit: 5 });

    if (domainResult.emails.length > 0) {
      // Find the best email (highest confidence, preferably owner/founder)
      const ownerEmail = domainResult.emails.find(
        e =>
          e.position?.toLowerCase().includes('owner') ||
          e.position?.toLowerCase().includes('founder') ||
          e.position?.toLowerCase().includes('president') ||
          e.position?.toLowerCase().includes('ceo')
      );

      if (ownerEmail) {
        return {
          email: ownerEmail.value,
          confidence: ownerEmail.confidence,
          source: 'hunter_domain',
        };
      }

      // Otherwise return the highest confidence email
      const bestEmail = domainResult.emails.reduce((best, current) =>
        current.confidence > best.confidence ? current : best
      );

      return {
        email: bestEmail.value,
        confidence: bestEmail.confidence,
        source: 'hunter_domain',
      };
    }
  } catch (error) {
    console.error('Hunter domain search error:', error);
  }

  // Strategy 3: Generate common patterns and try generic
  // Return info@ as fallback
  return {
    email: `info@${domain}`,
    confidence: 30,
    source: 'generic',
  };
}

/**
 * Batch verify emails (respects rate limits)
 */
export async function batchVerifyEmails(
  client: HunterClient,
  emails: string[],
  delayMs: number = 500
): Promise<Map<string, HunterVerificationResult>> {
  const results = new Map<string, HunterVerificationResult>();

  for (const email of emails) {
    try {
      const result = await client.verifyEmail(email);
      results.set(email, result);
    } catch (error) {
      console.error(`Failed to verify ${email}:`, error);
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  return results;
}

/**
 * Check if verification result indicates a sendable email
 */
export function isEmailSendable(result: HunterVerificationResult): boolean {
  // Valid or accept_all emails are generally safe to send to
  return result.status === 'valid' || (result.status === 'accept_all' && result.score >= 50);
}

export default HunterClient;
