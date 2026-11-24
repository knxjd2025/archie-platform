import { useEffect, useMemo, useState } from 'react';
import type { TeamRole } from '../../../shared/rbac';
import { decisionFor } from '../../../shared/roof-reports';
import { useAuth } from '../lib/auth';
import { useCompany } from '../lib/company';
import { sweepExpiredRoofReportDrafts } from '../roof-reports/draft-clean';
import { browserStorage, draftKey, markWizardOpen, readDraft, tabStorage, wasWizardOpen } from '../roof-reports/draft';
import Comparison from '../roof-reports/Comparison';
import Editor from '../roof-reports/Editor';
import type { JobStart } from '../roof-reports/job-prefill';
import ReportList from '../roof-reports/ReportList';
import Wizard from '../roof-reports/Wizard';
import { RR } from '../roof-reports/words';

type View = { kind: 'list'; notice: string | null } | { kind: 'wizard' } | { kind: 'editor'; id: string } | { kind: 'compare'; a: string; b: string };

/**
 * Roof reports: the company's roof reports as a list, the wizard that makes a
 * new one, and the editor for one that is made. The page is drawn only when the
 * server has said the feature is on for this person (App.tsx reads
 * `roofReports` from /api/auth/me), and the server answers every request here
 * itself, so nothing below is a lock.
 *
 * `prefill` (from a job's page) opens the wizard with that job; `openId` (from a
 * job's page) opens that report in the editor.
 */
export default function RoofReportsPage({ role, prefill, openId }: { role: TeamRole; prefill?: JobStart | null; openId?: string | null }) {
  const { user } = useAuth();
  const company = useCompany();
  const key = useMemo(() => draftKey(company.id, user?.email), [company.id, user?.email]);
  // A refresh puts the person back in the wizard they were in, with their draft; a new visit starts at the list.
  const [view, setView] = useState<View>(() => {
    if (openId) return { kind: 'editor', id: openId };
    if (prefill) return { kind: 'wizard' };
    return !!key && wasWizardOpen(tabStorage(), key) && readDraft(browserStorage(), key) !== null ? { kind: 'wizard' } : { kind: 'list', notice: null };
  });
  const setWizard = (open: boolean) => {
    if (key) markWizardOpen(tabStorage(), key, open);
    setView(open ? { kind: 'wizard' } : { kind: 'list', notice: null });
  };
  // Any draft past its day, of anyone who used this browser, is cleared whenever this page loads.
  useEffect(() => { sweepExpiredRoofReportDrafts(); }, []);
  const mayMake = decisionFor(role, 'make') !== 'no';
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{RR.page.title}</h2>
          <p className="text-sm text-gray-500 mt-1">{RR.page.subtitle}</p>
        </div>
        {mayMake && view.kind === 'list' && (
          <button
            type="button"
            onClick={() => setWizard(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-brand text-on-brand hover:bg-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            {RR.page.make}
          </button>
        )}
      </div>
      {view.kind === 'wizard' && (
        <Wizard
          prefill={prefill}
          onClose={() => setWizard(false)}
          onDone={(id) => { if (key) markWizardOpen(tabStorage(), key, false); setView({ kind: 'editor', id }); }}
        />
      )}
      {view.kind === 'editor' && (
        <Editor
          key={view.id}
          id={view.id}
          role={role}
          onBack={() => setView({ kind: 'list', notice: null })}
          onArchived={() => setView({ kind: 'list', notice: RR.editor.archived })}
        />
      )}
      {view.kind === 'compare' && <Comparison key={`${view.a}-${view.b}`} a={view.a} b={view.b} onBack={() => setView({ kind: 'list', notice: null })} />}
      {view.kind === 'list' && <ReportList role={role} notice={view.notice} onOpen={(id) => setView({ kind: 'editor', id })} onCompare={(a, b) => setView({ kind: 'compare', a, b })} />}
    </div>
  );
}
