import OAuthClient from 'intuit-oauth';
import { db } from '../db';
import { integrationTokens } from '../../shared/schema';
import { eq, and } from 'drizzle-orm';

export interface QBOAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType: string;
  CurrentBalance: number;
  Active: boolean;
}

export interface QBOExpense {
  Id: string;
  TxnDate: string;
  TotalAmt: number;
  DocNumber?: string;
  Line: Array<{
    Amount: number;
    Description?: string;
    AccountRef?: { value: string; name: string };
  }>;
  VendorRef?: { value: string; name: string };
}

export interface QBOVendor {
  Id: string;
  DisplayName: string;
  Balance: number;
  Active: boolean;
  PrimaryPhone?: { FreeFormNumber: string };
  PrimaryEmailAddr?: { Address: string };
}

export interface QBOInvoice {
  Id: string;
  DocNumber: string;
  TxnDate: string;
  DueDate: string;
  TotalAmt: number;
  Balance: number;
  CustomerRef: { value: string; name: string };
}

/** Intuit's access tokens last an hour; refresh tokens about 100 days. */
const ACCESS_TOKEN_LIFETIME_S = 3600;
const REFRESH_TOKEN_LIFETIME_S = 8726400;
/** Refresh this long before the stored expiry so a call never lands on a dying token. */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
/** The QBO query API's largest page. */
const QUERY_PAGE_SIZE = 1000;
/** Enough for any report this app runs, and a stop if a query matches far more. */
const QUERY_ROW_CAP = 10000;

/**
 * When the stored access token was issued, in epoch ms. A missing expiry
 * reads as issued at the epoch, so the token counts as expired and is
 * refreshed rather than trusted.
 */
export function tokenIssuedAt(expiresAt: Date | null | undefined, expiresInSeconds: number): number {
  if (!expiresAt) return 0;
  return expiresAt.getTime() - expiresInSeconds * 1000;
}

/** Whether the stored token should be refreshed before the next call. */
export function accessTokenNeedsRefresh(expiresAt: Date | null | undefined, now: number = Date.now()): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - EXPIRY_BUFFER_MS <= now;
}

const QBO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date safe to put in a QBO query or report URL. The dates arrive from
 * request query strings and agent tool calls and were interpolated straight
 * into `TxnDate >= '...'`, so a quote in one rewrote the query.
 */
export function qboDate(value: string): string {
  if (typeof value !== 'string' || !QBO_DATE.test(value)) {
    throw new Error(`QuickBooks dates must be YYYY-MM-DD (got "${String(value).slice(0, 40)}")`);
  }
  return value;
}

/** Whether a failed QBO call was a 401 — the client throws OAuthError with the status as `code`. */
export function isUnauthorized(error: unknown): boolean {
  const e = error as { code?: unknown; response?: { status?: unknown } } | null;
  return String(e?.code) === '401' || e?.response?.status === 401;
}

/**
 * The client's response carries the parsed body as `json` (and the raw text
 * as `body`); `text()` is not on the 4.x response, so calling it threw on
 * every request. Read whichever is there.
 */
function parseApiResponse<T>(response: unknown): T {
  const r = response as { json?: unknown; body?: unknown; text?: () => string };
  if (r.json !== undefined && r.json !== null && typeof r.json === 'object') return r.json as T;
  if (typeof r.body === 'string') return JSON.parse(r.body) as T;
  if (typeof r.text === 'function') return JSON.parse(r.text()) as T;
  throw new Error('QuickBooks returned an unreadable response');
}

export class QuickBooksClient {
  private oauthClient: OAuthClient;
  private realmId: string;
  private baseUrl: string;
  private accessTokenExpiresAt: Date | null = null;

  constructor() {
    this.realmId = process.env.QUICKBOOKS_REALM_ID || '';
    const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
    this.baseUrl = environment === 'production'
      ? 'https://quickbooks.api.intuit.com'
      : 'https://sandbox-quickbooks.api.intuit.com';

    this.oauthClient = new OAuthClient({
      clientId: process.env.QUICKBOOKS_CLIENT_ID || '',
      clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET || '',
      environment: environment as 'sandbox' | 'production',
      redirectUri: process.env.QUICKBOOKS_REDIRECT_URI || 'http://localhost:3000/api/auth/quickbooks/callback',
    });

    if (!process.env.QUICKBOOKS_CLIENT_ID) {
      console.warn('QUICKBOOKS_CLIENT_ID not set - QuickBooks integration will be limited');
    }
  }

  // ===== OAuth Methods =====

  getAuthUrl(): string {
    return this.oauthClient.authorizeUri({
      scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
      state: 'bestroofing-qbo',
    });
  }

  async exchangeCodeForTokens(url: string): Promise<void> {
    const authResponse = await this.oauthClient.createToken(url);
    const tokens = authResponse.getJson();

    // Extract realm ID from the callback URL
    const urlObj = new URL(url, 'http://localhost');
    const realmId = urlObj.searchParams.get('realmId');
    if (realmId) {
      this.realmId = realmId;
    }

    await this.saveTokensToDb(tokens);
  }

  async refreshTokensIfNeeded(force = false): Promise<boolean> {
    // Load tokens from DB
    const loaded = await this.loadTokensFromDb();
    if (!loaded) return false;

    // Check if token is expired (with 5-min buffer), measured against the
    // expiry we stored rather than against when this instance loaded it.
    if (!force && !accessTokenNeedsRefresh(this.accessTokenExpiresAt)) {
      return true;
    }

    try {
      const authResponse = await this.oauthClient.refresh();
      const tokens = authResponse.getJson();
      await this.saveTokensToDb(tokens);
      return true;
    } catch (error: any) {
      console.error('Failed to refresh QuickBooks token:', error.message);
      return false;
    }
  }

  async loadTokensFromDb(): Promise<boolean> {
    try {
      const [tokenRecord] = await db
        .select()
        .from(integrationTokens)
        .where(
          and(
            eq(integrationTokens.provider, 'quickbooks'),
            eq(integrationTokens.isActive, true)
          )
        )
        .limit(1);

      if (!tokenRecord?.accessToken) return false;

      // setToken without createdAt stamps the token as issued "now", so a
      // bearer that died an hour ago looked fresh on every cold start and every
      // call 401'd until someone reconnected QuickBooks. The issue time is
      // recovered from the stored expiry instead, so the client's own checks
      // (the refresh token's lifetime too) measure from when Intuit issued it.
      const raw = (tokenRecord.rawResponse ?? {}) as Record<string, unknown>;
      const expiresIn = typeof raw.expires_in === 'number' ? raw.expires_in : ACCESS_TOKEN_LIFETIME_S;
      const token = {
        access_token: tokenRecord.accessToken,
        refresh_token: tokenRecord.refreshToken || '',
        token_type: tokenRecord.tokenType || 'bearer',
        expires_in: expiresIn,
        x_refresh_token_expires_in:
          typeof raw.x_refresh_token_expires_in === 'number' ? raw.x_refresh_token_expires_in : REFRESH_TOKEN_LIFETIME_S,
        createdAt: tokenIssuedAt(tokenRecord.expiresAt, expiresIn),
      };
      this.oauthClient.setToken(token);
      this.accessTokenExpiresAt = tokenRecord.expiresAt;

      if (tokenRecord.realmId) {
        this.realmId = tokenRecord.realmId;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  private async saveTokensToDb(tokens: any): Promise<void> {
    // One transaction, because the deactivate and the insert were two
    // separate writes: a timeout between them left no active row at all, and
    // QuickBooks read as "not connected" until someone redid the OAuth flow.
    // Intuit rotates the refresh token on every refresh, so losing that row
    // loses the only credential that still works.
    await db.transaction(async (tx) => {
      // Deactivate old tokens
      await tx
        .update(integrationTokens)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(integrationTokens.provider, 'quickbooks'));

      // Insert new tokens
      await tx.insert(integrationTokens).values({
        provider: 'quickbooks',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenType: tokens.token_type || 'bearer',
        expiresAt: new Date(Date.now() + (tokens.expires_in || ACCESS_TOKEN_LIFETIME_S) * 1000),
        realmId: this.realmId,
        scope: 'com.intuit.quickbooks.accounting openid',
        rawResponse: tokens,
        isActive: true,
      });
    });
  }

  // ===== API Methods =====

  private async apiGet<T>(path: string): Promise<T> {
    const refreshed = await this.refreshTokensIfNeeded();
    if (!refreshed) {
      throw new Error('QuickBooks not connected - complete OAuth flow first');
    }

    const url = `${this.baseUrl}/v3/company/${this.realmId}${path}`;
    try {
      return parseApiResponse<T>(await this.callApi(url));
    } catch (error) {
      // A token can be revoked, or rotated by another instance, before its
      // stored expiry. Refresh once and retry rather than failing the report
      // on a credential we can still renew.
      if (!isUnauthorized(error)) throw error;
      const renewed = await this.refreshTokensIfNeeded(true);
      if (!renewed) throw error;
      return parseApiResponse<T>(await this.callApi(url));
    }
  }

  private callApi(url: string) {
    return this.oauthClient.makeApiCall({
      url,
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  }

  /**
   * Every row a query matches, not just the first page. MAXRESULTS alone
   * silently stopped at 500 Purchases, so a busy month's expense categories
   * came back short with nothing saying so. Pages with STARTPOSITION until a
   * short page or the cap.
   */
  private async queryAll<T>(entity: string, baseQuery: string, cap: number = QUERY_ROW_CAP): Promise<T[]> {
    const rows: T[] = [];
    let start = 1;
    while (rows.length < cap) {
      const pageSize = Math.min(QUERY_PAGE_SIZE, cap - rows.length);
      const query = `${baseQuery} STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
      const data = await this.apiGet<any>('/query?query=' + encodeURIComponent(query));
      const page: T[] = data.QueryResponse?.[entity] || [];
      rows.push(...page);
      if (page.length < pageSize) break;
      start += page.length;
    }
    return rows;
  }

  // Chart of Accounts
  async getChartOfAccounts(): Promise<QBOAccount[]> {
    return this.queryAll<QBOAccount>('Account', 'SELECT * FROM Account WHERE Active = true');
  }

  // Profit & Loss Report
  async getProfitAndLoss(startDate: string, endDate: string): Promise<any> {
    const data = await this.apiGet<any>(
      `/reports/ProfitAndLoss?start_date=${qboDate(startDate)}&end_date=${qboDate(endDate)}&minorversion=65`
    );
    return data;
  }

  // Balance Sheet Report
  async getBalanceSheet(date?: string): Promise<any> {
    const dateParam = date ? `?date=${qboDate(date)}&minorversion=65` : '?minorversion=65';
    const data = await this.apiGet<any>(`/reports/BalanceSheet${dateParam}`);
    return data;
  }

  // Expenses (Purchase objects)
  async getExpenses(params?: {
    startDate?: string;
    endDate?: string;
    limit?: number;
  }): Promise<QBOExpense[]> {
    let query = "SELECT * FROM Purchase";
    const conditions: string[] = [];

    if (params?.startDate) conditions.push(`TxnDate >= '${qboDate(params.startDate)}'`);
    if (params?.endDate) conditions.push(`TxnDate <= '${qboDate(params.endDate)}'`);
    if (conditions.length) query += ` WHERE ${conditions.join(' AND ')}`;

    return this.queryAll<QBOExpense>('Purchase', query, params?.limit || QUERY_ROW_CAP);
  }

  // Expenses grouped by account/category
  async getExpensesByCategory(startDate: string, endDate: string): Promise<Record<string, number>> {
    const expenses = await this.getExpenses({ startDate, endDate });
    const categories: Record<string, number> = {};

    for (const expense of expenses) {
      for (const line of expense.Line || []) {
        const category = line.AccountRef?.name || 'Uncategorized';
        categories[category] = (categories[category] || 0) + (line.Amount || 0);
      }
    }

    return categories;
  }

  // Vendors
  async getVendors(): Promise<QBOVendor[]> {
    return this.queryAll<QBOVendor>('Vendor', 'SELECT * FROM Vendor WHERE Active = true');
  }

  // Invoices (for reconciliation with JobTread)
  async getInvoices(params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<QBOInvoice[]> {
    let query = "SELECT * FROM Invoice";
    const conditions: string[] = [];

    if (params?.startDate) conditions.push(`TxnDate >= '${qboDate(params.startDate)}'`);
    if (params?.endDate) conditions.push(`TxnDate <= '${qboDate(params.endDate)}'`);
    if (conditions.length) query += ` WHERE ${conditions.join(' AND ')}`;

    return this.queryAll<QBOInvoice>('Invoice', query);
  }

  // Health check
  async healthCheck(): Promise<{ ok: boolean; error?: string; companyName?: string }> {
    try {
      const loaded = await this.loadTokensFromDb();
      if (!loaded) {
        return { ok: false, error: 'Not connected - OAuth required' };
      }

      const data = await this.apiGet<any>(
        '/query?query=' + encodeURIComponent("SELECT * FROM CompanyInfo")
      );
      const company = data.QueryResponse?.CompanyInfo?.[0];
      return {
        ok: true,
        companyName: company?.CompanyName || 'Connected',
      };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  }
}

// Singleton
let qboInstance: QuickBooksClient | null = null;
export function getQuickBooksClient(): QuickBooksClient {
  if (!qboInstance) {
    qboInstance = new QuickBooksClient();
  }
  return qboInstance;
}
