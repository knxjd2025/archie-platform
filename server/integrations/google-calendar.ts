import { google, Auth } from 'googleapis';
import type { GmailTokens } from './gmail';

export interface CalendarEvent {
  summary: string;
  start: string;
  end?: string;
  location?: string;
}

export class GoogleCalendarClient {
  private oauth2Client: Auth.OAuth2Client;
  private calendar: any = null;
  private tokens: GmailTokens | null = null;

  constructor() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';
    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  setTokens(tokens: GmailTokens) {
    this.tokens = tokens;
    this.oauth2Client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    });
    this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    if (!this.tokens) return { ok: false, error: 'Calendar not connected' };
    try {
      await this.calendar.calendarList.list({ maxResults: 1 });
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  }

  async listEvents(params: {
    timeMin: string;
    timeMax: string;
    calendarId?: string;
    maxResults?: number;
  }): Promise<CalendarEvent[]> {
    if (!this.calendar) throw new Error('Calendar not initialized');
    const response = await this.calendar.events.list({
      calendarId: params.calendarId || 'primary',
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      maxResults: params.maxResults || 50,
      singleEvents: true,
      orderBy: 'startTime',
    });
    return (response.data.items || []).map((e: any) => ({
      summary: e.summary || 'Untitled event',
      start: e.start?.dateTime || e.start?.date || '',
      end: e.end?.dateTime || e.end?.date,
      location: e.location,
    }));
  }
}

let client: GoogleCalendarClient | null = null;
export function getGoogleCalendarClient(): GoogleCalendarClient {
  if (!client) client = new GoogleCalendarClient();
  return client;
}
