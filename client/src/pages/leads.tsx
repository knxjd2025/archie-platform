import { useState, useEffect, useRef } from 'react';
import { atLeast } from '../../../shared/rbac';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatPhone, fmtDate } from '../lib/format';
import { toDateInput } from '../lib/canvass';
import { RowsSkeleton } from '../components/Skeleton';
import ContactActions from '../components/ContactActions';
import OpenTimes, { type TimeChoice } from '../components/OpenTimes';

interface Lead {
  id: number;
  externalId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  status: string;
  score: number | null;
  serviceType: string | null;
  source: string;
  repName: string | null;
  /** Who typed the lead in — the call-center credit, not the selling rep. */
  enteredByName?: string | null;
  enteredBy?: string | null;
  sharedCount?: number;
  createdAt: string;
  lastContactedAt: string | null;
  insuranceClaim: boolean;
}

interface Rep {
  id: number;
  name: string;
  email: string;
  jobtreadSalesRep?: string | null;
}

/**
 * Who took the call, shown under the selling rep — but not when it was the rep
 * themselves, which is the ordinary case and would just be noise on every row.
 */
const enteredCredit = (lead: Lead): string | null => {
  const name = (lead.enteredByName || '').trim();
  if (!name) return null;
  return name.toLowerCase() === (lead.repName || '').trim().toLowerCase() ? null : name;
};

export default function Leads({ onOpenClient, initialStatus, initialNew, initialPrefill }: { onOpenClient?: (externalId: string) => void; initialStatus?: string; initialNew?: boolean; initialPrefill?: Partial<{ firstName: string; lastName: string; phone: string; email: string; address: string; notes: string }> }) {
  const { user } = useAuth();
  const isManagerPlus = !!user && atLeast(user.role, 'manager'); // admin, sales director, sales leader

  const [leads, setLeads] = useState<Lead[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus || 'all');
  const [q, setQ] = useState('');
  const [includeClosed, setIncludeClosed] = useState(false);
  const [total, setTotal] = useState(0);
  // Search runs server-side (see loadLeads), so it finds every client — not just
  // the ones already loaded.
  const shown = leads;

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [showNew, setShowNew] = useState(!!initialNew || !!initialPrefill);
  const emptyNew = { firstName: '', lastName: '', phone: '', email: '', address: '', salesRep: '', notes: '' };
  const [nf, setNf] = useState({ ...emptyNew, ...(initialPrefill || {}) });
  // The appointment agreed on the call, booked in the same save. Off by default;
  // tapping a real open time on the rep's calendar fills it in one tap on a phone.
  const emptyAppt = { on: false, type: 'Inspection', date: '', time: '', durationMins: 60, forEmail: null as string | null };
  const [appt, setAppt] = useState(emptyAppt);
  const [created, setCreated] = useState<{ name: string; jobId: string | null; jobtread: string; ghl: string; appointment: any } | null>(null);
  // A time tapped on the availability strip books it; changing only whose
  // calendar we're looking at shouldn't switch the appointment on by itself —
  // nor switch it back on after the rep deliberately unchecked the box.
  const chooseSlot = (c: TimeChoice) => {
    setAppt((a) => ({
      ...a, ...c,
      on: a.on || (!!c.date && !!c.time && (c.date !== a.date || c.time !== a.time)),
    }));
    // Booking on someone else's calendar makes it their lead — keep the Sales
    // Rep field showing the same person the server will put on the job.
    const rep = reps.find((r) => r.email.toLowerCase() === (c.forEmail || '').toLowerCase());
    if (rep) setNf((f) => ({ ...f, salesRep: rep.jobtreadSalesRep || rep.name }));
  };
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4000); };
  const loadRequestId = useRef(0);

  const startEdit = (l: Lead) => { setEditingId(l.id); setEditPhone(l.phone || ''); setEditEmail(l.email || ''); };

  const saveEdit = async (l: Lead) => {
    if (!l.externalId) { flash('This lead has no JobTread job to update.'); return; }
    setBusy(true);
    try {
      await api.patch(`/api/leads/${l.externalId}/contact`, { phone: editPhone.trim(), email: editEmail.trim() });
      setLeads((prev) => prev.map((x) => (x.id === l.id ? { ...x, phone: editPhone.trim(), email: editEmail.trim() } : x)));
      flash(`Updated ${l.firstName || 'contact'}`);
      setEditingId(null);
    } catch (e: any) {
      flash(`Couldn't update: ${e?.message || 'failed'}`);
    } finally { setBusy(false); }
  };

  const createLead = async () => {
    if (!nf.firstName.trim() && !nf.phone.trim() && !nf.email.trim()) { flash('Enter a name, phone, or email.'); return; }
    if (appt.on && (!appt.date || !appt.time)) { flash('Pick a date and time for the appointment, or switch it off.'); return; }
    setBusy(true);
    try {
      const r = await api.post<{ jobId?: string | null; jobtread: string; ghl: string; appointment: any }>('/api/leads/create', {
        ...nf,
        ...(appt.on ? { appointment: { type: appt.type, date: appt.date, time: appt.time, durationMins: appt.durationMins, notes: nf.notes, forEmail: appt.forEmail || undefined } } : {}),
      });
      const name = `${nf.firstName} ${nf.lastName}`.trim() || nf.phone || nf.email;
      setCreated({ name, jobId: r.jobId || null, jobtread: r.jobtread, ghl: r.ghl, appointment: r.appointment });
      flash(r.appointment ? (r.appointment.ok ? `${name} added and booked` : `${name} added — booking failed`) : `${name} added`);
      setNf(emptyNew); setAppt(emptyAppt);
      loadLeads();
    } catch (e: any) {
      flash(`Couldn't create lead: ${e?.message || 'failed'}`);
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const t = setTimeout(() => { loadLeads(); }, q.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [statusFilter, q, includeClosed]);

  // The New Lead panel had no Escape-to-close, unlike SearchOverlay's identical inline-panel pattern.
  useEffect(() => {
    if (!showNew) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowNew(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showNew]);

  useEffect(() => {
    if (isManagerPlus) {
      api.get<{ reps: Rep[] }>('/api/team/reps').then((r) => setReps(r.reps || [])).catch(() => {});
    }
  }, [isManagerPlus]);

  const loadLeads = async () => {
    setRefreshing(true);
    // Rapid status/search/checkbox changes fire overlapping requests with no
    // ordering guarantee — a slower stale response could otherwise land after
    // a newer one and clobber it. Only the most recently issued request may
    // apply its result.
    const id = ++loadRequestId.current;
    try {
      const p = new URLSearchParams();
      if (statusFilter !== 'all') p.set('status', statusFilter);
      if (q.trim()) p.set('q', q.trim());
      if (includeClosed) p.set('includeClosed', 'true');
      const res = await api.get<{ leads: Lead[]; total?: number }>(`/api/leads?${p}`);
      if (id !== loadRequestId.current) return;
      setLeads(res.leads || []);
      setTotal(res.total ?? (res.leads || []).length);
      setLoadError(null);
    } catch (error: any) {
      if (id !== loadRequestId.current) return;
      console.error('Failed to load leads:', error);
      setLoadError(error?.message || "Couldn't load leads.");
    } finally {
      if (id === loadRequestId.current) { setLoading(false); setRefreshing(false); }
    }
  };

  // Assign-rep modal: a job can carry up to 3 reps (1 primary + 2 shared).
  const [assignLead, setAssignLead] = useState<Lead | null>(null);
  const [assignPrimary, setAssignPrimary] = useState('');
  const [assignSecondary, setAssignSecondary] = useState<string[]>([]);
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);
  const MAX_SECONDARY = 2;

  const openAssign = async (lead: Lead) => {
    if (!lead.externalId) return;
    setAssignLead(lead);
    setAssignPrimary('');
    setAssignSecondary([]);
    setAssignLoading(true);
    try {
      const r = await api.get<{ assignments: { teamMemberId: number; role: string }[] }>(`/api/assignments/${lead.externalId}`);
      const primary = r.assignments.find((a) => a.role === 'primary');
      const secondary = r.assignments.filter((a) => a.role === 'secondary');
      setAssignPrimary(primary ? String(primary.teamMemberId) : '');
      setAssignSecondary(secondary.map((a) => String(a.teamMemberId)));
    } catch (error: any) {
      flash(`Couldn't load current assignment: ${error?.message || 'failed'}`);
    } finally {
      setAssignLoading(false);
    }
  };

  const closeAssign = () => { if (!assignSaving) setAssignLead(null); };

  const toggleSecondary = (id: string) => {
    setAssignSecondary((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SECONDARY) { flash(`Only ${MAX_SECONDARY} shared reps allowed, in addition to the primary.`); return prev; }
      return [...prev, id];
    });
  };

  const saveAssign = async () => {
    const lead = assignLead;
    if (!lead?.externalId || !assignPrimary) return;
    setAssignSaving(true);
    try {
      await api.post('/api/assignments', {
        jobExternalId: lead.externalId,
        primaryTeamMemberId: Number(assignPrimary),
        secondaryTeamMemberIds: assignSecondary.map(Number),
      });
      const primaryRep = reps.find((r) => String(r.id) === assignPrimary);
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, repName: primaryRep ? primaryRep.name : null, sharedCount: assignSecondary.length } : l)));
      flash('Assignment saved');
      setAssignLead(null);
    } catch (error: any) {
      flash(`Couldn't save assignment: ${error?.message || 'failed'}`);
    } finally {
      setAssignSaving(false);
    }
  };

  const clearAssign = async () => {
    const lead = assignLead;
    if (!lead?.externalId) return;
    // Assignment decides who gets credited and paid on the job, and there's no
    // undo — same reasoning as approving a commission, which already confirms.
    const who = lead.repName ? ` from ${lead.repName}` : '';
    const which = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'this lead';
    if (!window.confirm(`Clear the rep assignment${who} on ${which}? This removes the primary and any shared reps.`)) return;
    setAssignSaving(true);
    try {
      await api.delete(`/api/assignments/${lead.externalId}`);
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, repName: null, sharedCount: 0 } : l)));
      flash('Assignment cleared');
      setAssignLead(null);
    } catch (error: any) {
      flash(`Couldn't clear assignment: ${error?.message || 'failed'}`);
    } finally {
      setAssignSaving(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      new: 'bg-blue-100 text-blue-700',
      contacted: 'bg-yellow-100 text-yellow-700',
      qualified: 'bg-green-100 text-green-700',
      proposal_sent: 'bg-purple-100 text-purple-700',
      negotiation: 'bg-orange-100 text-orange-700',
      won: 'bg-emerald-100 text-emerald-700',
      lost: 'bg-red-100 text-red-700',
      disqualified: 'bg-gray-100 text-gray-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  const getScoreColor = (score: number | null) => {
    if (!score) return 'text-gray-400';
    if (score >= 8) return 'text-green-600 font-bold';
    if (score >= 6) return 'text-yellow-600';
    return 'text-red-600';
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-32 bg-gray-100 rounded animate-pulse" />
        <RowsSkeleton rows={8} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Leads <span className="text-base font-normal text-gray-400">{total > shown.length ? `${shown.length} of ${total}` : shown.length}</span></h1>
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[8rem]">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }}
              placeholder="Search all clients…"
              className="w-full pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {q && <button onClick={() => setQ('')} title="Clear search" aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm">✕</button>}
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter leads by status"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">All Status</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="qualified">Qualified</option>
            <option value="proposal_sent">Proposal Sent</option>
            <option value="negotiation">Negotiation</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="disqualified">Disqualified</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm text-gray-600 px-2 whitespace-nowrap" title="Closed jobs are hidden by default">
            <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
            Closed
          </label>
          <button
            onClick={() => setShowNew((s) => !s)}
            className="px-4 py-2 bg-brick text-white rounded-lg text-sm font-medium hover:bg-brick-dark transition-colors"
          >
            ＋ New Lead
          </button>
          <button
            onClick={loadLeads}
            disabled={refreshing}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {toast && <div className="rounded-lg bg-gray-900 text-white text-sm px-4 py-2 shadow">{toast}</div>}

      {loadError && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2">
          <span>Couldn't load leads — {loadError}</span>
          <button onClick={loadLeads} className="font-medium underline hover:no-underline">Retry</button>
        </div>
      )}

      {showNew && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">New Lead</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" onKeyDown={(e) => { if (e.key === 'Enter' && !busy) createLead(); }}>
            <input autoFocus value={nf.firstName} onChange={(e) => setNf({ ...nf, firstName: e.target.value })} placeholder="First name" className="text-sm border border-gray-200 rounded p-2 focus:ring-1 focus:ring-blue-400" />
            <input value={nf.lastName} onChange={(e) => setNf({ ...nf, lastName: e.target.value })} placeholder="Last name" className="text-sm border border-gray-200 rounded p-2 focus:ring-1 focus:ring-blue-400" />
            <input type="tel" value={nf.phone} onChange={(e) => setNf({ ...nf, phone: e.target.value })} placeholder="(555) 555-5555" className="text-sm border border-gray-200 rounded p-2 focus:ring-1 focus:ring-blue-400" />
            <input type="email" value={nf.email} onChange={(e) => setNf({ ...nf, email: e.target.value })} placeholder="Email" className="text-sm border border-gray-200 rounded p-2 focus:ring-1 focus:ring-blue-400" />
            <input value={nf.address} onChange={(e) => setNf({ ...nf, address: e.target.value })} placeholder="Street address, city" className="text-sm border border-gray-200 rounded p-2 sm:col-span-2 focus:ring-1 focus:ring-blue-400" />
            <input value={nf.notes} onChange={(e) => setNf({ ...nf, notes: e.target.value })} placeholder="What they said on the call (optional)" className="text-sm border border-gray-200 rounded p-2 sm:col-span-2 lg:col-span-3 focus:ring-1 focus:ring-blue-400" />
            {isManagerPlus && (
              <select value={nf.salesRep} onChange={(e) => { setNf({ ...nf, salesRep: e.target.value }); setAppt((a) => ({ ...a, forEmail: null })); }} className="text-sm border border-gray-200 rounded p-2 text-gray-700 focus:ring-1 focus:ring-blue-400">
                <option value="">Sales Rep (default: you)</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.jobtreadSalesRep || r.name}>{r.name}</option>
                ))}
              </select>
            )}
          </div>
          {/* Book while they're still on the phone */}
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
              <input type="checkbox" checked={appt.on} onChange={(e) => setAppt({ ...appt, on: e.target.checked })} className="h-4 w-4" />
              📅 Book an appointment now
            </label>
            <OpenTimes
              className="mt-2"
              durationMins={appt.durationMins}
              value={{ date: appt.date, time: appt.time, forEmail: appt.forEmail }}
              onChange={chooseSlot}
              preferRep={nf.salesRep || null}
            />
            {appt.on && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                <select value={appt.type} onChange={(e) => setAppt({ ...appt, type: e.target.value })} aria-label="Appointment type" className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white">
                  <option>Inspection</option><option>Sales appointment</option><option>Adjuster meeting</option><option>Estimate</option>
                </select>
                <input type="date" value={appt.date} onChange={(e) => setAppt({ ...appt, date: e.target.value })} min={toDateInput(new Date().toISOString())} aria-label="Date" className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white" />
                <input type="time" value={appt.time} onChange={(e) => setAppt({ ...appt, time: e.target.value })} aria-label="Time" className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white" />
                <select value={appt.durationMins} onChange={(e) => setAppt({ ...appt, durationMins: Number(e.target.value) })} aria-label="Duration" className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white">
                  <option value={30}>30 min</option><option value={60}>1 hour</option><option value={90}>1.5 hours</option><option value={120}>2 hours</option>
                </select>
              </div>
            )}
            <p className="text-xs text-gray-400 mt-2">Goes on that rep's Google Calendar with the address, and shows on the Schedule tab.</p>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={createLead} disabled={busy} className="text-sm px-4 py-2 rounded-lg bg-brick text-white font-medium hover:bg-brick-dark disabled:opacity-50">{busy ? 'Saving…' : appt.on ? 'Add lead + book' : 'Add lead'}</button>
            <button onClick={() => { setShowNew(false); setNf(emptyNew); setAppt(emptyAppt); setCreated(null); }} className="text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-600">Close</button>
          </div>
          {created && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <div className="font-medium">✅ {created.name} added</div>
              <div className="text-xs text-emerald-800 mt-1">JobTread: {created.jobtread} · GoHighLevel: {created.ghl}{created.appointment ? ` · Appointment: ${created.appointment.ok ? `booked on ${created.appointment.bookedOn}` : `failed (${created.appointment.error || 'calendar'})`}` : ''}</div>
              {created.jobId && onOpenClient && (
                <button onClick={() => onOpenClient(created.jobId!)} className="mt-2 text-xs px-3 py-1.5 rounded-lg bg-white border border-emerald-300 text-emerald-800 font-medium">Open {created.name} → call / text / inspection</button>
              )}
            </div>
          )}
          <p className="text-xs text-gray-400 mt-2">Creates a JobTread job (Status “New Lead”) + a GoHighLevel contact + a lead here — all in sync. The lead is yours: it shows under your name.</p>
        </div>
      )}

      {/* Leads Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sales Rep</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Score</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                    {q.trim() ? (
                      <>No leads match "{q}".</>
                    ) : (
                      <>📭 No leads yet. New leads from GoHighLevel and JobTread show up here automatically.</>
                    )}
                  </td>
                </tr>
              ) : (
                shown.map((lead) => (
                  <tr key={lead.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {lead.externalId && onOpenClient ? (
                          <button onClick={() => onOpenClient(lead.externalId!)} className="text-sm font-medium text-blue-600 hover:underline text-left">
                            {lead.firstName || lead.lastName ? `${lead.firstName || ''} ${lead.lastName || ''}`.trim() : 'Unknown'}
                          </button>
                        ) : (
                          <div className="text-sm font-medium text-gray-900">
                            {lead.firstName || lead.lastName ? `${lead.firstName || ''} ${lead.lastName || ''}`.trim() : 'Unknown'}
                          </div>
                        )}
                        {lead.insuranceClaim && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 whitespace-nowrap">Claim</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{lead.source}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {editingId === lead.id ? (
                        <div className="space-y-1">
                          <input type="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) saveEdit(lead); }} placeholder="Phone" className="text-sm border border-gray-200 rounded px-1.5 py-1 w-40 focus:ring-1 focus:ring-blue-400" />
                          <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) saveEdit(lead); }} placeholder="Email" className="text-xs border border-gray-200 rounded px-1.5 py-1 w-40 focus:ring-1 focus:ring-blue-400" />
                          <div className="flex gap-1">
                            <button onClick={() => saveEdit(lead)} disabled={busy} className="text-[11px] px-2 py-0.5 rounded bg-blue-600 text-white disabled:opacity-50">Save</button>
                            <button onClick={() => setEditingId(null)} className="text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-600">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="group">
                          <div className="text-sm text-gray-900">{lead.phone ? formatPhone(lead.phone) : '-'}</div>
                          <div className="text-xs text-gray-500">{lead.email || '-'}</div>
                          {/* Through GoHighLevel (business number), not the rep's cell — components/ContactActions.tsx */}
                          <div className="mt-1"><ContactActions externalId={lead.externalId} phone={lead.phone} email={lead.email} size="xs" flash={flash} /></div>
                          {lead.externalId && (
                            <button onClick={() => startEdit(lead)} className="text-[11px] text-gray-400 hover:text-blue-600">Edit</button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {lead.city && lead.state ? `${lead.city}, ${lead.state}` : '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isManagerPlus && lead.externalId ? (
                        <button
                          onClick={() => openAssign(lead)}
                          aria-label="Assign sales reps"
                          className="px-2 py-1 border border-gray-200 rounded text-xs text-gray-700 hover:bg-gray-50 focus:ring-1 focus:ring-blue-500"
                        >
                          {lead.repName ? lead.repName : <span className="text-gray-400">Unassigned</span>}
                          {!!lead.sharedCount && <span className="text-gray-400"> +{lead.sharedCount}</span>}
                        </button>
                      ) : (
                        <span className="text-sm text-gray-900">
                          {lead.repName || '-'}
                          {!!lead.sharedCount && <span className="text-gray-400"> +{lead.sharedCount}</span>}
                        </span>
                      )}
                      {enteredCredit(lead) && <div className="text-xs text-gray-400 mt-0.5">Entered by {enteredCredit(lead)}</div>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`text-sm ${getScoreColor(lead.score)}`}>
                        {lead.score !== null ? `${lead.score}/10` : '-'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(lead.status)}`}>
                        {lead.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {fmtDate(lead.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {assignLead && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Assign sales reps">
          <div className="absolute inset-0 bg-black/40" onClick={closeAssign} />
          <div className="absolute inset-0 flex items-center justify-center px-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-1">Assign reps</h3>
              <p className="text-xs text-gray-500 mb-4">{[assignLead.firstName, assignLead.lastName].filter(Boolean).join(' ') || 'This lead'} — up to 1 primary + {MAX_SECONDARY} shared.</p>
              {assignLoading ? (
                <div className="text-sm text-gray-400 py-6 text-center">Loading…</div>
              ) : (
                <>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Primary rep</label>
                  <select
                    value={assignPrimary}
                    onChange={(e) => setAssignPrimary(e.target.value)}
                    className="w-full px-2 py-2 border border-gray-200 rounded text-sm text-gray-700 focus:ring-1 focus:ring-blue-500 mb-4"
                  >
                    <option value="">Choose a primary rep…</option>
                    {reps.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>

                  <label className="block text-xs font-medium text-gray-600 mb-1">Also share with (optional)</label>
                  <div className="space-y-1 mb-4 max-h-40 overflow-y-auto">
                    {reps.filter((r) => String(r.id) !== assignPrimary).map((r) => (
                      <label key={r.id} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={assignSecondary.includes(String(r.id))}
                          onChange={() => toggleSecondary(String(r.id))}
                        />
                        {r.name}
                      </label>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={saveAssign}
                      disabled={assignSaving || !assignPrimary}
                      className="text-sm px-3 py-1.5 rounded-lg bg-brick text-white font-medium hover:bg-brick-dark disabled:opacity-50"
                    >
                      {assignSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={closeAssign} disabled={assignSaving} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 disabled:opacity-50">Cancel</button>
                    <button onClick={clearAssign} disabled={assignSaving} className="text-sm px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50 ml-auto">Clear</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
