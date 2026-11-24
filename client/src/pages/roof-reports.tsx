import type { TeamRole } from '../../../shared/rbac';
import ReportList from '../roof-reports/ReportList';
import { RR } from '../roof-reports/words';

/**
 * Roof reports: the company's roof reports, as a list. The page is drawn only
 * when the server has said the feature is on for this person (App.tsx reads
 * `roofReports` from /api/auth/me), and the server answers every request here
 * itself, so nothing below is a lock.
 */
export default function RoofReportsPage({ role }: { role: TeamRole }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{RR.page.title}</h2>
          <p className="text-sm text-gray-500 mt-1">{RR.page.subtitle}</p>
        </div>
      </div>
      <ReportList role={role} />
    </div>
  );
}
