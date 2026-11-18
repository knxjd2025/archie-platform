/**
 * For admins only: the free trial ends soon (from 5 days before), or a
 * payment is past due. Blocks nothing; the button opens the Billing page.
 */
import type { Banner } from '../../../shared/billing/status';

export default function BillingBanner({ banner, onOpen }: { banner: Banner | null; onOpen: () => void }) {
  if (!banner) return null;
  const urgent = banner.kind === 'past_due';
  return (
    <div role="status" className={`${urgent ? 'bg-red-50 border-red-200 text-red-900' : 'bg-blue-50 border-blue-200 text-blue-900'} border-b text-sm`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
        <span>{banner.text}</span>
        <button
          type="button"
          onClick={onOpen}
          className="font-semibold underline underline-offset-2 hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-current rounded"
        >
          {banner.action}
        </button>
      </div>
    </div>
  );
}
