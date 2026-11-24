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

/** Takes back a photo that was saved but is not in a report yet, so its stored copy goes and it stops counting toward the day's waiting photos. */
export const removeReportPhoto = (photoId: string): Promise<{ id: string; removed: boolean }> =>
  api.delete(`/api/roof-reports/photos/${encodeURIComponent(photoId)}`, { timeoutMs: 20_000 });

/**
 * Makes a report. The call lasts until the report ends (up to about five minutes on this hosting), so it has its own long
 * timeout. The key is made once for each try: the same request with the same key returns the first report and starts nothing.
 */
export const generateReport = (body: unknown, key: string): Promise<unknown> =>
  api.post('/api/roof-reports/generate', body, { timeoutMs: 330_000, headers: { 'Idempotency-Key': key } });

/** Runs a report that could not finish again, from what was typed and the photos it has. */
export const retryReport = (id: string): Promise<unknown> => api.post(`/api/roof-reports/${encodeURIComponent(id)}/retry`, undefined, { timeoutMs: 330_000 });

/** One report as the editor opens it, with its photos and, when it is ready, its contents. */
export const fetchReport = (id: string): Promise<unknown> => api.get(`/api/roof-reports/${encodeURIComponent(id)}`, { timeoutMs: 20_000 });

/** Changes only the fields named. The answer is the report as it now stands. */
export const updateReport = (id: string, fields: Record<string, unknown>): Promise<unknown> =>
  api.put(`/api/roof-reports/${encodeURIComponent(id)}`, fields, { timeoutMs: 30_000 });

/** A job's reports. A 404 means the person may not see reports for this job. */
export const fetchJobReports = (externalId: string): Promise<{ reports: ReportRow[] }> =>
  api.get(`/api/clients/${encodeURIComponent(externalId)}/roof-reports`, { timeoutMs: 20_000 });
