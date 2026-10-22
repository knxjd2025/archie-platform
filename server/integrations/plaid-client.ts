import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  RemovedTransaction,
} from 'plaid';
import { db } from '../db';
import { plaidItems, plaidTransactions } from '../../shared/schema';
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';

export interface PlaidAccount {
  accountId: string;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  balances: {
    current: number | null;
    available: number | null;
  };
  institutionName?: string;
}

export interface PlaidTx {
  transactionId: string;
  accountId: string;
  amount: number;
  date: string;
  name: string;
  merchantName: string | null;
  category: string[] | null;
  pending: boolean;
  paymentChannel: string | null;
}

export class PlaidClient {
  private client: PlaidApi;
  private available: boolean;

  constructor() {
    const clientId = process.env.PLAID_CLIENT_ID || '';
    const secret = process.env.PLAID_SECRET || '';
    const env = (process.env.PLAID_ENVIRONMENT || 'sandbox') as keyof typeof PlaidEnvironments;

    this.available = !!(clientId && secret);

    if (!this.available) {
      console.warn('PLAID_CLIENT_ID or PLAID_SECRET not set - Plaid integration will be limited');
    }

    const configuration = new Configuration({
      basePath: PlaidEnvironments[env] || PlaidEnvironments.sandbox,
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': clientId,
          'PLAID-SECRET': secret,
        },
      },
    });

    this.client = new PlaidApi(configuration);
  }

  // Create a Link token for the frontend Plaid Link component
  async createLinkToken(): Promise<string> {
    if (!this.available) throw new Error('Plaid not configured');

    const response = await this.client.linkTokenCreate({
      user: { client_user_id: 'bestroofing-admin' },
      client_name: 'Best Roofing Now',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    });

    return response.data.link_token;
  }

  // Exchange public token from Plaid Link for a persistent access token
  async exchangePublicToken(
    publicToken: string,
    institutionId?: string,
    institutionName?: string
  ): Promise<{ itemId: string }> {
    if (!this.available) throw new Error('Plaid not configured');

    const response = await this.client.itemPublicTokenExchange({
      public_token: publicToken,
    });

    const { access_token, item_id } = response.data;

    // Get account info
    const accountsResponse = await this.client.accountsGet({
      access_token,
    });

    const accounts = accountsResponse.data.accounts.map((a) => ({
      accountId: a.account_id,
      name: a.name,
      officialName: a.official_name,
      type: a.type,
      subtype: a.subtype,
      mask: a.mask,
    }));

    // Store in database
    await db.insert(plaidItems).values({
      itemId: item_id,
      accessToken: access_token,
      institutionId: institutionId || null,
      institutionName: institutionName || null,
      status: 'active',
      accounts: accounts,
    });

    return { itemId: item_id };
  }

  // Get all linked accounts across all banks
  async getAccounts(): Promise<PlaidAccount[]> {
    const items = await db
      .select()
      .from(plaidItems)
      .where(eq(plaidItems.status, 'active'));

    const allAccounts: PlaidAccount[] = [];

    for (const item of items) {
      try {
        const response = await this.client.accountsGet({
          access_token: item.accessToken,
        });

        for (const account of response.data.accounts) {
          allAccounts.push({
            accountId: account.account_id,
            name: account.name,
            officialName: account.official_name,
            type: account.type,
            subtype: account.subtype,
            mask: account.mask,
            balances: {
              current: account.balances.current,
              available: account.balances.available,
            },
            institutionName: item.institutionName || undefined,
          });
        }
      } catch (error: any) {
        console.error(`Plaid error for item ${item.itemId}:`, error.message);
      }
    }

    return allAccounts;
  }

  // Get real-time balances (always hits Plaid API)
  async getBalances(): Promise<PlaidAccount[]> {
    const items = await db
      .select()
      .from(plaidItems)
      .where(eq(plaidItems.status, 'active'));

    const allBalances: PlaidAccount[] = [];

    for (const item of items) {
      try {
        const response = await this.client.accountsBalanceGet({
          access_token: item.accessToken,
        });

        for (const account of response.data.accounts) {
          allBalances.push({
            accountId: account.account_id,
            name: account.name,
            officialName: account.official_name,
            type: account.type,
            subtype: account.subtype,
            mask: account.mask,
            balances: {
              current: account.balances.current,
              available: account.balances.available,
            },
            institutionName: item.institutionName || undefined,
          });
        }
      } catch (error: any) {
        console.error(`Plaid balance error for item ${item.itemId}:`, error.message);
      }
    }

    return allBalances;
  }

  // Incremental transaction sync using cursor
  async syncTransactions(itemId?: string): Promise<{
    added: number;
    modified: number;
    removed: number;
  }> {
    const whereClause = itemId
      ? and(eq(plaidItems.status, 'active'), eq(plaidItems.itemId, itemId))
      : eq(plaidItems.status, 'active');

    const items = await db.select().from(plaidItems).where(whereClause);

    let totalAdded = 0;
    let totalModified = 0;
    let totalRemoved = 0;

    for (const item of items) {
      try {
        let hasMore = true;
        let cursor = item.cursor || undefined;

        while (hasMore) {
          const response = await this.client.transactionsSync({
            access_token: item.accessToken,
            cursor,
          });

          const { added, modified, removed, next_cursor, has_more } = response.data;

          // Insert new transactions
          for (const tx of added) {
            await db
              .insert(plaidTransactions)
              .values({
                plaidItemId: item.id,
                transactionId: tx.transaction_id,
                accountId: tx.account_id,
                amount: String(tx.amount),
                date: new Date(tx.date),
                name: tx.name,
                merchantName: tx.merchant_name || null,
                category: tx.personal_finance_category
                  ? [tx.personal_finance_category.primary, tx.personal_finance_category.detailed]
                  : tx.category || null,
                pending: tx.pending,
                paymentChannel: tx.payment_channel || null,
                rawData: tx as any,
              })
              .onConflictDoUpdate({
                target: plaidTransactions.transactionId,
                set: {
                  amount: String(tx.amount),
                  name: tx.name,
                  merchantName: tx.merchant_name || null,
                  pending: tx.pending,
                },
              });
          }

          // Update modified transactions
          for (const tx of modified) {
            await db
              .update(plaidTransactions)
              .set({
                amount: String(tx.amount),
                name: tx.name,
                merchantName: tx.merchant_name || null,
                pending: tx.pending,
              })
              .where(eq(plaidTransactions.transactionId, tx.transaction_id));
          }

          // Remove deleted transactions
          for (const tx of removed) {
            if (tx.transaction_id) {
              await db
                .delete(plaidTransactions)
                .where(eq(plaidTransactions.transactionId, tx.transaction_id));
            }
          }

          totalAdded += added.length;
          totalModified += modified.length;
          totalRemoved += removed.length;

          cursor = next_cursor;
          hasMore = has_more;
        }

        // Update cursor and last synced timestamp
        await db
          .update(plaidItems)
          .set({
            cursor: cursor,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(plaidItems.id, item.id));
      } catch (error: any) {
        console.error(`Plaid sync error for item ${item.itemId}:`, error.message);
      }
    }

    return { added: totalAdded, modified: totalModified, removed: totalRemoved };
  }

  // Get transactions from local cache
  async getTransactions(params?: {
    startDate?: string;
    endDate?: string;
    accountId?: string;
    institutionName?: string;
    limit?: number;
  }): Promise<PlaidTx[]> {
    const conditions = [];

    if (params?.startDate) {
      conditions.push(gte(plaidTransactions.date, new Date(params.startDate)));
    }
    if (params?.endDate) {
      conditions.push(lte(plaidTransactions.date, new Date(params.endDate)));
    }
    if (params?.accountId) {
      conditions.push(eq(plaidTransactions.accountId, params.accountId));
    }

    let query = db
      .select()
      .from(plaidTransactions)
      .orderBy(desc(plaidTransactions.date))
      .limit(params?.limit || 200);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    const rows = await query;

    return rows.map((r) => ({
      transactionId: r.transactionId,
      accountId: r.accountId,
      amount: Number(r.amount),
      date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
      name: r.name || '',
      merchantName: r.merchantName,
      category: r.category as string[] | null,
      pending: r.pending || false,
      paymentChannel: r.paymentChannel,
    }));
  }

  // Get linked bank institutions
  async getLinkedBanks(): Promise<
    Array<{
      id: number;
      itemId: string;
      institutionName: string | null;
      status: string | null;
      accountCount: number;
      lastSynced: string | null;
    }>
  > {
    const items = await db.select().from(plaidItems);
    return items.map((item) => ({
      id: item.id,
      itemId: item.itemId,
      institutionName: item.institutionName,
      status: item.status,
      accountCount: Array.isArray(item.accounts) ? item.accounts.length : 0,
      lastSynced: item.lastSyncedAt?.toISOString() || null,
    }));
  }

  // Remove a linked bank
  async removeItem(itemId: string): Promise<void> {
    const [item] = await db
      .select()
      .from(plaidItems)
      .where(eq(plaidItems.itemId, itemId));

    if (!item) throw new Error(`Plaid item not found: ${itemId}`);

    try {
      await this.client.itemRemove({ access_token: item.accessToken });
    } catch (e) {
      // Item may already be removed on Plaid's side
    }

    await db
      .update(plaidItems)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(eq(plaidItems.itemId, itemId));
  }

  // Health check
  async healthCheck(): Promise<{ ok: boolean; error?: string; linkedBanks?: number }> {
    if (!this.available) {
      return { ok: false, error: 'Plaid credentials not configured' };
    }

    try {
      const items = await db
        .select()
        .from(plaidItems)
        .where(eq(plaidItems.status, 'active'));

      return { ok: true, linkedBanks: items.length };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  }
}

// Singleton
let plaidInstance: PlaidClient | null = null;
export function getPlaidClient(): PlaidClient {
  if (!plaidInstance) {
    plaidInstance = new PlaidClient();
  }
  return plaidInstance;
}
