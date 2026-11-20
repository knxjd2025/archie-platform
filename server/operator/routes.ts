/**
 * The operator console: /api/operator/*. For the people who run Archie
 * (ARCHIE_OPERATOR_EMAILS), not for anyone inside a roofing company.
 *
 *   GET  /api/operator/companies                      every company, with counts (?q= &limit= &offset=)
 *   GET  /api/operator/companies/:id                  one company: team, integrations, recent actions
 *   POST /api/operator/companies                      create a company and its first admin; returns a welcome link
 *   POST /api/operator/companies/:id/status           { status }: pause, resume or cancel
 *   POST /api/operator/companies/:id/members/:memberId/reset-link
 *                                                     a 1-hour set-password link for one member
 *
 * One guard covers the whole prefix and checks the allowlist again on every
 * request. Every change writes a row to operator_audit_log. Links are shown
 * to the operator once and never stored or logged in readable form.
 */
import type { Express, NextFunction, Request, Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { isOperatorEmail } from './allowlist';
import { rateLimit } from '../lib/rate-limit';
import { isCompanyId, runAsCompany } from '../tenant/context';
import { provisionCompany } from '../seed';
import { createTeamMember } from '../storage/team';
import { validateTeamMemberInput } from '../storage/team-validate';
import { mintPasswordLink, passwordLinkUrl, PASSWORD_LINK_TTL_MS } from '../auth/password-links';
import { defaultTrialEnd } from '../tenant/companies';
import { isLiveCompany } from '../../shared/company';
import { afterSeatChange } from '../billing/service';
import {
  COMPANY_STATUSES, audit, emailTaken, freeSlug, getCompany, getCompanyDetail, getMember, listCompanies,
  setCompanyStatus, type CompanyStatus,
} from './store';

const TEN_MINUTES = 10 * 60 * 1000;
const DUPLICATE_KEY = '23505';
const MAX_NAME = 120;

const tooFast = (_req: Request, res: Response) =>
  res.json({ error: 'Too many requests. Wait a few minutes and try again.' });
/** Reads: generous, for someone clicking around the list. */
const readLimit = rateLimit(300, TEN_MINUTES, tooFast);
/** Changes: each one can sign a whole company out or mint a sign-in link. */
const writeLimit = rateLimit(30, TEN_MINUTES, tooFast);

/**
 * The one gate: a normal signed-in session (requireAuth re-checks it against
 * the roster), and that person's email on ARCHIE_OPERATOR_EMAILS right now.
 * A company admin who is not on the list gets 403 like anyone else.
 */
export function requireOperator(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    const email = req.session?.user?.email;
    if (!isOperatorEmail(email)) {
      if (email) console.warn(`[operator] refused ${req.method} ${req.path} for ${email}: not an operator`);
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  });
}

const operatorEmail = (req: Request): string => String(req.session.user!.email).toLowerCase();

/** A company id from the URL, or null. Nothing else ever names the company. */
const companyIdParam = (req: Request): string | null => (isCompanyId(req.params.id) ? req.params.id.toLowerCase() : null);

/** Express 4 does not catch a rejected promise; answer 500 without internals. */
const handle = (what: string, fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      console.error(`[operator] ${what} failed`, err);
      if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Try again.' });
    });
  };

const cleanText = (v: unknown, max = MAX_NAME): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

export function registerOperatorRoutes(app: Express): void {
  app.use('/api/operator', requireOperator, readLimit);

  app.get('/api/operator/companies', handle('list companies', async (req, res) => {
    const result = await listCompanies({
      q: typeof req.query.q === 'string' ? req.query.q : '',
      limit: Number(req.query.limit) || undefined,
      offset: Number(req.query.offset) || undefined,
    });
    res.json(result);
  }));

  app.get('/api/operator/companies/:id', handle('read company', async (req, res) => {
    const id = companyIdParam(req);
    const detail = id ? await getCompanyDetail(id) : null;
    if (!detail) return res.status(404).json({ error: 'No such company.' });
    res.json(detail);
  }));

  app.post('/api/operator/companies', writeLimit, handle('create company', async (req, res) => {
    const name = cleanText(req.body?.companyName);
    const adminName = cleanText(req.body?.adminName);
    const adminEmail = cleanText(req.body?.adminEmail, 254).toLowerCase();
    if (!name) return res.status(400).json({ error: 'Enter the company name.' });
    if (!adminName) return res.status(400).json({ error: "Enter the admin's name." });
    const admin = validateTeamMemberInput({ name: adminName, email: adminEmail, role: 'admin', canLogin: true });
    if (!admin.ok) return res.status(400).json({ error: "Enter the admin's email address." });
    if (await emailTaken(admin.value.email)) {
      return res.status(409).json({ error: 'That email is already on a team in Archie. Each person can be in one company for now.' });
    }

    const slug = await freeSlug(name);
    const trialEndsAt = defaultTrialEnd();
    const { company, seeded, error: seedError } = await provisionCompany({ slug, name, status: 'trial', trialEndsAt });
    const by = operatorEmail(req);
    let token: string;
    try {
      token = await runAsCompany(company.id, async () => {
        await createTeamMember(admin.value, `operator:${by}`);
        return mintPasswordLink(admin.value.email, 'welcome');
      }, { loadProfile: false });
    } catch (err: any) {
      // The company exists but has no admin yet (the email was taken a moment
      // ago by someone else). Recorded so the operator can see it.
      await audit({ operatorEmail: by, action: 'company.create', companyId: company.id, details: { name, slug, adminEmail: admin.value.email, adminAdded: false } });
      const code = err?.code ?? err?.cause?.code;
      if (code === DUPLICATE_KEY) {
        return res.status(409).json({ error: 'The company was made, but that email is already on a team in Archie, so it has no admin yet.' });
      }
      throw err;
    }
    await audit({
      operatorEmail: by, action: 'company.create', companyId: company.id,
      details: { name, slug, adminName: admin.value.name, adminEmail: admin.value.email, adminAdded: true, seeded, trialEndsAt: trialEndsAt.toISOString() },
    });
    if (!seeded) console.error(`[operator] company ${slug} was created but not seeded: ${seedError}`);
    // A new company has no subscription yet, so this does nothing today; kept so
    // every change to who can sign in goes through the same seat sync.
    await afterSeatChange(company.id, 'the operator added the first admin');
    res.status(201).json({
      company: { id: company.id, name: company.name, slug: company.slug, status: company.status, trialEndsAt: trialEndsAt.toISOString() },
      admin: { name: admin.value.name, email: admin.value.email },
      seeded,
      welcomeLink: passwordLinkUrl(token),
      linkExpiresAt: new Date(Date.now() + PASSWORD_LINK_TTL_MS.welcome).toISOString(),
    });
  }));

  app.post('/api/operator/companies/:id/status', writeLimit, handle('change status', async (req, res) => {
    const id = companyIdParam(req);
    if (!id) return res.status(404).json({ error: 'No such company.' });
    const status = req.body?.status;
    if (!(COMPANY_STATUSES as readonly string[]).includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${COMPANY_STATUSES.join(', ')}.` });
    }
    // The operator signs in through a company too. Pausing that one would sign
    // them out and lock them out of this page.
    if (!isLiveCompany({ status }) && req.session.user!.companyId === id) {
      return res.status(400).json({ error: 'This is the company you sign in through. Pausing or cancelling it would lock you out of Archie.' });
    }
    const result = await setCompanyStatus(id, status as CompanyStatus, operatorEmail(req));
    if (!result) return res.status(404).json({ error: 'No such company.' });
    res.json({ ok: true, ...result });
  }));

  app.post('/api/operator/companies/:id/members/:memberId/reset-link', writeLimit, handle('make reset link', async (req, res) => {
    const id = companyIdParam(req);
    const memberId = Number(req.params.memberId);
    if (!id || !Number.isInteger(memberId) || memberId < 1) return res.status(404).json({ error: 'No such person.' });
    const company = await getCompany(id);
    const member = company ? await getMember(id, memberId) : null;
    if (!company || !member) return res.status(404).json({ error: 'No such person.' });
    // A link that could not be used would only confuse the person who gets it.
    if (!isLiveCompany(company)) {
      return res.status(400).json({ error: 'This company is paused or cancelled, so nobody in it can sign in. Resume it first.' });
    }
    if (!member.active || !member.canLogin) {
      return res.status(400).json({ error: 'This person is not allowed to sign in. Their company admin can turn sign-in on from the Team page.' });
    }
    const token = await runAsCompany(id, () => mintPasswordLink(member.email, 'reset'), { loadProfile: false });
    await audit({
      operatorEmail: operatorEmail(req), action: 'member.reset_link', companyId: id,
      details: { memberId: member.id, email: member.email },
    });
    res.json({
      link: passwordLinkUrl(token),
      email: member.email,
      expiresAt: new Date(Date.now() + PASSWORD_LINK_TTL_MS.reset).toISOString(),
    });
  }));
}
