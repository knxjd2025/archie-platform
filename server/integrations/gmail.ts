/**
 * Google Workspace Integration (Gmail, Calendar, Drive) using Google OAuth2
 */
import { google, Auth } from 'googleapis';
import { boardTz } from '../../shared/schedule-board';
import { perCompany } from '../tenant/per-company';

export interface GmailTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export class GmailClient {
  private oauth2Client: Auth.OAuth2Client;
  private tokens: GmailTokens | null = null;
  private gmail: any = null;
  private calendar: any = null;
  private drive: any = null;

  constructor() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';

    if (!clientId || !clientSecret) {
      console.warn('Google OAuth not configured - missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
    }

    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );
  }

  getAuthUrl(): string {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.error('Google OAuth not configured - missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
      return '';
    }

    const scopes = [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
    });
  }

  async exchangeCodeForTokens(code: string): Promise<GmailTokens> {
    const { tokens } = await this.oauth2Client.getToken(code);

    const gmailTokens: GmailTokens = {
      access_token: tokens.access_token || '',
      refresh_token: tokens.refresh_token || '',
      expiry_date: tokens.expiry_date || Date.now() + 3600000,
    };

    this.setTokens(gmailTokens);
    return gmailTokens;
  }

  setTokens(tokens: GmailTokens) {
    this.tokens = tokens;
    this.oauth2Client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    });
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
    this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
  }

  isConnected(): boolean {
    return this.tokens !== null;
  }

  async healthCheck(): Promise<{ ok: boolean; email?: string; error?: string }> {
    if (!this.tokens) {
      return { ok: false, error: 'Google not connected' };
    }

    try {
      const profile = await this.gmail.users.getProfile({ userId: 'me' });
      return { ok: true, email: profile.data.emailAddress || undefined };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  }

  async getUserInfo(): Promise<{ email?: string; name?: string }> {
    try {
      const profile = await this.gmail.users.getProfile({ userId: 'me' });
      return { email: profile.data.emailAddress || undefined };
    } catch (error) {
      return {};
    }
  }

  // ==================== GMAIL ====================

  async getProfile() {
    if (!this.gmail) throw new Error('Google not initialized');
    const response = await this.gmail.users.getProfile({ userId: 'me' });
    return response.data;
  }

  async getMessages(options: { maxResults?: number; query?: string; pageToken?: string } = {}) {
    if (!this.gmail) throw new Error('Google not initialized');

    const response = await this.gmail.users.messages.list({
      userId: 'me',
      maxResults: options.maxResults || 20,
      q: options.query,
      pageToken: options.pageToken,
    });

    return {
      messages: response.data.messages || [],
      nextPageToken: response.data.nextPageToken,
    };
  }

  async getMessage(messageId: string) {
    if (!this.gmail) throw new Error('Google not initialized');

    const response = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    return response.data;
  }

  async sendEmail(params: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    html?: string;
  }) {
    if (!this.gmail) throw new Error('Google not initialized');

    const utf8Subject = `=?utf-8?B?${Buffer.from(params.subject).toString('base64')}?=`;

    const messageParts = [
      `To: ${params.to}`,
      params.cc ? `Cc: ${params.cc}` : '',
      `Subject: ${utf8Subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      params.html || params.body,
    ];

    const message = messageParts.join('\n');
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage },
    });

    return { id: response.data.id, threadId: response.data.threadId };
  }

  async createDraft(params: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    html?: string;
  }) {
    if (!this.gmail) throw new Error('Google not initialized');

    const utf8Subject = `=?utf-8?B?${Buffer.from(params.subject).toString('base64')}?=`;

    const messageParts = [
      `To: ${params.to}`,
      params.cc ? `Cc: ${params.cc}` : '',
      `Subject: ${utf8Subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      params.html || params.body,
    ];

    const message = messageParts.join('\n');
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await this.gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw: encodedMessage } },
    });

    return { id: response.data.id };
  }

  async searchMessages(query: string, maxResults: number = 20) {
    return this.getMessages({ query, maxResults });
  }

  async getUnreadCount(): Promise<number> {
    if (!this.gmail) throw new Error('Google not initialized');

    const response = await this.gmail.users.labels.get({
      userId: 'me',
      id: 'INBOX',
    });

    return response.data.messagesUnread || 0;
  }

  async getLabels() {
    if (!this.gmail) throw new Error('Google not initialized');

    const response = await this.gmail.users.labels.list({ userId: 'me' });
    return response.data.labels || [];
  }

  async markAsRead(messageId: string): Promise<boolean> {
    if (!this.gmail) throw new Error('Google not initialized');

    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });

    return true;
  }

  // ==================== GOOGLE CALENDAR ====================

  async getCalendarList() {
    if (!this.calendar) throw new Error('Google Calendar not initialized');

    const response = await this.calendar.calendarList.list();
    return response.data.items || [];
  }

  async getCalendarEvents(params: {
    calendarId?: string;
    maxResults?: number;
    timeMin?: string;
    timeMax?: string;
    q?: string;
  } = {}) {
    if (!this.calendar) throw new Error('Google Calendar not initialized');

    const now = new Date();
    const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const response = await this.calendar.events.list({
      calendarId: params.calendarId || 'primary',
      timeMin: params.timeMin || now.toISOString(),
      timeMax: params.timeMax || thirtyDaysOut.toISOString(),
      maxResults: params.maxResults || 20,
      singleEvents: true,
      orderBy: 'startTime',
      q: params.q,
    });

    return response.data.items || [];
  }

  async createCalendarEvent(params: {
    summary: string;
    description?: string;
    location?: string;
    start: string;
    end: string;
    attendees?: string[];
    calendarId?: string;
  }) {
    if (!this.calendar) throw new Error('Google Calendar not initialized');

    const event: any = {
      summary: params.summary,
      description: params.description,
      location: params.location,
      start: { dateTime: params.start, timeZone: boardTz() },
      end: { dateTime: params.end, timeZone: boardTz() },
    };

    if (params.attendees?.length) {
      event.attendees = params.attendees.map(email => ({ email }));
    }

    const response = await this.calendar.events.insert({
      calendarId: params.calendarId || 'primary',
      requestBody: event,
      sendUpdates: 'all',
    });

    return response.data;
  }

  // ==================== GOOGLE DRIVE ====================

  async listDriveFiles(params: {
    maxResults?: number;
    query?: string;
    folderId?: string;
  } = {}) {
    if (!this.drive) throw new Error('Google Drive not initialized');

    let q = params.query || '';
    if (params.folderId) {
      q = q ? `${q} and '${params.folderId}' in parents` : `'${params.folderId}' in parents`;
    }
    // Exclude trashed files
    q = q ? `${q} and trashed = false` : 'trashed = false';

    const response = await this.drive.files.list({
      pageSize: params.maxResults || 20,
      fields: 'files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,thumbnailLink,parents)',
      q,
      orderBy: 'modifiedTime desc',
    });

    return response.data.files || [];
  }

  async getDriveFile(fileId: string) {
    if (!this.drive) throw new Error('Google Drive not initialized');

    const response = await this.drive.files.get({
      fileId,
      fields: 'id,name,mimeType,size,createdTime,modifiedTime,webViewLink,thumbnailLink,description',
    });

    return response.data;
  }

  async createDriveFolder(name: string, parentFolderId?: string) {
    if (!this.drive) throw new Error('Google Drive not initialized');

    const fileMetadata: any = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };

    if (parentFolderId) {
      fileMetadata.parents = [parentFolderId];
    }

    const response = await this.drive.files.create({
      requestBody: fileMetadata,
      fields: 'id,name,webViewLink',
    });

    return response.data;
  }

  async uploadFileToDrive(params: {
    name: string;
    content: string;
    mimeType: string;
    folderId?: string;
  }) {
    if (!this.drive) throw new Error('Google Drive not initialized');

    const { Readable } = await import('stream');
    const stream = Readable.from([params.content]);

    const fileMetadata: any = { name: params.name };
    if (params.folderId) {
      fileMetadata.parents = [params.folderId];
    }

    const response = await this.drive.files.create({
      requestBody: fileMetadata,
      media: { mimeType: params.mimeType, body: stream },
      fields: 'id,name,webViewLink',
    });

    return response.data;
  }

  // ==================== REVOKE ====================

  async revokeAccess() {
    if (this.tokens?.access_token) {
      await this.oauth2Client.revokeToken(this.tokens.access_token);
    }
    this.tokens = null;
    this.gmail = null;
    this.calendar = null;
    this.drive = null;
  }
}

/** The current company's own client: OAuth tokens never cross companies. */
export const getGmailClient: () => GmailClient = perCompany('Gmail', () => new GmailClient());
