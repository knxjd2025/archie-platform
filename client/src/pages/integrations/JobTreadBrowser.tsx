/**
 * The company's JobTread data (jobs, contacts, invoices), shown inside the
 * Current CRM card once JobTread is connected.
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatPhone } from '../../lib/format';

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

function formatDate(iso?: string): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCurrency(n?: number): string {
  if (n == null) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);
}

function contactDisplayName(c?: { companyName?: string; firstName?: string; lastName?: string }): string {
  if (!c) return '-';
  if (c.companyName) return c.companyName;
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || '-';
}

export default function JobTreadBrowser() {
  const [jobtreadTab, setJobtreadTab] = useState<JobTreadTab>('jobs');
  const [jobs, setJobs] = useState<JobTreadJob[]>([]);
  const [contacts, setContacts] = useState<JobTreadContact[]>([]);
  const [invoices, setInvoices] = useState<JobTreadInvoice[]>([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [contactsTotal, setContactsTotal] = useState(0);
  const [invoicesTotal, setInvoicesTotal] = useState(0);
  const [loadingJT, setLoadingJT] = useState(false);
  const [jtError, setJtError] = useState<string | null>(null);

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

  useEffect(() => { void loadJobTreadData(); }, []);

  // Summary stats for JobTread
  const activeJobs = jobs.filter(j => j.status === 'in_progress').length;
  const outstandingAR = invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + (i.amountDue || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button onClick={loadJobTreadData} disabled={loadingJT} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-60">
          {loadingJT ? 'Refreshing...' : 'Refresh'}
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
                  <p className="px-6 py-10 text-center text-sm text-gray-400">No jobs found. Jobs from JobTread will appear here.</p>
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
                              : '-'}
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
                  <p className="px-6 py-10 text-center text-sm text-gray-400">No contacts found. Contacts from JobTread will appear here.</p>
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
                            ) : '-'}
                          </td>
                          <td className="px-4 py-3 text-gray-600">{contact.phone ? formatPhone(contact.phone) : '-'}</td>
                          <td className="px-4 py-3 text-gray-500">
                            {contact.address?.city
                              ? `${contact.address.city}${contact.address.state ? ', ' + contact.address.state : ''}`
                              : '-'}
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
                  <p className="px-6 py-10 text-center text-sm text-gray-400">No invoices found. Invoices from JobTread will appear here.</p>
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
  );
}
