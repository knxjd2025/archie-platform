/**
 * Instantly.ai Integration
 *
 * Handles all communication with the Instantly.ai API for cold email campaigns.
 * Instantly provides:
 * - Automatic email warm-up
 * - Multi-inbox rotation
 * - Deliverability monitoring
 * - Campaign management
 * - Lead tracking
 */

const INSTANTLY_API_BASE = 'https://api.instantly.ai/api/v1';

export interface InstantlyLead {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  personalization?: string;
  website?: string;
  phone?: string;
  custom_variables?: Record<string, string>;
}

export interface InstantlyCampaign {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'completed' | 'draft';
  created_at: string;
}

export interface InstantlyWebhookEvent {
  event_type: 'email_sent' | 'email_opened' | 'email_clicked' | 'email_replied' | 'email_bounced' | 'email_unsubscribed';
  timestamp: string;
  email_id: string;
  lead_email: string;
  campaign_id: string;
  data?: Record<string, any>;
}

export interface InstantlyAnalytics {
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
}

class InstantlyClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: any
  ): Promise<T> {
    const url = `${INSTANTLY_API_BASE}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify({ ...body, api_key: this.apiKey }) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Instantly API error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.listCampaigns();
      return true;
    } catch (error) {
      console.error('Instantly connection test failed:', error);
      return false;
    }
  }

  /**
   * List all campaigns
   */
  async listCampaigns(): Promise<InstantlyCampaign[]> {
    return this.request<InstantlyCampaign[]>('/campaign/list', 'POST', {
      api_key: this.apiKey,
    });
  }

  /**
   * Get campaign details
   */
  async getCampaign(campaignId: string): Promise<InstantlyCampaign> {
    return this.request<InstantlyCampaign>('/campaign/get', 'POST', {
      api_key: this.apiKey,
      campaign_id: campaignId,
    });
  }

  /**
   * Get campaign analytics
   */
  async getCampaignAnalytics(campaignId: string): Promise<InstantlyAnalytics> {
    return this.request<InstantlyAnalytics>('/analytics/campaign/summary', 'POST', {
      api_key: this.apiKey,
      campaign_id: campaignId,
    });
  }

  /**
   * Add a single lead to a campaign
   */
  async addLead(campaignId: string, lead: InstantlyLead): Promise<{ status: string; lead_id?: string }> {
    return this.request('/lead/add', 'POST', {
      api_key: this.apiKey,
      campaign_id: campaignId,
      skip_if_in_workspace: true, // Prevent duplicates across workspace
      ...lead,
    });
  }

  /**
   * Add multiple leads to a campaign (batch)
   */
  async addLeadsBatch(
    campaignId: string,
    leads: InstantlyLead[]
  ): Promise<{ status: string; added: number; skipped: number }> {
    // Instantly recommends batches of 100 max
    const batchSize = 100;
    let totalAdded = 0;
    let totalSkipped = 0;

    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = leads.slice(i, i + batchSize);

      const result = await this.request<{ status: string; added?: number; skipped?: number }>(
        '/lead/add/bulk',
        'POST',
        {
          api_key: this.apiKey,
          campaign_id: campaignId,
          skip_if_in_workspace: true,
          leads: batch,
        }
      );

      totalAdded += result.added || batch.length;
      totalSkipped += result.skipped || 0;

      // Rate limiting: wait 1 second between batches
      if (i + batchSize < leads.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return {
      status: 'success',
      added: totalAdded,
      skipped: totalSkipped,
    };
  }

  /**
   * Get lead status
   */
  async getLeadStatus(email: string, campaignId?: string): Promise<{
    email: string;
    status: string;
    sent_count: number;
    open_count: number;
    click_count: number;
    reply_count: number;
  }> {
    return this.request('/lead/get', 'POST', {
      api_key: this.apiKey,
      email,
      campaign_id: campaignId,
    });
  }

  /**
   * Delete a lead from a campaign
   */
  async deleteLead(email: string, campaignId: string): Promise<{ status: string }> {
    return this.request('/lead/delete', 'POST', {
      api_key: this.apiKey,
      campaign_id: campaignId,
      delete_all_from_company: false,
      email,
    });
  }

  /**
   * Pause a campaign
   */
  async pauseCampaign(campaignId: string): Promise<{ status: string }> {
    return this.request('/campaign/set/status', 'POST', {
      api_key: this.apiKey,
      campaign_id: campaignId,
      status: 'paused',
    });
  }

  /**
   * Resume/activate a campaign
   */
  async activateCampaign(campaignId: string): Promise<{ status: string }> {
    return this.request('/campaign/set/status', 'POST', {
      api_key: this.apiKey,
      campaign_id: campaignId,
      status: 'active',
    });
  }

  /**
   * Get account sending limits and warm-up status
   */
  async getAccountStatus(): Promise<{
    daily_limit: number;
    emails_sent_today: number;
    warmup_enabled: boolean;
    warmup_reputation: number;
  }> {
    return this.request('/account/status', 'POST', {
      api_key: this.apiKey,
    });
  }
}

/**
 * Create an Instantly client instance
 */
export function createInstantlyClient(apiKey: string): InstantlyClient {
  return new InstantlyClient(apiKey);
}

/**
 * Validate Instantly webhook signature
 */
export function validateInstantlyWebhook(
  payload: string,
  signature: string,
  secret: string
): boolean {
  // Instantly uses HMAC-SHA256 for webhook signatures
  const crypto = require('crypto');
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Parse Instantly webhook event
 */
export function parseInstantlyWebhookEvent(body: any): InstantlyWebhookEvent {
  return {
    event_type: body.event_type,
    timestamp: body.timestamp,
    email_id: body.email_id,
    lead_email: body.lead_email || body.email,
    campaign_id: body.campaign_id,
    data: body.data,
  };
}

/**
 * Format lead for Instantly API
 */
export function formatLeadForInstantly(lead: {
  ownerEmail: string;
  ownerFirstName?: string | null;
  ownerLastName?: string | null;
  companyName: string;
  website?: string | null;
  phone?: string | null;
  personalizedSubjectLine?: string | null;
  personalizedFirstLine?: string | null;
  city?: string | null;
  state?: string | null;
  industry?: string | null;
  yearFounded?: string | null;
  googleRating?: string | null;
}): InstantlyLead {
  return {
    email: lead.ownerEmail,
    first_name: lead.ownerFirstName || undefined,
    last_name: lead.ownerLastName || undefined,
    company_name: lead.companyName,
    website: lead.website || undefined,
    phone: lead.phone || undefined,
    custom_variables: {
      personalized_subject: lead.personalizedSubjectLine || '',
      personalized_first_line: lead.personalizedFirstLine || '',
      city: lead.city || '',
      state: lead.state || '',
      industry: lead.industry || '',
      years_in_business: lead.yearFounded
        ? String(new Date().getFullYear() - parseInt(lead.yearFounded))
        : '',
      google_rating: lead.googleRating || '',
    },
  };
}

export default InstantlyClient;
