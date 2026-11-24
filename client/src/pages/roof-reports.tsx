import { useState } from 'react';
import type { TeamRole } from '../../../shared/rbac';
import { decisionFor } from '../../../shared/roof-reports';
import ReportList from '../roof-reports/ReportList';
import Wizard from '../roof-reports/Wizard';
import { RR } from '../roof-reports/words';

/**
 * Roof reports: the company's roof reports as a list, and the wizard that makes
 * a new one. The page is drawn only when the server has said the feature is on
 * for this person (App.tsx reads `roofReports` from /api/auth/me), and the
 * server answers every request here itself, so nothing below is a lock.
 */
export default function RoofReportsPage({ role }: { role: TeamRole }) {
  const [making, setMaking] = useState(false);
  const mayMake = decisionFor(role, 'make') !== 'no';
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{RR.page.title}</h2>
          <p className="text-sm text-gray-500 mt-1">{RR.page.subtitle}</p>
        </div>
        {mayMake && !making && (
          <button
            type="button"
            onClick={() => setMaking(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-brand text-on-brand hover:bg-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            {RR.page.make}
          </button>
        )}
      </div>
      {making ? <Wizard onClose={() => setMaking(false)} /> : <ReportList role={role} />}
    </div>
  );
}
