/**
 * The calls the roof report screens make. Each one goes through the app's own
 * api client (session, plain-sentence errors, the sign-in and billing events),
 * except the photo upload, which needs progress and so lives in ./upload.ts.
 */
import { api } from '../lib/api';
import { listPath, type ListFilters, type Paging, type ReportRow } from './list-view';

export interface ReportPage extends Paging { reports: ReportRow[] }

export const fetchReports = (filters: ListFilters): Promise<ReportPage> => api.get<ReportPage>(listPath(filters));

export const archiveReport = (id: string): Promise<{ id: string; status: string }> =>
  api.post(`/api/roof-reports/${encodeURIComponent(id)}/archive`, undefined, { timeoutMs: 20_000 });

/** A job the person may pick, as the header search finds it (rep-scoped on the server). */
export interface JobResult { externalId: string | null; name: string; location: string | null }

export const searchJobs = (q: string): Promise<{ results: JobResult[] }> => api.get(`/api/search?q=${encodeURIComponent(q.trim())}`);
