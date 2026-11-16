/**
 * For admins only: a slim reminder at the top of the app while the company
 * has not connected KynexPro. It blocks nothing, and goes away once connected.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { CONNECTIONS_CHANGED_EVENT } from '../pages/integrations/ui';

export default function KynexProBanner({ isAdmin, onConnect }: { isAdmin: boolean; onConnect: () => void }) {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!isAdmin) { setMissing(false); return; }
    let live = true;
    const check = () => api.get<{ connected: boolean }>('/api/integrations/ghl/connection')
      .then((r) => { if (live) setMissing(!r.connected); })
      .catch(() => { /* say nothing rather than nag on a failed check */ });
    void check();
    window.addEventListener(CONNECTIONS_CHANGED_EVENT, check);
    return () => { live = false; window.removeEventListener(CONNECTIONS_CHANGED_EVENT, check); };
  }, [isAdmin]);

  if (!isAdmin || !missing) return null;
  return (
    <div role="status" className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
        <span>Connect KynexPro to turn on texts, email and calls.</span>
        <button
          type="button"
          onClick={onConnect}
          className="font-semibold underline underline-offset-2 hover:text-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
        >
          Connect
        </button>
      </div>
    </div>
  );
}
