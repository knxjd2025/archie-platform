import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { useCompany } from '../lib/company';
import { fmtDate, formatPhone, money } from '../lib/format';
import { toDateInput } from '../lib/canvass';
import FollowUps from '../components/FollowUps';
import RoofReports from '../components/RoofReports';
import JobPhotos from '../components/JobPhotos';
import InspectionForm from '../components/InspectionForm';
import PreConstructionChecklist from '../components/PreConstructionChecklist';
import FinalWalkthrough from '../components/FinalWalkthrough';
import ContactActions from '../components/ContactActions';
import JobCommission from '../components/JobCommission';
import NeighborLetters from '../components/NeighborLetters';
import InsuranceLetters from '../components/InsuranceLetters';
import CertificateOfCompletion from '../components/CertificateOfCompletion';
import SignatureRequests from '../components/SignatureRequests';
import StageChecklists from '../components/StageChecklists';
import OpenTimes from '../components/OpenTimes';
import JobReps from '../components/JobReps';
import AccountEditor from '../components/AccountEditor';
import type { AccountEdit } from '../../../shared/client-account';

interface Lead {
  externalId: string | null;
  /** 'residential' | 'commercial' — picks which inspection checklist the job gets by default. */
  propertyType?: string | null;
  customer: string | null;
  jobName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  /** The address as stored (for editing); `address` may have city/state appended for display. */
  addressLine?: string | null;
  /** 'jobtread' for a synced job; account edits write to JobTread, so only those can be edited. */
  source?: string | null;
  status: string;
  stage: string | null;
  repName: string | null;
  /** Who typed the lead in — call-center credit, distinct from the selling rep. */
  enteredByName: string | null;
  projectManager: string | null;
  projectedValue: number | null;
  insuranceClaim: boolean;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  createdAt: string | null;
}
interface Doc {
  id: number; type: string | null; amount: number | null; status: string | null; issueDate: string | null; signedAt: string | null;
}

// The post-sale production stages (matches the board) for the change-stage control.
const STAGE_OPTIONS = [
  'New Lead', 'Appt Set', 'Estimating', 'Sales Closing Meeting', 'Follow Up Close',
  'Insurance Approved', 'Buyer Approved', 'Permitting', 'Schedule', 'Pre-Construction',
  'Roof Construction', 'Other Construction Work', 'Complete', 'PIF File Warranties', 'Closed', 'Lost',
];


export default function ClientDetail({ externalId, onBack, onOpenPlaybook }: { externalId: string; onBack: () => void; onOpenPlaybook?: (docId: string) => void }) {
  const company = useCompany();
  const [lead, setLead] = useState<Lead | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [insurance, setInsurance] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyStage, setBusyStage] = useState(false);
  const [busyNote, setBusyNote] = useState(false);
  const [busyContact, setBusyContact] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4000); };
  const copy = (t?: string | null) => { if (t) { navigator.clipboard?.writeText(t).then(() => flash('Copied')).catch(() => {}); } };
  const [tagging, setTagging] = useState<string | null>(null);
  const addTag = async (tag: string) => {
    setTagging(tag);
    try { await api.post(`/api/leads/${externalId}/tag`, { tag }); flash(`Tagged "${tag}" in GoHighLevel`); }
    catch (e: any) { flash(`Couldn't tag: ${e?.message || 'failed'}`); }
    finally { setTagging(null); }
  };

  // Booking an inspection (Google Calendar → shows on the Schedule).
  const [bookOpen, setBookOpen] = useState(false);
  const [booking, setBooking] = useState(false);
  const emptyBk = { date: '', time: '', durationMins: 60, type: 'Inspection', notes: '', forEmail: null as string | null };
  const [bk, setBk] = useState(emptyBk);
  const book = async () => {
    if (!bk.date || !bk.time || booking) return;
    setBooking(true);
    try {
      await api.post(`/api/clients/${externalId}/appointment`, { ...bk, forEmail: bk.forEmail || undefined });
      flash(`📅 ${bk.type} booked for ${bk.date} at ${bk.time}`);
      setBookOpen(false); setBk(emptyBk);
    } catch (e: any) { flash(`Couldn't book: ${e?.message || 'failed'}`); }
    finally { setBooking(false); }
  };

  // Pre-fill the text composer with a payment reminder (human reviews + sends).
  const paymentReminder = () => {
    setReply(`Hi, this is ${company.displayName}. Just a friendly reminder about the balance on your account. Happy to answer any questions or take care of it over the phone whenever works for you. Thank you!`);
    focusComposer();
  };

  const [editing, setEditing] = useState(false);
  const [ePhone, setEPhone] = useState('');
  const [eEmail, setEEmail] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');

  type Msg = { source: string; channel: string; direction: string; body: string; date: number };
  const [messages, setMessages] = useState<Msg[]>([]);
  const [ghlContactId, setGhlContactId] = useState<string | null>(null);
  const [msgLoading, setMsgLoading] = useState(true);
  const [messagesError, setMessagesError] = useState(false);
  const [reply, setReply] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const replyRef = useRef<HTMLInputElement>(null);
  const focusComposer = () => { replyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); replyRef.current?.focus(); };

  const loadMessages = () => {
    setMsgLoading(true); setMessagesError(false);
    api.get<{ contactId: string | null; messages: Msg[] }>(`/api/clients/${externalId}/messages`)
      .then((r) => { setMessages(r.messages || []); setGhlContactId(r.contactId); })
      .catch(() => setMessagesError(true))
      .finally(() => setMsgLoading(false));
  };
  useEffect(loadMessages, [externalId]);

  type Estimate = { id: string; name: string; number?: string; status: string; price: number; issueDate?: string };
  type DailyLog = { id: string; date?: string; notes: string; weather?: string; minTemp?: number | null; maxTemp?: number | null; author?: string };
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [estimatesError, setEstimatesError] = useState(false);
  const [dailyLogsError, setDailyLogsError] = useState(false);
  const loadEstimates = () => {
    setEstimatesError(false);
    api.get<{ estimates: Estimate[] }>(`/api/clients/${externalId}/estimates`).then((r) => setEstimates(r.estimates || [])).catch(() => setEstimatesError(true));
  };
  const loadDailyLogs = () => {
    setDailyLogsError(false);
    api.get<{ logs: DailyLog[] }>(`/api/clients/${externalId}/daily-logs`).then((r) => setDailyLogs(r.logs || [])).catch(() => setDailyLogsError(true));
  };
  useEffect(() => { loadEstimates(); loadDailyLogs(); }, [externalId]);

  const sendReply = async () => {
    if (!ghlContactId || !reply.trim()) return;
    setSendingReply(true);
    try {
      await api.post(`/api/conversations/${ghlContactId}/reply`, { channel: 'sms', message: reply.trim() });
      setMessages((m) => [{ source: 'ghl', channel: 'sms', direction: 'outbound', body: reply.trim(), date: Date.now() }, ...m]);
      setReply(''); flash('Text sent');
    } catch (e: any) { flash(`Couldn't send: ${e?.message || 'failed'}`); } finally { setSendingReply(false); }
  };

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.get<{ lead: Lead; documents: Doc[]; insurance: Record<string, any> }>(`/api/clients/${externalId}`);
      setLead(r.lead); setDocs(r.documents || []); setInsurance(r.insurance || {});
      setEPhone(r.lead.phone || ''); setEEmail(r.lead.email || '');
    } catch (e: any) {
      setError(e?.message || 'Failed to load client');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [externalId]);

  const changeStage = async (stage: string) => {
    if (!lead?.externalId || stage === lead.stage) return;
    const prev = lead.stage;
    setBusyStage(true);
    setLead((l) => (l ? { ...l, stage } : l));
    try {
      await api.post(`/api/production/${lead.externalId}/stage`, { stage });
      flash(`Stage → ${stage}`);
    } catch (e: any) {
      setLead((l) => (l ? { ...l, stage: prev } : l));
      flash(`Couldn't change stage: ${e?.message || 'failed'}`);
    } finally { setBusyStage(false); }
  };

  const saveNote = async () => {
    if (!lead?.externalId || !note.trim()) return;
    setBusyNote(true);
    try {
      await api.post(`/api/jobs/${lead.externalId}/note`, { message: note.trim() });
      setMessages((m) => [{ source: 'jobtread', channel: 'note', direction: 'outbound', body: `You: ${note.trim()}`, date: Date.now() }, ...m]);
      flash('Note added to JobTread'); setNote(''); setNoteOpen(false);
    } catch (e: any) { flash(`Couldn't add note: ${e?.message || 'failed'}`); } finally { setBusyNote(false); }
  };

  // An admin's account edit, reflected without reloading the page.
  const applyAccountEdit = (edit: AccountEdit) => {
    const f = edit.fields || {};
    setLead((l) => (l ? {
      ...l,
      ...(edit.customer !== undefined ? { customer: edit.customer } : {}),
      ...(edit.jobName !== undefined ? { jobName: edit.jobName } : {}),
      ...(edit.address !== undefined ? { address: edit.address, addressLine: edit.address } : {}),
      ...(f.projectManager !== undefined ? { projectManager: (f.projectManager as string | null) ?? null } : {}),
      ...(f.isClaim !== undefined ? { insuranceClaim: f.isClaim === true } : {}),
    } : l));
    const { projectManager: _pm, ...insuranceEdits } = f;
    setInsurance((prev) => ({ ...prev, ...insuranceEdits }));
  };

  const saveContact = async () => {
    if (!lead?.externalId) return;
    setBusyContact(true);
    try {
      await api.patch(`/api/leads/${lead.externalId}/contact`, { phone: ePhone.trim(), email: eEmail.trim() });
      setLead((l) => (l ? { ...l, phone: ePhone.trim(), email: eEmail.trim() } : l));
      flash('Contact updated'); setEditing(false);
    } catch (e: any) { flash(`Couldn't update: ${e?.message || 'failed'}`); } finally { setBusyContact(false); }
  };

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-sm text-blue-600 hover:underline py-2 px-1">← Back</button>

      {toast && <div className="rounded-lg bg-gray-900 text-white text-sm px-4 py-2 shadow">{toast}</div>}

      {loading ? (
        <div className="space-y-5 animate-pulse">
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3"><div className="h-6 w-48 bg-gray-100 rounded" /><div className="h-4 w-32 bg-gray-100 rounded" /><div className="flex gap-2 pt-1"><div className="h-8 w-24 bg-gray-100 rounded-lg" /><div className="h-8 w-24 bg-gray-100 rounded-lg" /></div></div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 bg-gray-100 rounded" />)}</div>
          <div className="h-40 bg-gray-100 rounded-xl border border-gray-200" />
        </div>
      ) : error || !lead ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-sm text-red-600 font-medium">Couldn't load this client</p>
          <p className="text-xs text-gray-500 mt-1">{error}</p>
          <button onClick={load} className="mt-3 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg">Retry</button>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-2xl font-bold text-gray-900 truncate" title={lead.customer || lead.jobName || 'Unknown'}>{lead.customer || lead.jobName || 'Unknown'}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
                {lead.jobName && lead.jobName !== lead.customer && <span>{lead.jobName}</span>}
                {lead.insuranceClaim && <span className="text-[11px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">Insurance Claim</span>}
                {lead.externalId && (
                  <a href={`https://app.jobtread.com/jobs/${lead.externalId}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Open in JobTread ↗</a>
                )}
              </div>
            </div>
            {money(lead.projectedValue) && <div className="text-right"><p className="text-xl font-bold text-emerald-700">{money(lead.projectedValue)}</p><p className="text-xs text-gray-400">projected</p></div>}
          </div>

          {lead.source === 'jobtread' && <AccountEditor
            externalId={externalId}
            values={{
              customer: lead.customer,
              jobName: lead.jobName,
              address: lead.addressLine ?? lead.address,
              fields: { ...insurance, isClaim: !!(insurance.isClaim || lead.insuranceClaim), projectManager: lead.projectManager },
            }}
            onSaved={applyAccountEdit}
            flash={flash}
          />}

          {/* Quick actions — Call/Text/Email through GoHighLevel (business number,
              logged on the contact), the same component every other page uses.
              Text jumps to the full thread composer below when GHL has the contact. */}
          {(lead.phone || lead.email) && (
            <div className="flex flex-wrap gap-2">
              <ContactActions externalId={externalId} phone={lead.phone} email={lead.email} size="md" onText={ghlContactId ? focusComposer : undefined} flash={flash} />
            </div>
          )}

          {/* Quick tags → GoHighLevel (can trigger your automations) */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-400">Tag:</span>
            {['🔥 Hot', 'Follow-up', 'Not interested', 'Left voicemail'].map((t) => (
              <button key={t} onClick={() => addTag(t)} disabled={tagging === t} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                {tagging === t ? 'Tagging…' : t}
              </button>
            ))}
          </div>

          {/* Schedule + payment-reminder actions */}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setBookOpen((v) => !v)} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200">📅 Schedule inspection</button>
            {ghlContactId && <button onClick={paymentReminder} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200">💸 Payment reminder</button>}
          </div>
          {bookOpen && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
              <OpenTimes
                durationMins={bk.durationMins}
                value={{ date: bk.date, time: bk.time, forEmail: bk.forEmail }}
                onChange={(c) => setBk((b) => ({ ...b, ...c }))}
                preferRep={lead.repName}
              />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <select value={bk.type} onChange={(e) => setBk({ ...bk, type: e.target.value })} aria-label="Appointment type" className="text-sm border border-gray-200 rounded-lg px-2 py-2 focus:ring-1 focus:ring-blue-400">
                  <option>Inspection</option><option>Adjuster meeting</option><option>Sales appointment</option><option>Install</option>
                </select>
                <input type="date" value={bk.date} onChange={(e) => setBk({ ...bk, date: e.target.value })} min={toDateInput(new Date().toISOString())} aria-label="Date" className="text-sm border border-gray-200 rounded-lg px-2 py-2 focus:ring-1 focus:ring-blue-400" />
                <input type="time" value={bk.time} onChange={(e) => setBk({ ...bk, time: e.target.value })} aria-label="Time" className="text-sm border border-gray-200 rounded-lg px-2 py-2 focus:ring-1 focus:ring-blue-400" />
                <select value={bk.durationMins} onChange={(e) => setBk({ ...bk, durationMins: Number(e.target.value) })} aria-label="Duration" className="text-sm border border-gray-200 rounded-lg px-2 py-2 focus:ring-1 focus:ring-blue-400">
                  <option value={30}>30 min</option><option value={60}>1 hour</option><option value={90}>1.5 hours</option><option value={120}>2 hours</option>
                </select>
              </div>
              <input value={bk.notes} onChange={(e) => setBk({ ...bk, notes: e.target.value })} placeholder="Notes (optional)" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-400" />
              <div className="flex gap-2">
                <button onClick={book} disabled={booking || !bk.date || !bk.time} className="text-sm px-3 py-1.5 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark disabled:opacity-50">{booking ? 'Booking…' : 'Book it'}</button>
                <button onClick={() => setBookOpen(false)} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600">Cancel</button>
              </div>
              <p className="text-xs text-gray-400">Times come from that person's live Google Calendar and GoHighLevel appointments. Booking adds it to their calendar — it'll show on the Schedule tab.</p>
            </div>
          )}

          {/* Status / stage */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-400 mb-1">Stage</p>
              <select value={lead.stage || ''} disabled={busyStage} onChange={(e) => changeStage(e.target.value)}
                className="text-sm px-2 py-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 w-full focus:ring-1 focus:ring-indigo-400">
                {lead.stage && !STAGE_OPTIONS.includes(lead.stage) && <option value={lead.stage}>{lead.stage}</option>}
                {STAGE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <JobReps
              externalId={externalId}
              repName={lead.repName}
              enteredByName={lead.enteredByName}
              onChanged={(name) => setLead((l) => (l ? { ...l, repName: name } : l))}
              flash={flash}
            />
            <div><p className="text-xs text-gray-400 mb-1">Project Mgr</p><p className="text-sm text-gray-800">{lead.projectManager || '—'}</p></div>
            <div><p className="text-xs text-gray-400 mb-1">Schedule</p><p className="text-sm text-gray-800">{fmtDate(lead.scheduleStart) || '—'}{lead.scheduleEnd ? ` – ${fmtDate(lead.scheduleEnd)}` : ''}</p></div>
          </div>

          {/* Job commission — auto-opened when the job is sold; rep + admin checklist, admin approves */}
          <JobCommission externalId={externalId} />

          {/* Insurance claim */}
          {(insurance.isClaim || lead.insuranceClaim) && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">🧾 Insurance Claim</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
                <InsField label="Carrier" value={insurance.carrier} />
                <InsField label="Claim #" value={insurance.claimNumber} />
                <InsField label="Policy #" value={insurance.policyNumber} />
                <InsField label="Date of Loss" value={insurance.dateOfLoss} />
                <InsField label="Type of Loss" value={insurance.typeOfLoss} />
                <InsField label="Adjuster" value={insurance.adjusterName} />
                <InsField label="Adjuster Phone" value={insurance.adjusterPhone} kind="tel" />
                <InsField label="Adjuster Email" value={insurance.adjusterEmail} kind="mailto" />
                <InsField label="Claims Email" value={insurance.claimsEmail} kind="mailto" />
              </div>
            </div>
          )}

          {/* Contact */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800">Contact</h3>
              {!editing && lead.externalId && <button onClick={() => setEditing(true)} className="text-xs text-blue-600 hover:underline">Edit</button>}
            </div>
            {editing ? (
              <div className="space-y-2">
                <input value={ePhone} onChange={(e) => setEPhone(e.target.value)} placeholder="Phone" className="w-full text-sm border border-gray-200 rounded p-2 focus:ring-1 focus:ring-blue-400" />
                <input value={eEmail} onChange={(e) => setEEmail(e.target.value)} placeholder="Email" className="w-full text-sm border border-gray-200 rounded p-2 focus:ring-1 focus:ring-blue-400" />
                <div className="flex gap-2"><button onClick={saveContact} disabled={busyContact} className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-50">Save</button><button onClick={() => { setEditing(false); setEPhone(lead.phone || ''); setEEmail(lead.email || ''); }} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600">Cancel</button></div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400">Phone</p>
                  {lead.phone ? (
                    <span className="flex items-center gap-1.5"><a href={`tel:${lead.phone}`} className="text-blue-600 hover:underline">{formatPhone(lead.phone)}</a><button onClick={() => copy(lead.phone)} className="text-gray-300 hover:text-gray-500" title="Copy" aria-label="Copy phone number">⧉</button></span>
                  ) : <span className="text-gray-400">—</span>}
                </div>
                <div>
                  <p className="text-xs text-gray-400">Email</p>
                  {lead.email ? (
                    <span className="flex items-center gap-1.5 min-w-0"><a href={`mailto:${lead.email}`} className="text-blue-600 hover:underline break-all">{lead.email}</a><button onClick={() => copy(lead.email)} className="text-gray-300 hover:text-gray-500 flex-shrink-0" title="Copy" aria-label="Copy email address">⧉</button></span>
                  ) : <span className="text-gray-400">—</span>}
                </div>
                <div>
                  <p className="text-xs text-gray-400">Address</p>
                  {lead.address ? (
                    <span className="flex items-center gap-1.5"><a href={`https://maps.google.com/?q=${encodeURIComponent(lead.address)}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" title="Directions">{lead.address}</a><button onClick={() => copy(lead.address)} className="text-gray-300 hover:text-gray-500 flex-shrink-0" title="Copy" aria-label="Copy address">⧉</button></span>
                  ) : <span className="text-gray-800">—</span>}
                </div>
              </div>
            )}
          </div>

          {/* Note action */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">Add a note to JobTread</h3>
              {!noteOpen && <button onClick={() => setNoteOpen(true)} className="text-xs text-blue-600 hover:underline">＋ Note</button>}
            </div>
            {noteOpen && (
              <div className="mt-2">
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Type a note…" className="w-full text-sm border border-gray-200 rounded p-2 focus:ring-1 focus:ring-blue-400" />
                <div className="flex gap-2 mt-1"><button onClick={saveNote} disabled={busyNote || !note.trim()} className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white disabled:opacity-50">Save note</button><button onClick={() => { if (note.trim() && !window.confirm('Discard this note?')) return; setNoteOpen(false); setNote(''); }} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600">Cancel</button></div>
              </div>
            )}
          </div>

          {/* Estimates / proposals (JobTread) */}
          {estimatesError && estimates.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-3">
              <p className="text-sm text-red-600">Couldn't load estimates</p>
              <button onClick={loadEstimates} className="text-xs text-blue-600 hover:underline flex-shrink-0">Retry</button>
            </div>
          )}
          {estimates.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-800">📝 Estimates &amp; proposals</h3></div>
              <div className="divide-y divide-gray-50">
                {estimates.map((e) => (
                  <a key={e.id} href={`https://app.jobtread.com/jobs/${externalId}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <span className="text-lg">📝</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{e.name}{e.number ? ` · #${e.number}` : ''}</p>
                      <p className="text-xs text-gray-500">{e.issueDate ? fmtDate(e.issueDate) : ''}</p>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      {money(e.price) && <p className="text-sm font-medium text-emerald-700">{money(e.price)}</p>}
                      {e.status && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 capitalize">{e.status}</span>}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Daily logs (JobTread — production progress) */}
          {dailyLogsError && dailyLogs.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-3">
              <p className="text-sm text-red-600">Couldn't load daily logs</p>
              <button onClick={loadDailyLogs} className="text-xs text-blue-600 hover:underline flex-shrink-0">Retry</button>
            </div>
          )}
          {dailyLogs.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-800">🛠️ Daily logs</h3></div>
              <div className="divide-y divide-gray-50">
                {dailyLogs.map((l) => (
                  <div key={l.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900">{l.date ? fmtDate(l.date) : 'Log'}</p>
                      <p className="text-xs text-gray-400">
                        {l.weather ? <span className="capitalize">{l.weather}</span> : null}
                        {l.maxTemp != null ? ` · ${Math.round(l.maxTemp)}°` : ''}
                        {l.author ? ` · ${l.author}` : ''}
                      </p>
                    </div>
                    {l.notes && <p className="text-sm text-gray-600 mt-0.5 whitespace-pre-wrap">{l.notes}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Job photos (JobTread) — shoot from the field, feeds the reports */}
          <JobPhotos externalId={externalId} />

          {/* Pre-construction checklist — filled at the point the down payment is collected */}
          <PreConstructionChecklist jobExternalId={externalId} stage={lead.stage} />

          {/* Final walkthrough — rep or PM once the crew is off the roof: nail sweep, damage, leftovers */}
          <FinalWalkthrough jobExternalId={externalId} stage={lead.stage} />

          {/* …which writes the certificate of completion, signed by us and then
              by the homeowner over an emailed link. */}
          <CertificateOfCompletion externalId={externalId} />

          {/* Anything the app builds, out for signature by text and email —
              each signer on their own link, and the location recorded with it. */}
          <SignatureRequests externalId={externalId} />


          {/* Field inspection checklist — feeds report generation directly */}
          <InspectionForm jobExternalId={externalId} propertyType={lead.propertyType} />

          {/* Roof reports (Archie) */}
          <RoofReports externalId={externalId} defaultEmail={lead.email} />

          {/* Neighbor letters — knock, email and mail the street while the roof goes up */}
          <StageChecklists externalId={externalId} stage={lead.stage} onOpenPlaybook={onOpenPlaybook} />

          <NeighborLetters externalId={externalId} />

          {/* Everything that goes to a carrier: estimate package, chase, supplement,
              re-inspection, lab results, depreciation release. Always shown — a job
              whose claim flag never got ticked is exactly when someone goes looking. */}
          <InsuranceLetters externalId={externalId} />

          {/* Follow-ups */}
          <FollowUps jobExternalId={externalId} clientName={lead.customer || lead.jobName} />

          {/* Messages */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-800">Messages</h3></div>
            {ghlContactId && (
              <div className="p-3 border-b border-gray-100 flex gap-2">
                <input
                  ref={replyRef}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') sendReply(); }}
                  placeholder="Send a text…"
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-400"
                />
                <button onClick={sendReply} disabled={sendingReply || !reply.trim()} className="text-sm px-3 py-2 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-50">
                  {sendingReply ? '…' : 'Send'}
                </button>
              </div>
            )}
            {msgLoading ? (
              <p className="px-4 py-6 text-center text-sm text-gray-400">Loading messages…</p>
            ) : messagesError ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-red-600">Couldn't load messages</p>
                <button onClick={loadMessages} className="mt-2 text-xs text-blue-600 hover:underline">Retry</button>
              </div>
            ) : messages.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-400">No messages found for this client.</p>
            ) : (
              <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                {messages.map((m, i) => {
                  const icon = m.channel === 'sms' ? '📱' : m.channel === 'email' ? '✉️' : m.channel === 'call' ? '📞' : '📝';
                  const out = m.direction === 'outbound';
                  return (
                    <div key={i} className="flex items-start gap-2.5 px-4 py-2.5">
                      <span className="text-base mt-0.5">{icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-gray-800">
                          {out && <span className="text-gray-400">You: </span>}
                          {m.body || <span className="italic text-gray-400">(no text)</span>}
                        </p>
                        {m.date > 0 && <p className="text-[11px] text-gray-400 mt-0.5">{new Date(m.date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Documents */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-800">Documents {docs.length > 0 && <span className="text-xs text-gray-400 font-normal">({docs.length})</span>}</h3></div>
            {docs.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-400">No documents for this client yet.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {docs.map((d) => (
                  <a
                    key={d.id}
                    href={lead.externalId ? `https://app.jobtread.com/jobs/${lead.externalId}` : undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50"
                  >
                    <span className="text-lg">📄</span>
                    <div className="min-w-0 flex-1"><p className="text-sm font-medium text-gray-900 truncate">{d.type || 'Document'} <span className="text-gray-300 text-xs">↗</span></p><p className="text-xs text-gray-500">{d.signedAt ? `Signed ${fmtDate(d.signedAt)}` : d.issueDate ? `Issued ${fmtDate(d.issueDate)}` : ''}</p></div>
                    <div className="text-right whitespace-nowrap">{money(d.amount) && <p className="text-sm font-medium text-emerald-700">{money(d.amount)}</p>}{d.status && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 capitalize">{d.status}</span>}</div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function InsField({ label, value, kind }: { label: string; value?: string | null; kind?: 'tel' | 'mailto' }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-gray-400">{label}</p>
      {value ? (
        kind ? (
          <a href={`${kind}:${value}`} className="text-blue-600 break-all">{value}</a>
        ) : (
          <span className="text-gray-800 break-words">{value}</span>
        )
      ) : (
        <span className="text-gray-300">—</span>
      )}
    </div>
  );
}
