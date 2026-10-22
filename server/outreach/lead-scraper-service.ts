/**
 * Lead Scraper Service
 *
 * Handles scraping of home service company leads using BrightData.
 * Features:
 * - Google/Bing search for businesses by industry + location
 * - Website scraping for owner information
 * - Deduplication via hash
 * - Rate limiting to avoid blocking
 */

import { createHash } from 'crypto';

// BrightData API configuration
const BRIGHTDATA_API_BASE = 'https://api.brightdata.com';

export interface ScrapedLead {
  companyName: string;
  website: string | null;
  phone: string | null;
  address: string | null;
  city: string;
  state: string;
  zipCode: string | null;
  ownerFirstName: string | null;
  ownerLastName: string | null;
  googleRating: number | null;
  googleReviewCount: number | null;
  yearFounded: string | null;
  linkedinUrl: string | null;
  facebookUrl: string | null;
  sourceUrl: string;
}

export interface SearchQuery {
  industry: string;
  city: string;
  state: string;
  query: string;
}

// Home service industries to target
export const HOME_SERVICE_INDUSTRIES = [
  'roofing',
  'hvac',
  'plumbing',
  'electrical',
  'landscaping',
  'painting',
  'general contractor',
  'windows and doors',
  'gutters',
  'siding',
  'fencing',
  'garage doors',
  'pool service',
  'pest control',
  'cleaning services',
] as const;

export type HomeServiceIndustry = (typeof HOME_SERVICE_INDUSTRIES)[number];

// Major US cities for targeting
export const MAJOR_US_CITIES = [
  { city: 'Atlanta', state: 'GA' },
  { city: 'Houston', state: 'TX' },
  { city: 'Phoenix', state: 'AZ' },
  { city: 'Chicago', state: 'IL' },
  { city: 'Dallas', state: 'TX' },
  { city: 'Denver', state: 'CO' },
  { city: 'Miami', state: 'FL' },
  { city: 'Seattle', state: 'WA' },
  { city: 'Los Angeles', state: 'CA' },
  { city: 'Tampa', state: 'FL' },
  { city: 'Orlando', state: 'FL' },
  { city: 'Nashville', state: 'TN' },
  { city: 'Charlotte', state: 'NC' },
  { city: 'San Antonio', state: 'TX' },
  { city: 'Austin', state: 'TX' },
  { city: 'Las Vegas', state: 'NV' },
  { city: 'Portland', state: 'OR' },
  { city: 'San Francisco', state: 'CA' },
  { city: 'Boston', state: 'MA' },
  { city: 'Philadelphia', state: 'PA' },
  { city: 'Jacksonville', state: 'FL' },
  { city: 'Columbus', state: 'OH' },
  { city: 'Indianapolis', state: 'IN' },
  { city: 'Detroit', state: 'MI' },
  { city: 'Memphis', state: 'TN' },
  { city: 'Baltimore', state: 'MD' },
  { city: 'Milwaukee', state: 'WI' },
  { city: 'Albuquerque', state: 'NM' },
  { city: 'Tucson', state: 'AZ' },
  { city: 'Sacramento', state: 'CA' },
  { city: 'Kansas City', state: 'MO' },
  { city: 'Cleveland', state: 'OH' },
  { city: 'Pittsburgh', state: 'PA' },
  { city: 'Raleigh', state: 'NC' },
  { city: 'St Louis', state: 'MO' },
  { city: 'Cincinnati', state: 'OH' },
  { city: 'Oklahoma City', state: 'OK' },
  { city: 'Salt Lake City', state: 'UT' },
  { city: 'Richmond', state: 'VA' },
  { city: 'Birmingham', state: 'AL' },
  { city: 'New Orleans', state: 'LA' },
  { city: 'Louisville', state: 'KY' },
] as const;

/**
 * Generate a dedupe hash for a lead
 */
export function generateDedupeHash(companyName: string, website: string | null): string {
  const normalizedName = companyName.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  const normalizedDomain = website
    ? website
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split('/')[0]
    : '';

  return createHash('sha256')
    .update(`${normalizedName}|${normalizedDomain}`)
    .digest('hex');
}

/**
 * Build search queries for scraping
 */
export function buildSearchQueries(
  industries: string[],
  locations: Array<{ city: string; state: string }>,
  leadsPerQuery: number = 10
): SearchQuery[] {
  const queries: SearchQuery[] = [];

  for (const industry of industries) {
    for (const location of locations) {
      queries.push({
        industry,
        city: location.city,
        state: location.state,
        query: `${industry} companies in ${location.city}, ${location.state}`,
      });
    }
  }

  return queries;
}

/**
 * Parse owner name from text
 * Looks for patterns like "Owner: John Smith" or "Founded by John Smith"
 */
export function parseOwnerName(text: string): { firstName: string | null; lastName: string | null } {
  const patterns = [
    /(?:owner|founder|president|ceo|principal|proprietor)[\s:]+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i,
    /(?:owned by|founded by|run by)[\s:]+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i,
    /([A-Z][a-z]+)\s+([A-Z][a-z]+)[\s,]+(?:owner|founder|president|ceo)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        firstName: match[1],
        lastName: match[2],
      };
    }
  }

  return { firstName: null, lastName: null };
}

/**
 * Parse year founded from text
 */
export function parseYearFounded(text: string): string | null {
  const patterns = [
    /(?:since|established|founded|serving since|in business since)[\s:]+(\d{4})/i,
    /(\d{4})[\s-]+present/i,
    /over\s+(\d+)\s+years/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // If it's "over X years", calculate the year
      if (match[0].includes('years')) {
        const years = parseInt(match[1]);
        return String(new Date().getFullYear() - years);
      }
      return match[1];
    }
  }

  return null;
}

/**
 * Extract social links from HTML
 */
export function extractSocialLinks(html: string): {
  linkedin: string | null;
  facebook: string | null;
} {
  const linkedinMatch = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[^"'\s]+/i);
  const facebookMatch = html.match(/https?:\/\/(?:www\.)?facebook\.com\/[^"'\s]+/i);

  return {
    linkedin: linkedinMatch?.[0] || null,
    facebook: facebookMatch?.[0] || null,
  };
}

/**
 * BrightData Scraping Client
 * Uses BrightData's Web Scraper API for structured data extraction
 */
class BrightDataScraper {
  private apiKey: string;
  private zoneId: string;

  constructor(apiKey: string, zoneId: string = 'web_unlocker') {
    this.apiKey = apiKey;
    this.zoneId = zoneId;
  }

  /**
   * Search Google for businesses
   */
  async searchGoogle(query: string, numResults: number = 20): Promise<any[]> {
    const response = await fetch(`${BRIGHTDATA_API_BASE}/serp/google`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        num_results: numResults,
        gl: 'us',
        hl: 'en',
      }),
    });

    if (!response.ok) {
      throw new Error(`BrightData search error: ${response.status}`);
    }

    const data = await response.json();
    return data.organic_results || [];
  }

  /**
   * Scrape a webpage and extract content as markdown
   */
  async scrapeWebpage(url: string): Promise<string> {
    const response = await fetch(`${BRIGHTDATA_API_BASE}/web_scraper`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        zone: this.zoneId,
        format: 'markdown',
      }),
    });

    if (!response.ok) {
      throw new Error(`BrightData scrape error: ${response.status}`);
    }

    const data = await response.json();
    return data.content || '';
  }

  /**
   * Scrape Google Maps for business listings
   */
  async scrapeGoogleMaps(query: string, location: string): Promise<any[]> {
    const response = await fetch(`${BRIGHTDATA_API_BASE}/datasets/gd_google_maps`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        location,
        language: 'en',
        limit: 20,
      }),
    });

    if (!response.ok) {
      throw new Error(`BrightData Google Maps error: ${response.status}`);
    }

    const data = await response.json();
    return data.results || [];
  }
}

/**
 * Lead Scraper Service
 */
class LeadScraperService {
  private brightData: BrightDataScraper | null = null;

  constructor(brightDataApiKey?: string) {
    if (brightDataApiKey) {
      this.brightData = new BrightDataScraper(brightDataApiKey);
    }
  }

  /**
   * Scrape leads for a specific query
   */
  async scrapeLeads(
    searchQuery: SearchQuery,
    targetCount: number = 10
  ): Promise<ScrapedLead[]> {
    const leads: ScrapedLead[] = [];

    if (!this.brightData) {
      console.warn('BrightData not configured, using mock data');
      return this.getMockLeads(searchQuery, targetCount);
    }

    try {
      // Search Google Maps for business listings
      const mapResults = await this.brightData.scrapeGoogleMaps(
        searchQuery.query,
        `${searchQuery.city}, ${searchQuery.state}`
      );

      for (const result of mapResults.slice(0, targetCount)) {
        const lead: ScrapedLead = {
          companyName: result.name || 'Unknown Company',
          website: result.website || null,
          phone: result.phone || null,
          address: result.address || null,
          city: searchQuery.city,
          state: searchQuery.state,
          zipCode: result.postal_code || null,
          ownerFirstName: null,
          ownerLastName: null,
          googleRating: result.rating || null,
          googleReviewCount: result.reviews_count || null,
          yearFounded: null,
          linkedinUrl: null,
          facebookUrl: null,
          sourceUrl: result.url || `https://google.com/maps?q=${encodeURIComponent(result.name)}`,
        };

        // Try to scrape website for more details
        if (lead.website) {
          try {
            await this.enrichLeadFromWebsite(lead);
          } catch (error) {
            console.error(`Failed to enrich lead from website: ${error}`);
          }
        }

        leads.push(lead);

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error('Error scraping leads:', error);
    }

    return leads;
  }

  /**
   * Enrich lead with data from company website
   */
  private async enrichLeadFromWebsite(lead: ScrapedLead): Promise<void> {
    if (!this.brightData || !lead.website) return;

    try {
      // Try about page first
      const aboutUrls = [
        `${lead.website}/about`,
        `${lead.website}/about-us`,
        `${lead.website}/our-team`,
        `${lead.website}/company`,
      ];

      for (const url of aboutUrls) {
        try {
          const content = await this.brightData.scrapeWebpage(url);

          // Parse owner name
          const owner = parseOwnerName(content);
          if (owner.firstName && owner.lastName) {
            lead.ownerFirstName = owner.firstName;
            lead.ownerLastName = owner.lastName;
          }

          // Parse year founded
          const year = parseYearFounded(content);
          if (year) {
            lead.yearFounded = year;
          }

          // Extract social links
          const social = extractSocialLinks(content);
          if (social.linkedin) lead.linkedinUrl = social.linkedin;
          if (social.facebook) lead.facebookUrl = social.facebook;

          // If we found owner info, stop looking
          if (lead.ownerFirstName) break;
        } catch {
          // URL might not exist, continue to next
        }
      }
    } catch (error) {
      console.error('Error enriching lead:', error);
    }
  }

  /**
   * Get mock leads for testing (when BrightData not available)
   */
  private getMockLeads(query: SearchQuery, count: number): ScrapedLead[] {
    const leads: ScrapedLead[] = [];
    const companyPrefixes = ['ABC', 'Pro', 'Elite', 'Premier', 'Quality', 'Expert', 'Master'];
    const companySuffixes = ['Services', 'Solutions', 'Company', 'Inc', 'LLC', 'Pros'];

    for (let i = 0; i < count; i++) {
      const prefix = companyPrefixes[Math.floor(Math.random() * companyPrefixes.length)];
      const suffix = companySuffixes[Math.floor(Math.random() * companySuffixes.length)];
      const industry = query.industry.charAt(0).toUpperCase() + query.industry.slice(1);

      leads.push({
        companyName: `${prefix} ${industry} ${suffix}`,
        website: `https://www.${prefix.toLowerCase()}${industry.toLowerCase()}${query.city.toLowerCase()}.com`,
        phone: `555-${String(Math.floor(Math.random() * 900) + 100)}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        address: `${Math.floor(Math.random() * 9999) + 1} Main Street`,
        city: query.city,
        state: query.state,
        zipCode: String(Math.floor(Math.random() * 90000) + 10000),
        ownerFirstName: ['John', 'Mike', 'David', 'James', 'Robert'][Math.floor(Math.random() * 5)],
        ownerLastName: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones'][Math.floor(Math.random() * 5)],
        googleRating: Math.round((Math.random() * 2 + 3) * 10) / 10,
        googleReviewCount: Math.floor(Math.random() * 500) + 10,
        yearFounded: String(Math.floor(Math.random() * 40) + 1980),
        linkedinUrl: null,
        facebookUrl: null,
        sourceUrl: `https://google.com/maps?q=${encodeURIComponent(`${prefix} ${industry} ${suffix} ${query.city}`)}`,
      });
    }

    return leads;
  }
}

/**
 * Create a lead scraper service instance
 */
export function createLeadScraperService(brightDataApiKey?: string): LeadScraperService {
  return new LeadScraperService(brightDataApiKey);
}

export default LeadScraperService;
