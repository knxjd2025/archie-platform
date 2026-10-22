/**
 * GoHighLevel API Client
 * Documentation: https://marketplace.gohighlevel.com/docs/
 *
 * This client handles all interactions with GoHighLevel including:
 * - Contacts management
 * - Conversations (SMS, email)
 * - Calendar and appointments
 * - Opportunities (sales pipeline)
 */

import { fetchWithTimeout } from '../lib/fetch-timeout';
import { toE164, last10Digits } from '../../shared/comms';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

/** How many fuzzy-search hits to check for an exact phone match. */
const PHONE_SEARCH_LIMIT = 20;

/**
 * The contact GHL already has, from its duplicate-contact refusal.
 *
 * With "allow duplicate contacts" off, POST /contacts answers 400 with
 * `{"message":"This location does not allow duplicated contacts.",
 * "meta":{"contactId":"..."}}`. That is not a failure for us — it names the
 * contact we were looking for.
 */
export function duplicateContactId(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error ?? '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  try {
    const body = JSON.parse(text.slice(start)) as { meta?: { contactId?: unknown }; contactId?: unknown };
    const id = body?.meta?.contactId ?? body?.contactId;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/** The contact in a search result whose phone is this number, or null. */
export function exactPhoneMatch<T extends { id: string; phone?: string }>(contacts: T[], phone: string): T | null {
  const want = last10Digits(phone);
  if (want.length < 10) return null;
  return contacts.find((c) => last10Digits(c.phone) === want) ?? null;
}

export interface GHLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  tags?: string[];
  customFields?: Record<string, any>;
  source?: string;
  dateAdded?: string;
}

export interface GHLConversation {
  id: string;
  contactId: string;
  type: 'SMS' | 'Email' | 'FB' | 'GMB' | 'IG' | 'WhatsApp';
  lastMessageType: string;
  lastMessageDate: string;
  unreadCount: number;
}

export interface GHLMessage {
  id: string;
  conversationId: string;
  type: number; // 1=SMS, 2=Email, etc
  direction: 'inbound' | 'outbound';
  status: string;
  body: string;
  dateAdded: string;
}

export interface GHLOpportunity {
  id: string;
  name: string;
  pipelineId: string;
  pipelineStageId: string;
  status: 'open' | 'won' | 'lost' | 'abandoned';
  monetaryValue?: number;
  contactId: string;
  assignedTo?: string;
  createdAt: string;
}

export class GoHighLevelClient {
  private accessToken: string;
  private locationId: string;
  private apiVersion: string = '2021-07-28';

  constructor() {
    // GHL_PIT_TOKEN (Private Integration Token) is the canonical credential —
    // same one server/brain/ghl-brain.ts uses. The other three are kept only
    // as a fallback for stale deploys; do not rely on them going forward.
    this.accessToken = process.env.GHL_PIT_TOKEN || process.env.GHL_LOCATION_API_KEY || process.env.GHL_AGENCY_API_KEY || process.env.GHL_ACCESS_TOKEN || '';
    this.locationId = process.env.GHL_LOCATION_ID || '';

    if (!this.accessToken) {
      console.warn('GHL API key not set - GoHighLevel integration will be limited');
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${GHL_API_BASE}${endpoint}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Version': this.apiVersion,
    };

    const response = await fetchWithTimeout(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GHL API Error (${response.status}): ${error}`);
    }

    return response.json();
  }

  // ==================== CONTACTS ====================

  async getContacts(params?: {
    limit?: number;
    query?: string;
    startAfter?: string;
  }): Promise<{ contacts: GHLContact[]; meta: any }> {
    const searchParams = new URLSearchParams({
      locationId: this.locationId,
      limit: String(params?.limit || 20),
    });

    if (params?.query) searchParams.set('query', params.query);
    if (params?.startAfter) searchParams.set('startAfter', params.startAfter);

    return this.request(`/contacts/?${searchParams}`);
  }

  async getContact(contactId: string): Promise<{ contact: GHLContact }> {
    return this.request(`/contacts/${contactId}`);
  }

  async createContact(contact: Partial<GHLContact>): Promise<{ contact: GHLContact }> {
    return this.request('/contacts/', {
      method: 'POST',
      body: JSON.stringify({
        ...contact,
        locationId: this.locationId,
      }),
    });
  }

  /** A note on the contact's GHL timeline (how a call placed from the app gets recorded). */
  async addContactNote(contactId: string, body: string): Promise<{ note: { id: string } }> {
    return this.request(`/contacts/${contactId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  async updateContact(contactId: string, updates: Partial<GHLContact>): Promise<{ contact: GHLContact }> {
    return this.request(`/contacts/${contactId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async addTagToContact(contactId: string, tags: string[]): Promise<{ tags: string[] }> {
    return this.request(`/contacts/${contactId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tags }),
    });
  }

  // ==================== CONVERSATIONS ====================

  async getConversations(
    contactId?: string,
    opts: { limit?: number; startAfterDate?: number } = {},
  ): Promise<{ conversations: GHLConversation[] }> {
    const searchParams = new URLSearchParams({
      locationId: this.locationId,
    });

    if (contactId) searchParams.set('contactId', contactId);
    // Without a limit GHL answers with its default of 20, newest first.
    if (opts.limit) {
      searchParams.set('limit', String(Math.min(Math.max(Math.floor(opts.limit), 1), 100)));
      searchParams.set('sortBy', 'last_message_date');
      searchParams.set('sort', 'desc');
    }
    if (opts.startAfterDate) searchParams.set('startAfterDate', String(opts.startAfterDate));

    return this.request(`/conversations/search?${searchParams}`);
  }

  async getMessages(conversationId: string): Promise<{ messages: GHLMessage[] }> {
    return this.request(`/conversations/${conversationId}/messages`);
  }

  async sendSms(
    phone: string,
    message: string,
    contactId?: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // If we don't have a contactId, try to find or create the contact
      let targetContactId = contactId;

      if (!targetContactId) {
        targetContactId = await this.contactIdForPhone(phone);
      }

      // Send the message
      const result = await this.request<{ conversationId: string; messageId: string }>('/conversations/messages', {
        method: 'POST',
        body: JSON.stringify({
          type: 'SMS',
          contactId: targetContactId,
          message,
        }),
      });

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error: any) {
      console.error('GHL SMS Error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * The GHL contact for exactly this number, created if there is none.
   *
   * GHL's contact `query` is a fuzzy search across names, emails and phones,
   * and this used to text whoever came back first — so a signing link meant
   * for one customer went to a stranger whose record merely resembled the
   * number. Only a contact whose phone has the same last ten digits counts.
   */
  async contactIdForPhone(phone: string): Promise<string> {
    const e164 = toE164(phone);
    if (!e164 || e164.includes('@')) throw new Error(`"${phone}" is not a phone number we can text`);

    const searchResult = await this.getContacts({ query: last10Digits(e164), limit: PHONE_SEARCH_LIMIT });
    const match = exactPhoneMatch(searchResult.contacts || [], e164);
    if (match) return match.id;

    try {
      const newContact = await this.createContact({ phone: e164 });
      return newContact.contact.id;
    } catch (error) {
      const existing = duplicateContactId(error);
      if (existing) return existing;
      throw error;
    }
  }

  async sendEmail(
    contactId: string,
    subject: string,
    body: string,
    html?: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const result = await this.request<{ messageId: string }>('/conversations/messages', {
        method: 'POST',
        body: JSON.stringify({
          type: 'Email',
          contactId,
          subject,
          message: body,
          html: html || body,
        }),
      });

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error: any) {
      console.error('GHL Email Error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ==================== OPPORTUNITIES (PIPELINE) ====================

  async getOpportunities(params?: {
    pipelineId?: string;
    status?: string;
    limit?: number;
  }): Promise<{ opportunities: GHLOpportunity[] }> {
    const searchParams = new URLSearchParams({
      location_id: this.locationId,
      limit: String(params?.limit || 20),
    });

    if (params?.pipelineId) searchParams.set('pipeline_id', params.pipelineId);
    if (params?.status) searchParams.set('status', params.status);

    return this.request(`/opportunities/search?${searchParams}`);
  }

  async createOpportunity(opportunity: {
    name: string;
    pipelineId: string;
    pipelineStageId: string;
    contactId: string;
    monetaryValue?: number;
    status?: string;
  }): Promise<{ opportunity: GHLOpportunity }> {
    return this.request('/opportunities/', {
      method: 'POST',
      body: JSON.stringify({
        ...opportunity,
        locationId: this.locationId,
      }),
    });
  }

  async updateOpportunityStage(
    opportunityId: string,
    pipelineStageId: string
  ): Promise<{ opportunity: GHLOpportunity }> {
    return this.request(`/opportunities/${opportunityId}`, {
      method: 'PUT',
      body: JSON.stringify({ pipelineStageId }),
    });
  }

  // ==================== CALENDAR ====================

  async getCalendars(): Promise<{ calendars: any[] }> {
    return this.request(`/calendars/?locationId=${this.locationId}`);
  }

  async getAppointments(params: {
    calendarId: string;
    startTime: string;
    endTime: string;
  }): Promise<{ events: any[] }> {
    const searchParams = new URLSearchParams({
      locationId: this.locationId,
      calendarId: params.calendarId,
      startTime: params.startTime,
      endTime: params.endTime,
    });

    return this.request(`/calendars/events?${searchParams}`);
  }

  /** The location's GHL users (reps), so a GHL calendar can be matched to a roster email. */
  async getUsers(): Promise<{ users: any[] }> {
    return this.request(`/users/?locationId=${this.locationId}`);
  }

  /** Every appointment assigned to one GHL user across all calendars. Times are epoch milliseconds. */
  async getUserAppointments(params: { userId: string; startTime: number; endTime: number }): Promise<{ events: any[] }> {
    const searchParams = new URLSearchParams({
      locationId: this.locationId,
      userId: params.userId,
      startTime: String(params.startTime),
      endTime: String(params.endTime),
    });
    return this.request(`/calendars/events?${searchParams}`);
  }

  async createAppointment(appointment: {
    calendarId: string;
    contactId: string;
    title: string;
    startTime: string;
    endTime: string;
    appointmentStatus?: string;
  }): Promise<{ event: any }> {
    return this.request('/calendars/events', {
      method: 'POST',
      body: JSON.stringify({
        ...appointment,
        locationId: this.locationId,
      }),
    });
  }

  // ==================== WEBHOOKS ====================

  async registerWebhook(params: {
    targetUrl: string;
    eventTypes: string[];
  }): Promise<{ webhook: any }> {
    return this.request('/webhooks/', {
      method: 'POST',
      body: JSON.stringify({
        ...params,
        locationId: this.locationId,
      }),
    });
  }

  // ==================== UTILITY ====================

  /**
   * Parse incoming webhook payload from GHL
   */
  parseWebhookPayload(payload: any): {
    eventType: string;
    data: any;
  } {
    return {
      eventType: payload.type || payload.eventType || 'unknown',
      data: payload,
    };
  }

  /**
   * Convert GHL contact to our lead format
   */
  contactToLead(contact: GHLContact): {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    source: string;
    externalId: string;
  } {
    return {
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      address: contact.address1,
      city: contact.city,
      state: contact.state,
      zip: contact.postalCode,
      source: 'gohighlevel',
      externalId: contact.id,
    };
  }

  /**
   * Check if API is configured and working
   * Uses the contacts endpoint as it's commonly available with the contacts.readonly scope
   */
  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    if (!this.accessToken || !this.locationId) {
      return {
        ok: false,
        error: 'Missing GHL Private Integration Token (GHL_PIT_TOKEN) or GHL_LOCATION_ID. Create a Private Integration in GHL Settings > Integrations > Private Integrations.',
      };
    }

    try {
      // Use contacts endpoint with limit=1 as it requires only contacts.readonly scope
      await this.request<any>(`/contacts/?locationId=${this.locationId}&limit=1`);
      return { ok: true };
    } catch (error: any) {
      // Provide helpful error message for common issues
      if (error.message.includes('Invalid JWT')) {
        return {
          ok: false,
          error: 'Invalid JWT - Ensure you are using a Private Integration Token (not an old API key). Create one in GHL Settings > Integrations > Private Integrations with the required scopes.',
        };
      }
      return {
        ok: false,
        error: error.message,
      };
    }
  }
}
