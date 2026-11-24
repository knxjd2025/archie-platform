import { useMemo, useState } from 'react';
import type { TeamRole } from '../../../shared/rbac';
import { decisionFor } from '../../../shared/roof-reports';
import { useAuth } from '../lib/auth';
import { useCompany } from '../lib/company';
import { browserStorage, draftKey, markWizardOpen, readDraft, tabStorage, wasWizardOpen } from '../roof-reports/draft';
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
  const { user } = useAuth();
  const company = useCompany();
  const key = useMemo(() => draftKey(company.id, user?.email), [company.id, user?.email]);
  // A refresh puts the person back in the wizard they were in, with their draft; a new visit starts at the list.
  const [making, setMaking] = useState(() => !!key && wasWizardOpen(tabStorage(), key) && readDraft(browserStorage(), key) !== null);
  const setWizard = (open: boolean) => { if (key) markWizardOpen(tabStorage(), key, open); setMaking(open); };
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
            onClick={() => setWizard(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-brand text-on-brand hover:bg-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            {RR.page.make}
          </button>
        )}
      </div>
      {making ? <Wizard onClose={() => setWizard(false)} /> : <ReportList role={role} />}
    </div>
  );
}
