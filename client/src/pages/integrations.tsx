import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { formatPhone } from '../lib/format';

interface GoogleStatus {
  connected: boolean;
  email?: string;
  error?: string;
}

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: Array<{ email: string; displayName?: string }>;
  htmlLink?: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
  createdTime: string;
  webViewLink?: string;
}

interface JobTreadJob {
  id: string;
  name: string;
  number?: string;
  status: string;
  customerId: string;
  customer?: { id: string; companyName?: string; firstName?: string; lastName?: string; email?: string; phone?: string };
  address?: { street1?: string; city?: string; state?: string; zip?: string };
  description?: string;
  estimatedValue?: number;
  actualValue?: number;
  startDate?: string;
  endDate?: string;
  createdAt?: string;
}

interface JobTreadContact {
  id: string;
  companyName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: { street1?: string; city?: string; state?: string };
  createdAt?: string;
}

interface JobTreadInvoice {
  id: string;
  jobId: string;
  number?: string;
  status: string;
  amount: number;
  amountPaid: number;
  amountDue: number;
  dueDate?: string;
  sentDate?: string;
}

type ActiveTab = 'google' | 'jobtread';
type JobTreadTab = 'jobs' | 'contacts' | 'invoices';

const STATUS_COLORS: Record<string, string> = {
  lead: 'bg-blue-100 text-blue-700',
  estimate: 'bg-yellow-100 text-yellow-700',
  proposal: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  viewed: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  partial: 'bg-yellow-100 text-yellow-700',
  overdue: 'bg-red-100 text-red-700',
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function formatMimeType(mime: string): string {
  const map: Record<string, string> = {
    'application/vnd.google-apps.document': 'Google Doc',
    'application/vnd.google-apps.spreadsheet': 'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'application/vnd.google-apps.folder': 'Folder',
    'application/pdf': 'PDF',
    'image/jpeg': 'Image',
    'image/png': 'Image',
  };
  return map[mime] || mime.split('/').pop() || 'File';
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatCurrency(n?: number): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);
}

function contactDisplayName(c?: { companyName?: string; firstName?: string; lastName?: string }): string {
  if (!c) return '—';
  if (c.companyName) return c.companyName;
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || '—';
}

export default function Integrations() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('jobtread');
  const [jobtreadTab, setJobtreadTab] = useState<JobTreadTab>('jobs');

  // Google state
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [loadingGoogle, setLoadingGoogle] = useState(false);

  // JobTread state
  const [jobs, setJobs] = useState<JobTreadJob[]>([]);
  const [contacts, setContacts] = useState<JobTreadContact[]>([]);
  const [invoices, setInvoices] = useState<JobTreadInvoice[]>([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [contactsTotal, setContactsTotal] = useState(0);
  const [invoicesTotal, setInvoicesTotal] = useState(0);
  const [loadingJT, setLoadingJT] = useState(false);
  const [jtError, setJtError] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === 'jobtread') loadJobTreadData();
    if (activeTab === 'google') loadGoogleData();
  }, [activeTab]);

  const loadGoogleData = async () => {
    setLoadingGoogle(true);
    try {
      const status = await api.get<GoogleStatus>('/api/integrations/google/status');
      setGoogleStatus(status);

      if (status.connected) {
        const [eventsRes, filesRes] = await Promise.allSettled([
          api.get<{ events: CalendarEvent[] }>('/api/integrations/google/calendar/events?maxResults=10'),
          api.get<{ files: DriveFile[] }>('/api/integrations/google/drive/files?maxResults=15'),
        ]);
        if (eventsRes.status === 'fulfilled') setCalendarEvents(eventsRes.value.events || []);
        if (filesRes.status === 'fulfilled') setDriveFiles(filesRes.value.files || []);
      }
    } catch (e) {
      setGoogleStatus({ connected: false, error: 'Could not reach server' });
    } finally {
      setLoadingGoogle(false);
    }
  };

  const loadJobTreadData = async () => {
    setLoadingJT(true);
    setJtError(null);
    try {
      const [jobsRes, contactsRes, invoicesRes] = await Promise.allSettled([
        api.get<{ jobs: JobTreadJob[]; total: number }>('/api/integrations/jobtread/jobs?limit=50'),
        api.get<{ contacts: JobTreadContact[]; total: number }>('/api/integrations/jobtread/contacts?limit=50'),
        api.get<{ invoices: JobTreadInvoice[]; total: number }>('/api/integrations/jobtread/invoices?limit=50'),
      ]);
      if (jobsRes.status === 'fulfilled') { setJobs(jobsRes.value.jobs || []); setJobsTotal(jobsRes.value.total || 0); }
      if (contactsRes.status === 'fulfilled') { setContacts(contactsRes.value.contacts || []); setContactsTotal(contactsRes.value.total || 0); }
      if (invoicesRes.status === 'fulfilled') { setInvoices(invoicesRes.value.invoices || []); setInvoicesTotal(invoicesRes.value.total || 0); }
      if (jobsRes.status === 'rejected') setJtError((jobsRes.reason as any)?.message || 'JobTread API error');
    } catch (e: any) {
      setJtError(e.message || 'Failed to load JobTread data');
    } finally {
      setLoadingJT(false);
    }
  };

  // Summary stats for JobTread
  const activeJobs = jobs.filter(j => j.status === 'in_progress').length;
  const outstandingAR = invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + (i.amountDue || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your connected services and view live data</p>
      </div>

      {/* Tab selector */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {(['jobtread', 'google'] as ActiveTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'google' ? 'Google Workspace' : 'JobTread'}
            </button>
          ))}
        </nav>
      </div>

      {/* ===================== GOOGLE TAB ===================== */}
      {activeTab === 'google' && (
        <div className="space-y-6">
          {loadingGoogle ? (
            <div className="flex items-center justify-center h-40" role="status" aria-label="Loading Google integration status">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <>
              {/* Connection card */}
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-2xl">G</div>
                    <div>
                      <h3 className="font-semibold text-gray-900">Google Workspace</h3>
                      <p className="text-sm text-gray-500">Gmail · Calendar · Drive</p>
                    </div>
                  </div>
                  {/* No connect/disconnect: Workspace is reached through the
                      company service account's domain-wide delegation, which
                      signs you in as yourself. There is no per-user token to
                      grant or revoke. */}
                  <div className="text-right">
                    {googleStatus?.connected ? (
                      <>
                        <p className="text-sm font-medium text-green-600">Connected</p>
                        <p className="text-xs text-gray-500">{googleStatus.email}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-amber-600">Unavailable</p>
                        <p className="text-xs text-gray-500 max-w-xs">
                          {googleStatus?.error || 'Checking…'}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {googleStatus?.connected && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Calendar Events */}
                  <div className="bg-white rounded-xl border border-gray-200">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                      <h3 className="font-semibold text-gray-900">Upcoming Events</h3>
                      <span className="text-xs text-gray-400">Next 30 days</span>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {calendarEvents.length === 0 ? (
                        <p className="px-5 py-8 text-center text-sm text-gray-400">No upcoming events</p>
                      ) : (
                        calendarEvents.slice(0, 8).map(event => {
                          const start = event.start.dateTime || event.start.date;
                          return (
                            <div key={event.id} className="px-5 py-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-900 truncate">{event.summary}</p>
                                  {event.location && (
                                    <p className="text-xs text-gray-400 truncate">{event.location}</p>
                                  )}
                                </div>
                                <p className="text-xs text-gray-500 whitespace-nowrap">{formatDateTime(start)}</p>
                              </div>
                              {event.attendees && event.attendees.length > 0 && (
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {event.attendees.slice(0, 3).map(a => a.displayName || a.email).join(', ')}
                                  {event.attendees.length > 3 ? ` +${event.attendees.length - 3} more` : ''}
                                </p>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Drive Files */}
                  <div className="bg-white rounded-xl border border-gray-200">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                      <h3 className="font-semibold text-gray-900">Recent Drive Files</h3>
                      <span className="text-xs text-gray-400">Most recently modified</span>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {driveFiles.length === 0 ? (
                        <p className="px-5 py-8 text-center text-sm text-gray-400">No files found</p>
                      ) : (
                        driveFiles.slice(0, 10).map(file => (
                          <div key={file.id} className="px-5 py-3 flex items-center justify-between gap-2">
                            <div className="min-w-0 flex items-center gap-2">
                              <span className="text-xs text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded shrink-0">
                                {formatMimeType(file.mimeType)}
                              </span>
                              {file.webViewLink ? (
                                <a
                                  href={file.webViewLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm text-blue-600 hover:underline truncate"
                                >
                                  {file.name}
                                </a>
                              ) : (
                                <p className="text-sm text-gray-900 truncate">{file.name}</p>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 whitespace-nowrap">
                              {formatDate(file.modifiedTime)}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {!googleStatus?.connected && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-sm text-blue-800 space-y-2">
                  <p className="font-semibold">Workspace isn't reachable for your account</p>
                  <p className="text-blue-700">
                    There's nothing to connect here — the app reads your Gmail, Calendar and Drive
                    through the company service account, which signs in as you. If this says
                    unavailable, an admin needs to check one of:
                  </p>
                  <ol className="list-decimal list-inside space-y-1 text-blue-700">
                    <li>Your mailbox is on the <strong>@bestroofingnow.com</strong> Workspace domain</li>
                    <li>The service account's <strong>domain-wide delegation</strong> in Workspace admin lists the Calendar, Gmail and Drive scopes</li>
                    <li><code className="bg-blue-100 px-1 rounded">GOOGLE_SA_EMAIL</code> and <code className="bg-blue-100 px-1 rounded">GOOGLE_SA_KEY</code> are set on the server</li>
                  </ol>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ===================== JOBTREAD TAB ===================== */}
      {activeTab === 'jobtread' && (
        <div className="space-y-6">
          <div className="flex justify-end">
            <button onClick={loadJobTreadData} disabled={loadingJT} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-60">
              {loadingJT ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total Jobs</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{jobs.length}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Active Jobs</p>
              <p className="text-3xl font-bold text-green-600 mt-1">{activeJobs}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Contacts</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{contacts.length}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Outstanding AR</p>
              <p className="text-2xl font-bold text-orange-600 mt-1">{formatCurrency(outstandingAR)}</p>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="border-b border-gray-100 px-4">
              <nav className="-mb-px flex gap-4">
                {(['jobs', 'contacts', 'invoices'] as JobTreadTab[]).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setJobtreadTab(tab)}
                    className={`py-3 text-sm font-medium border-b-2 transition-colors capitalize ${
                      jobtreadTab === tab
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab}
                    <span className="ml-1.5 text-xs text-gray-400">
                      ({tab === 'jobs' ? jobs.length : tab === 'contacts' ? contacts.length : invoices.length})
                    </span>
                  </button>
                ))}
              </nav>
            </div>

            {loadingJT ? (
              <div className="divide-y divide-gray-50">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3.5 animate-pulse">
                    <div className="h-4 w-1/4 bg-gray-100 rounded" />
                    <div className="h-4 w-1/4 bg-gray-100 rounded" />
                    <div className="h-4 w-1/6 bg-gray-100 rounded ml-auto" />
                  </div>
                ))}
              </div>
            ) : jtError ? (
              <div className="p-6 text-center">
                <p className="text-sm text-red-600 font-medium">Couldn't load JobTread data</p>
                <p className="text-xs text-gray-500 mt-1">{jtError}</p>
                <button
                  onClick={loadJobTreadData}
                  className="mt-3 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  Retry
                </button>
              </div>
            ) : (
              <>
                {/* JOBS TABLE */}
                {jobtreadTab === 'jobs' && (
                  <div className="overflow-x-auto">
                    {jobs.length === 0 ? (
                      <p className="px-6 py-10 text-center text-sm text-gray-400">📋 No jobs found — jobs synced from JobTread will appear here.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-500 bg-gray-50">
                            <th className="px-4 py-2 font-medium">Job</th>
                            <th className="px-4 py-2 font-medium">Customer</th>
                            <th className="px-4 py-2 font-medium">Status</th>
                            <th className="px-4 py-2 font-medium">Location</th>
                            <th className="px-4 py-2 font-medium text-right">Est. Value</th>
                            <th className="px-4 py-2 font-medium">Start</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {jobs.map(job => (
                            <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-4 py-3">
                                <p className="font-medium text-gray-900">{job.name}</p>
                                {job.number && <p className="text-xs text-gray-400">#{job.number}</p>}
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-gray-700">{contactDisplayName(job.customer)}</p>
                                {job.customer?.email && (
                                  <p className="text-xs text-gray-400">{job.customer.email}</p>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge status={job.status} />
                              </td>
                              <td className="px-4 py-3 text-gray-500">
                                {job.address?.city
                                  ? `${job.address.city}${job.address.state ? ', ' + job.address.state : ''}`
                                  : '—'}
                              </td>
                              <td className="px-4 py-3 text-right text-gray-700">
                                {formatCurrency(job.estimatedValue || job.actualValue)}
                              </td>
                              <td className="px-4 py-3 text-gray-500">{formatDate(job.startDate)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {jobsTotal > jobs.length && (
                      <p className="px-4 py-2 text-xs text-gray-400">Showing {jobs.length} of {jobsTotal} jobs</p>
                    )}
                  </div>
                )}

                {/* CONTACTS TABLE */}
                {jobtreadTab === 'contacts' && (
                  <div className="overflow-x-auto">
                    {contacts.length === 0 ? (
                      <p className="px-6 py-10 text-center text-sm text-gray-400">👤 No contacts found — contacts from JobTread will appear here.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-500 bg-gray-50">
                            <th className="px-4 py-2 font-medium">Name</th>
                            <th className="px-4 py-2 font-medium">Email</th>
                            <th className="px-4 py-2 font-medium">Phone</th>
                            <th className="px-4 py-2 font-medium">Location</th>
                            <th className="px-4 py-2 font-medium">Added</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {contacts.map(contact => (
                            <tr key={contact.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-4 py-3">
                                <p className="font-medium text-gray-900">{contactDisplayName(contact)}</p>
                              </td>
                              <td className="px-4 py-3 text-gray-600">
                                {contact.email ? (
                                  <a href={`mailto:${contact.email}`} className="text-blue-600 hover:underline">
                                    {contact.email}
                                  </a>
                                ) : '—'}
                              </td>
                              <td className="px-4 py-3 text-gray-600">{contact.phone ? formatPhone(contact.phone) : '—'}</td>
                              <td className="px-4 py-3 text-gray-500">
                                {contact.address?.city
                                  ? `${contact.address.city}${contact.address.state ? ', ' + contact.address.state : ''}`
                                  : '—'}
                              </td>
                              <td className="px-4 py-3 text-gray-500">{formatDate(contact.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {contactsTotal > contacts.length && (
                      <p className="px-4 py-2 text-xs text-gray-400">Showing {contacts.length} of {contactsTotal} contacts</p>
                    )}
                  </div>
                )}

                {/* INVOICES TABLE */}
                {jobtreadTab === 'invoices' && (
                  <div className="overflow-x-auto">
                    {invoices.length === 0 ? (
                      <p className="px-6 py-10 text-center text-sm text-gray-400">🧾 No invoices found — invoices from JobTread will appear here.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-500 bg-gray-50">
                            <th className="px-4 py-2 font-medium">Invoice #</th>
                            <th className="px-4 py-2 font-medium">Status</th>
                            <th className="px-4 py-2 font-medium text-right">Amount</th>
                            <th className="px-4 py-2 font-medium text-right">Paid</th>
                            <th className="px-4 py-2 font-medium text-right">Due</th>
                            <th className="px-4 py-2 font-medium">Due Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {invoices.map(inv => (
                            <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-4 py-3 font-medium text-gray-900">
                                {inv.number ? `#${inv.number}` : inv.id.slice(0, 8)}
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge status={inv.status} />
                              </td>
                              <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(inv.amount)}</td>
                              <td className="px-4 py-3 text-right text-green-600">{formatCurrency(inv.amountPaid)}</td>
                              <td className={`px-4 py-3 text-right font-medium ${inv.amountDue > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                                {formatCurrency(inv.amountDue)}
                              </td>
                              <td className="px-4 py-3 text-gray-500">{formatDate(inv.dueDate)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t border-gray-200 bg-gray-50">
                          <tr>
                            <td colSpan={4} className="px-4 py-2 text-xs text-gray-500 font-medium">Total Outstanding</td>
                            <td className="px-4 py-2 text-right text-sm font-bold text-orange-600">
                              {formatCurrency(invoices.reduce((s, i) => s + (i.amountDue || 0), 0))}
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    )}
                    {invoicesTotal > invoices.length && (
                      <p className="px-4 py-2 text-xs text-gray-400">Showing {invoices.length} of {invoicesTotal} invoices</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
