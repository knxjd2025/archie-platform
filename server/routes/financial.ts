import { Router, Request, Response } from 'express';
import { getQuickBooksClient } from '../integrations/quickbooks';
import { getPlaidClient } from '../integrations/plaid-client';
import { getEvereeClient } from '../integrations/everee';
import { sendUpstreamFailure } from '../lib/upstream';
import { sendFailure } from '../lib/failure';

const router = Router();

// ===========================
// QuickBooks Online Endpoints
// ===========================

// Start OAuth flow
router.get('/quickbooks/auth', (req: Request, res: Response) => {
  try {
    const qbo = getQuickBooksClient();
    const authUrl = qbo.getAuthUrl();
    res.redirect(authUrl);
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'QuickBooks', 'GET /api/financial/quickbooks/auth');
  }
});

// OAuth callback
router.get('/quickbooks/callback', async (req: Request, res: Response) => {
  try {
    const qbo = getQuickBooksClient();
    const callbackUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    await qbo.exchangeCodeForTokens(callbackUrl);
    // Redirect to a success page or settings
    res.redirect('/settings?qbo=connected');
  } catch (error: any) {
    console.error('QuickBooks OAuth error:', error);
    res.redirect('/settings?qbo=error&message=' + encodeURIComponent(error.message));
  }
});

// Connection status
router.get('/quickbooks/status', async (req: Request, res: Response) => {
  try {
    const qbo = getQuickBooksClient();
    const health = await qbo.healthCheck();
    res.json(health);
  } catch (error: any) {
    res.json({ ok: false, error: error.message });
  }
});

// Chart of Accounts
router.get('/quickbooks/accounts', async (req: Request, res: Response) => {
  try {
    const qbo = getQuickBooksClient();
    const accounts = await qbo.getChartOfAccounts();
    res.json({ accounts, count: accounts.length });
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'QuickBooks', 'GET /api/financial/quickbooks/accounts');
  }
});

// Profit & Loss Report
router.get('/quickbooks/profit-loss', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const qbo = getQuickBooksClient();
    const report = await qbo.getProfitAndLoss(
      startDate as string || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0],
      endDate as string || new Date().toISOString().split('T')[0]
    );
    res.json(report);
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'QuickBooks', 'GET /api/financial/quickbooks/profit-loss');
  }
});

// Balance Sheet
router.get('/quickbooks/balance-sheet', async (req: Request, res: Response) => {
  try {
    const qbo = getQuickBooksClient();
    const report = await qbo.getBalanceSheet(req.query.date as string);
    res.json(report);
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'QuickBooks', 'GET /api/financial/quickbooks/balance-sheet');
  }
});

// Expenses
router.get('/quickbooks/expenses', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, limit } = req.query;
    const qbo = getQuickBooksClient();
    const expenses = await qbo.getExpenses({
      startDate: startDate as string,
      endDate: endDate as string,
      limit: limit ? parseInt(limit as string) : undefined,
    });
    res.json({ expenses, count: expenses.length });
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'QuickBooks', 'GET /api/financial/quickbooks/expenses');
  }
});

// Vendors
router.get('/quickbooks/vendors', async (req: Request, res: Response) => {
  try {
    const qbo = getQuickBooksClient();
    const vendors = await qbo.getVendors();
    res.json({ vendors, count: vendors.length });
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'QuickBooks', 'GET /api/financial/quickbooks/vendors');
  }
});

// ===========================
// Plaid Endpoints
// ===========================

// Create Link token for frontend
router.post('/plaid/create-link-token', async (req: Request, res: Response) => {
  try {
    const plaid = getPlaidClient();
    const linkToken = await plaid.createLinkToken();
    res.json({ linkToken });
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'Plaid', 'POST /api/financial/plaid/create-link-token');
  }
});

// Exchange public token from Plaid Link
router.post('/plaid/exchange-token', async (req: Request, res: Response) => {
  try {
    const { publicToken, institutionId, institutionName } = req.body;
    if (!publicToken) {
      return res.status(400).json({ error: 'publicToken is required' });
    }

    const plaid = getPlaidClient();
    const result = await plaid.exchangePublicToken(publicToken, institutionId, institutionName);
    res.json({ success: true, ...result });
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'Plaid', 'POST /api/financial/plaid/exchange-token');
  }
});

// Get all linked accounts
router.get('/plaid/accounts', async (req: Request, res: Response) => {
  try {
    const plaid = getPlaidClient();
    const accounts = await plaid.getAccounts();
    res.json({ accounts, count: accounts.length });
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'Plaid', 'GET /api/financial/plaid/accounts');
  }
});

// Get real-time balances
router.get('/plaid/balances', async (req: Request, res: Response) => {
  try {
    const plaid = getPlaidClient();
    const balances = await plaid.getBalances();
    res.json({ balances, count: balances.length });
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'Plaid', 'GET /api/financial/plaid/balances');
  }
});

// Trigger transaction sync
router.post('/plaid/sync', async (req: Request, res: Response) => {
  try {
    const plaid = getPlaidClient();
    const result = await plaid.syncTransactions(req.body.itemId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'Plaid', 'POST /api/financial/plaid/sync');
  }
});

// Get cached transactions
router.get('/plaid/transactions', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, accountId, limit } = req.query;
    const plaid = getPlaidClient();
    const transactions = await plaid.getTransactions({
      startDate: startDate as string,
      endDate: endDate as string,
      accountId: accountId as string,
      limit: limit ? parseInt(limit as string) : undefined,
    });
    res.json({ transactions, count: transactions.length });
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'Plaid', 'GET /api/financial/plaid/transactions');
  }
});

// Get linked banks
router.get('/plaid/banks', async (req: Request, res: Response) => {
  try {
    const plaid = getPlaidClient();
    const banks = await plaid.getLinkedBanks();
    res.json({ banks, count: banks.length });
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'Plaid', 'GET /api/financial/plaid/banks');
  }
});

// Disconnect a bank
router.delete('/plaid/banks/:itemId', async (req: Request, res: Response) => {
  try {
    const plaid = getPlaidClient();
    await plaid.removeItem(req.params.itemId);
    res.json({ success: true });
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'Plaid', 'DELETE /api/financial/plaid/banks/:itemId');
  }
});

// ===========================
// Everee Endpoints
// ===========================

// Connection status
router.get('/everee/status', async (req: Request, res: Response) => {
  try {
    const everee = getEvereeClient();
    const health = await everee.healthCheck();
    res.json(health);
  } catch (error: any) {
    res.json({ ok: false, error: error.message });
  }
});

// Workers
router.get('/everee/workers', async (req: Request, res: Response) => {
  try {
    const everee = getEvereeClient();
    const type = req.query.type as 'employee' | 'contractor' | undefined;
    const workers = await everee.getWorkers({ type });
    res.json({ workers, count: workers.length });
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'Everee', 'GET /api/financial/everee/workers');
  }
});

// Payroll runs
router.get('/everee/payroll-runs', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, limit } = req.query;
    const everee = getEvereeClient();
    const runs = await everee.getPayrollRuns({
      startDate: startDate as string,
      endDate: endDate as string,
      limit: limit ? parseInt(limit as string) : undefined,
    });
    res.json({ payrollRuns: runs, count: runs.length });
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'Everee', 'GET /api/financial/everee/payroll-runs');
  }
});

// Payroll run details
router.get('/everee/payroll-runs/:id', async (req: Request, res: Response) => {
  try {
    const everee = getEvereeClient();
    const details = await everee.getPayrollRunDetails(req.params.id);
    res.json(details);
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'Everee', 'GET /api/financial/everee/payroll-runs/:id');
  }
});

// Pay statements for a worker
router.get('/everee/pay-statements/:workerId', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const everee = getEvereeClient();
    const statements = await everee.getPayStatements(req.params.workerId, {
      startDate: startDate as string,
      endDate: endDate as string,
    });
    res.json({ payStatements: statements, count: statements.length });
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'Everee', 'GET /api/financial/everee/pay-statements/:workerId');
  }
});

// Tax withholdings summary
router.get('/everee/tax-withholdings', async (req: Request, res: Response) => {
  try {
    const everee = getEvereeClient();
    const withholdings = await everee.getTaxWithholdings({
      year: req.query.year as string,
    });
    res.json({ withholdings, year: req.query.year || new Date().getFullYear() });
  } catch (error: any) {
    return sendUpstreamFailure(res, error, 'Everee', 'GET /api/financial/everee/tax-withholdings');
  }
});

// ===========================
// Aggregate Status
// ===========================

router.get('/status', async (req: Request, res: Response) => {
  try {
    const [qboHealth, plaidHealth, evereeHealth] = await Promise.all([
      getQuickBooksClient().healthCheck(),
      getPlaidClient().healthCheck(),
      getEvereeClient().healthCheck(),
    ]);

    res.json({
      quickbooks: qboHealth,
      plaid: plaidHealth,
      everee: evereeHealth,
    });
  } catch (error: any) {
    return sendFailure(res, error, 'GET /api/financial/status');
  }
});

export default router;
