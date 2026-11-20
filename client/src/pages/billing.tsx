import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { BILLING_CHANGED_EVENT } from '../lib/billing';
import {
  PLAN_LABEL, PRICES_CENTS, PRICING_EXAMPLES, TEAM_INCLUDED_SEATS, describeQuote, formatDollars, quoteForSeats, type Quote,
} from '../../../shared/billing/pricing';
import type { Banner, LockReason } from '../../../shared/billing/status';

/**
 * The Billing page (admins): what the team costs, the trial, the next bill,
 * and the buttons that open Stripe (add a card, or manage billing). The
 * prices come from shared/billing/pricing.ts, the same module the server
 * bills from. When the company is locked this is the only page admins see.
 */

interface BillingPageData {
  enabled: boolean;
  locked: boolean;
  reason: LockReason | null;
  banner: Banner | null;
  seats: number;
  quote: Quote;
  billedPlan: 'solo' | 'team' | null;
  billedSeats: number | null;
  status: string | null;
  trialEndsAt: string | null;
  nextBillDate: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
  hasSubscription: boolean;
  seatSyncError: boolean;
}

const LOCK_TEXT: Record<LockReason, { title: string; body: string }> = {
  trial_ended: { title: 'Your free trial has ended.', body: 'Add a card to keep using Archie. Everything you entered is kept.' },
  payment_problem: { title: 'There is a problem with your payment.', body: 'Update your card to keep using Archie. Everything you entered is kept.' },
};

const STATUS_TEXT: Record<string, string> = {
  active: 'Active',
  trialing: 'Free trial, card on file',
  past_due: 'Payment past due',
  unpaid: 'Unpaid',
  canceled: 'Cancelled',
  incomplete: 'Waiting for the first payment',
  incomplete_expired: 'First payment failed',
  paused: 'Paused',
};

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

const card = 'bg-white rounded-xl border border-gray-200';
const primaryBtn = 'inline-flex w-full sm:w-auto items-center justify-center rounded-lg bg-brand text-on-brand px-5 py-3 text-sm font-semibold hover:bg-brand-dark transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand';
const secondaryBtn = 'inline-flex w-full sm:w-auto items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-gray-900 break-words">{value}</dd>
    </div>
  );
}

function PricingTable() {
  return (
    <section className={`${card} p-4 sm:p-5`} aria-labelledby="how-pricing-works">
      <h2 id="how-pricing-works" className="text-base font-semibold text-gray-900">How pricing works</h2>
      <p className="mt-1 text-sm text-gray-600">
        You pay for the people who can sign in. People on your team who cannot sign in are free.
      </p>
      <ul className="mt-3 space-y-1.5 text-sm text-gray-700">
        <li><b>Solo</b>: {formatDollars(PRICES_CENTS.solo_base)}/month for 1 person. A 2nd person is {formatDollars(PRICES_CENTS.solo_extra)} more.</li>
        <li><b>Team</b>: {formatDollars(PRICES_CENTS.team_base)}/month includes {TEAM_INCLUDED_SEATS} people. Each person after that is {formatDollars(PRICES_CENTS.team_extra)}.</li>
        <li>Your plan changes on its own as your team grows or shrinks.</li>
      </ul>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
            <th scope="col" className="py-2 pr-2 font-medium">People</th>
            <th scope="col" className="py-2 pr-2 font-medium">Plan</th>
            <th scope="col" className="py-2 text-right font-medium">Per month</th>
          </tr>
        </thead>
        <tbody>
          {PRICING_EXAMPLES.map((n) => {
            const q = quoteForSeats(n);
            return (
              <tr key={n} className="border-b border-gray-100 last:border-0">
                <td className="py-2 pr-2 text-gray-900">{n}</td>
                <td className="py-2 pr-2 text-gray-700">{PLAN_LABEL[q.plan]}</td>
                <td className="py-2 text-right font-medium text-gray-900">{formatDollars(q.monthlyTotalCents)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export default function BillingPage({ returned }: { returned?: string | null }) {
  const [data, setData] = useState<BillingPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'checkout' | 'portal' | null>(null);

  const load = useCallback(() => {
    api.get<BillingPageData>('/api/billing')
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load billing.'));
  }, []);
  useEffect(() => {
    load();
    // Back from Stripe: the webhook may land a moment after the person does.
    if (returned) {
      window.dispatchEvent(new CustomEvent(BILLING_CHANGED_EVENT));
      const t = setTimeout(() => { load(); window.dispatchEvent(new CustomEvent(BILLING_CHANGED_EVENT)); }, 4000);
      return () => clearTimeout(t);
    }
  }, [load, returned]);

  const go = async (what: 'checkout' | 'portal') => {
    if (busy) return;
    setBusy(what);
    setError(null);
    try {
      const r = await api.post<{ url: string }>(`/api/billing/${what}`);
      window.location.assign(r.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open Stripe. Try again.');
      setBusy(null);
    }
  };

  if (!data && !error) {
    return <div className="max-w-3xl mx-auto"><div className="h-40 rounded-xl bg-gray-100 animate-pulse" /></div>;
  }
  if (!data) {
    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
        <p className="mt-3 text-sm text-red-700">{error}</p>
      </div>
    );
  }
  if (!data.enabled) {
    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
        <p className="mt-3 text-sm text-gray-600">Billing is not set up yet.</p>
      </div>
    );
  }

  const lock = data.reason ? LOCK_TEXT[data.reason] : null;
  const pastDue = data.status === 'past_due';
  const showAddCard = !data.hasSubscription;
  const showPortal = data.hasCustomer;
  const portalLabel = data.reason === 'payment_problem' || pastDue ? 'Update card' : 'Manage billing';
  const trialDate = formatDate(data.trialEndsAt);
  const trialOver = data.trialEndsAt ? new Date(data.trialEndsAt).getTime() <= Date.now() : false;
  const billedDiffers = data.hasSubscription && data.billedSeats !== null && data.billedSeats !== data.quote.seats;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
        <p className="mt-1 text-sm text-gray-600">Your plan, what it costs, and your card.</p>
      </div>

      {returned === 'success' && !lock && (
        <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          Thank you. Your card was added. It can take a minute for this page to catch up.
        </div>
      )}

      {lock && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-base font-semibold text-red-900">{lock.title}</p>
          <p className="mt-1 text-sm text-red-800">{lock.body}</p>
          <div className="mt-3">
            {data.reason === 'payment_problem' && showPortal ? (
              <button type="button" onClick={() => go('portal')} disabled={!!busy} className={primaryBtn}>
                {busy === 'portal' ? 'Opening Stripe…' : 'Update card'}
              </button>
            ) : (
              <button type="button" onClick={() => go('checkout')} disabled={!!busy} className={primaryBtn}>
                {busy === 'checkout' ? 'Opening Stripe…' : 'Add card'}
              </button>
            )}
          </div>
        </div>
      )}

      {!lock && pastDue && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          There is a problem with your payment. Update your card to keep using Archie.
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <section className={`${card} p-4 sm:p-5`} aria-labelledby="your-plan">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="your-plan" className="text-base font-semibold text-gray-900">Your plan: {PLAN_LABEL[data.quote.plan]}</h2>
          <p className="text-2xl font-bold text-gray-900">{formatDollars(data.quote.monthlyTotalCents)}<span className="text-sm font-medium text-gray-500">/month</span></p>
        </div>
        <p className="mt-1 text-sm text-gray-600">
          {data.seats === 1 ? '1 person can sign in.' : `${data.seats} people can sign in.`}
          {data.seats === 0 && ' You are billed for 1.'}
        </p>
        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800">{describeQuote(data.quote)}</p>
        {billedDiffers && (
          <p className="mt-2 text-xs text-gray-500">Your subscription is being updated to match your team. This can take up to an hour.</p>
        )}

        <dl className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Fact label="Status" value={data.status ? (STATUS_TEXT[data.status] ?? data.status) : trialOver ? 'Trial ended' : 'Free trial, no card yet'} />
          <Fact label={trialOver ? 'Free trial ended' : 'Free trial ends'} value={trialDate || 'No trial'} />
          <Fact
            label={data.cancelAtPeriodEnd ? 'Ends on' : 'Next bill'}
            value={data.nextBillDate ? formatDate(data.nextBillDate) : data.hasSubscription ? 'Not known yet' : 'After you add a card'}
          />
        </dl>
        {data.cancelAtPeriodEnd && (
          <p className="mt-3 text-sm text-amber-800">Your subscription is set to end on {formatDate(data.nextBillDate)}. Use Manage billing to keep it.</p>
        )}

        {!lock && (showAddCard || showPortal) && (
          <div className="mt-5 flex flex-col sm:flex-row gap-2">
            {showAddCard && (
              <button type="button" onClick={() => go('checkout')} disabled={!!busy} className={primaryBtn}>
                {busy === 'checkout' ? 'Opening Stripe…' : 'Add card'}
              </button>
            )}
            {showPortal && (
              <button type="button" onClick={() => go('portal')} disabled={!!busy} className={showAddCard ? secondaryBtn : primaryBtn}>
                {busy === 'portal' ? 'Opening Stripe…' : portalLabel}
              </button>
            )}
          </div>
        )}
        {/* Stripe can only hold the first charge for a trial that ends 48 hours or more from now (server/billing/service.ts). */}
        {showAddCard && !lock && data.trialEndsAt && new Date(data.trialEndsAt).getTime() - Date.now() >= 49 * 60 * 60 * 1000 && (
          <p className="mt-2 text-xs text-gray-500">You will not be charged before your free trial ends on {trialDate}.</p>
        )}
        <p className="mt-3 text-xs text-gray-500">Cards are handled by Stripe. Archie never sees or stores your card number.</p>
      </section>

      <PricingTable />
    </div>
  );
}
