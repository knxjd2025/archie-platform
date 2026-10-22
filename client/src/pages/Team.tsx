import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { ALL_ROLES, ROLE_LABEL, type TeamRole } from '../../../shared/rbac';
import JobTreadArchivePanel from '../components/JobTreadArchivePanel';

interface Member {
  id: number; name: string; email: string; phone?: string | null; role: TeamRole; active: boolean; canLogin: boolean; seesAllCalendars?: boolean;
  jobtreadSalesRep: string | null; reportsTo: number | null;
}
interface RepSync {
  options: string[];
  mapped: Array<{ repName: string; id: number; name: string; email: string; active: boolean }>;
  unmapped: string[];
  stale: Array<{ id: number; name: string; repName: string }>;
  link: Array<{ id: number; name: string; repName: string }>;
  linked?: number;
}
type Draft = { name: string; email: string; phone: string; role: TeamRole; active: boolean; canLogin: boolean; jobtreadSalesRep: string; reportsTo: string; seesAllCalendars: boolean };
const CUSTOM = '__custom__';

const draftOf = (m: Member): Draft => ({
  name: m.name, email: m.email, phone: m.phone || '', role: m.role, active: m.active, canLogin: m.canLogin, seesAllCalendars: !!m.seesAllCalendars,
  jobtreadSalesRep: m.jobtreadSalesRep || '', reportsTo: m.reportsTo != null ? String(m.reportsTo) : '',
});

const small = 'border border-gray-300 rounded px-2 py-1 text-sm w-full focus:ring-1 focus:ring-blue-500';

// These two live out here, not inside Team: declared in the render body they
// were a new component type every render, so React threw the old one away —
// "Type a name…" reset the custom flag before the input could show, and the
// text box lost focus on every keystroke.
const YesNo = ({ on }: { on: boolean }) => (
  <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${on ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{on ? 'Yes' : 'No'}</span>
);

function RepSelect({ value, onChange, options, allowCustom }: { value: string; onChange: (v: string) => void; options: string[]; allowCustom?: boolean }) {
  const known = options.includes(value);
  const [custom, setCustom] = useState(!!value && !known);
  return (
    <div className="flex flex-col gap-1">
      <select aria-label="JobTread Sales Rep" value={custom ? CUSTOM : value} className={small}
        onChange={(e) => { if (e.target.value === CUSTOM) { setCustom(true); onChange(''); } else { setCustom(false); onChange(e.target.value); } }}>
        <option value="">— not a JobTread sales rep —</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        {allowCustom !== false && <option value={CUSTOM}>Type a name…</option>}
      </select>
      {custom && <input aria-label="Custom JobTread Sales Rep name" placeholder="Exact JobTread dropdown value" value={value} onChange={(e) => onChange(e.target.value)} className={small} />}
    </div>
  );
}

/**
 * Team & Roles — admin only. Every row is editable in place (name, email,
 * phone, role, login, active, who they report to, and which JobTread
 * "Sales Rep" name they are). The JobTread panel shows the dropdown as
 * JobTread has it today, so a rep JobTread knows and the app doesn't is
 * one click from being added.
 */
export default function Team() {
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'sales' as TeamRole, jobtreadSalesRep: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 5000); };

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [jt, setJt] = useState<RepSync | null>(null);
  const [jtError, setJtError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    setLoading(true); setLoadError(null);
    try { setMembers(await api.get<Member[]>('/api/team')); }
    catch (e: any) { setLoadError(e?.message || "Couldn't load team"); }
    finally { setLoading(false); }
  }
  async function loadJt() {
    setJtError(null);
    try { setJt(await api.get<RepSync>('/api/team/jobtread-reps')); }
    catch (e: any) { setJtError(e?.message || "Couldn't read JobTread's sales reps"); }
  }
  useEffect(() => { load(); loadJt(); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSubmitting(true);
    try {
      await api.post('/api/team', { ...form, jobtreadSalesRep: form.jobtreadSalesRep || null });
      setForm({ name: '', email: '', phone: '', role: 'sales', jobtreadSalesRep: '' });
      flash('Added'); await Promise.all([load(), loadJt()]);
    } catch (e: any) { setError(e?.message || 'Something went wrong'); }
    finally { setSubmitting(false); }
  }

  const startEdit = (m: Member) => { setEditingId(m.id); setDraft(draftOf(m)); setEditError(null); };
  const cancelEdit = () => { setEditingId(null); setDraft(null); setEditError(null); };
  async function saveEdit(m: Member) {
    if (!draft) return;
    const patch: Record<string, unknown> = {};
    if (draft.name.trim() !== m.name) patch.name = draft.name.trim();
    if (draft.email.trim().toLowerCase() !== m.email) patch.email = draft.email.trim();
    if ((draft.phone || '') !== (m.phone || '')) patch.phone = draft.phone;
    if (draft.role !== m.role) patch.role = draft.role;
    if (draft.active !== m.active) patch.active = draft.active;
    if (draft.canLogin !== m.canLogin) patch.canLogin = draft.canLogin;
    if ((draft.jobtreadSalesRep || null) !== (m.jobtreadSalesRep || null)) patch.jobtreadSalesRep = draft.jobtreadSalesRep || null;
    const rt = draft.reportsTo ? Number(draft.reportsTo) : null;
    if (rt !== (m.reportsTo ?? null)) patch.reportsTo = rt;
    if (!Object.keys(patch).length) { cancelEdit(); return; }
    if (patch.role && !window.confirm(`Change ${m.name}'s role to ${ROLE_LABEL[draft.role]}? This changes what they can see; it takes effect at their next sign-in.`)) return;
    setSaving(true); setEditError(null);
    try {
      if (draft.seesAllCalendars !== !!m.seesAllCalendars) {
        await api.patch(`/api/team/${m.id}/calendar-access`, { seesAllCalendars: draft.seesAllCalendars });
      }
      const r = await api.patch<Member & { jobtreadRole?: { ok: boolean; reason?: string }; roleChangeNote?: string }>(`/api/team/${m.id}`, patch);
      let msg = `Saved ${r.name}`;
      if (r.roleChangeNote) msg += ` — ${r.roleChangeNote}`;
      if (r.jobtreadRole && !r.jobtreadRole.ok) msg += ` (JobTread role not updated: ${r.jobtreadRole.reason})`;
      flash(msg); cancelEdit(); await Promise.all([load(), loadJt()]);
    } catch (e: any) { setEditError(e?.message || "Couldn't save"); }
    finally { setSaving(false); }
  }

  async function syncFromJobTread() {
    setSyncing(true); setJtError(null);
    try {
      const r = await api.post<RepSync>('/api/sync/jobtread-reps', {});
      setJt(r);
      flash(r.linked ? `Linked ${r.linked} by name from JobTread` : r.unmapped.length ? `JobTread has ${r.unmapped.length} rep${r.unmapped.length === 1 ? '' : 's'} not in the app yet` : 'Roster matches JobTread');
      await load();
    } catch (e: any) { setJtError(e?.message || 'Sync failed'); }
    finally { setSyncing(false); }
  }

  const leaders = useMemo(() => members.filter((m) => m.role === 'manager' || m.role === 'sales_director' || m.role === 'admin'), [members]);
  const repOptions = useMemo(() => {
    const set = new Set<string>(jt?.options || []);
    for (const m of members) if (m.jobtreadSalesRep) set.add(m.jobtreadSalesRep);
    return Array.from(set);
  }, [jt, members]);
  const prefillFromJt = (name: string) => { setForm((f) => ({ ...f, name, jobtreadSalesRep: name, role: 'sales' })); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const input = 'border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Team &amp; Roles</h1>
      {toast && <div className="rounded-lg bg-gray-900 text-white text-sm px-4 py-2 shadow">{toast}</div>}

      <form onSubmit={add} className="flex flex-wrap gap-2 items-end">
        <input required aria-label="Name" placeholder="Name" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
        <input required type="email" aria-label="Email" placeholder="Email" value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} />
        <input type="tel" aria-label="Phone" placeholder="(555) 555-5555" value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })} className={input} />
        <select aria-label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as TeamRole })} className={input}>
          {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <div className="w-56"><RepSelect options={repOptions} value={form.jobtreadSalesRep} onChange={(v) => setForm({ ...form, jobtreadSalesRep: v })} /></div>
        <button disabled={submitting} className="bg-brick text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-brick-dark transition-colors disabled:opacity-50">{submitting ? 'Adding…' : 'Add'}</button>
        {error && <span className="text-sm text-brick">{error}</span>}
      </form>

      <p className="text-xs text-gray-400 -mt-2">
        Admin sees everything · Sales Director sees every record · Sales Leader sees their own reps · Customer Service sees every customer but no money · Sales Rep sees their own book · Production sees the board and schedule.
        The <b>JobTread Sales Rep</b> mapping is what puts a job in someone's book — it must be the exact dropdown value.
      </p>

      {loadError && (
        <div className="flex items-center gap-2 text-sm text-brick"><span>{loadError}</span><button onClick={load} className="underline hover:no-underline">Retry</button></div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100"><tr className="text-left text-gray-500">
              <th className="px-4 py-3 font-medium">Name</th><th className="px-4 py-3 font-medium">Email</th><th className="px-4 py-3 font-medium">Phone</th><th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">JobTread Sales Rep</th><th className="px-4 py-3 font-medium">Reports to</th><th className="px-4 py-3 font-medium">Login</th><th className="px-4 py-3 font-medium">Active</th><th className="px-4 py-3" />
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                [0, 1, 2].map((i) => <tr key={i}><td className="px-4 py-3" colSpan={9}><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)
              ) : members.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">No team members yet — add your first above.</td></tr>
              ) : members.map((m) => {
                const editing = editingId === m.id && draft;
                const leader = m.reportsTo != null ? members.find((x) => x.id === m.reportsTo) : null;
                const jtMissing = !!m.jobtreadSalesRep && jt && !jt.options.some((o) => o.toLowerCase() === m.jobtreadSalesRep!.toLowerCase());
                return editing ? (
                  <tr key={m.id} className="bg-blue-50/40 align-top">
                    <td className="px-4 py-2"><input aria-label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={small} /></td>
                    <td className="px-4 py-2"><input aria-label="Email" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={small} /></td>
                    <td className="px-4 py-2"><input aria-label="Phone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className={small} /></td>
                    <td className="px-4 py-2">
                      <select aria-label="Role" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as TeamRole })} className={small}>
                        {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2 min-w-[12rem]"><RepSelect options={repOptions} value={draft.jobtreadSalesRep} onChange={(v) => setDraft({ ...draft, jobtreadSalesRep: v })} /></td>
                    <td className="px-4 py-2">
                      <select aria-label="Reports to" value={draft.reportsTo} onChange={(e) => setDraft({ ...draft, reportsTo: e.target.value })} className={small}>
                        <option value="">—</option>
                        {leaders.filter((l) => l.id !== m.id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={draft.canLogin} onChange={(e) => setDraft({ ...draft, canLogin: e.target.checked })} /> Can sign in</label>
                      <label className="flex items-center gap-1 text-xs mt-1" title="Sees every team member's calendar on the Schedule tab — for someone who books appointments for the whole team."><input type="checkbox" checked={draft.seesAllCalendars} onChange={(e) => setDraft({ ...draft, seesAllCalendars: e.target.checked })} /> All calendars</label>
                    </td>
                    <td className="px-4 py-2"><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active</label></td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <button onClick={() => saveEdit(m)} disabled={saving} className="text-xs px-2.5 py-1 rounded-lg bg-blue-600 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
                      <button onClick={cancelEdit} disabled={saving} className="ml-1 text-xs px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600">Cancel</button>
                      {editError && <p className="text-xs text-brick mt-1 max-w-[14rem]">{editError}</p>}
                    </td>
                  </tr>
                ) : (
                  <tr key={m.id} className={`hover:bg-gray-50 ${!m.active ? 'text-gray-400' : ''}`}>
                    <td className="px-4 py-3 font-medium text-gray-900">{m.name}</td>
                    <td className="px-4 py-3 text-gray-600">{m.email}</td>
                    <td className="px-4 py-3 text-gray-600">{m.phone || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{ROLE_LABEL[m.role] || m.role}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {m.jobtreadSalesRep || <span className="text-gray-300">—</span>}
                      {jtMissing && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title="JobTread's Sales Rep dropdown no longer has this value — jobs can't be attributed to it">not in JobTread</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{leader?.name || '—'}</td>
                    <td className="px-4 py-3"><YesNo on={m.canLogin} />{m.seesAllCalendars && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700" title="Sees every calendar">📅 all</span>}</td>
                    <td className="px-4 py-3"><YesNo on={m.active} /></td>
                    <td className="px-4 py-3 text-right"><button onClick={() => startEdit(m)} className="text-xs text-blue-600 hover:underline">Edit</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* JobTread's dropdown vs. the roster */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Sales reps in JobTread</h2>
            <p className="text-xs text-gray-400">The job "Sales Rep" dropdown as JobTread has it right now. Each name should be one person here. Runs on its own every hour; names that match a team member exactly are linked automatically.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadJt} className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">Refresh</button>
            <button onClick={syncFromJobTread} disabled={syncing} className="text-xs px-3 py-1.5 rounded-lg bg-navy text-white font-medium disabled:opacity-50">{syncing ? 'Syncing…' : 'Sync from JobTread'}</button>
          </div>
        </div>
        {jtError ? (
          <div className="px-4 py-4 flex items-center gap-2 text-sm text-brick"><span>{jtError}</span><button onClick={loadJt} className="underline">Retry</button></div>
        ) : !jt ? (
          <p className="px-4 py-4 text-sm text-gray-400">Reading JobTread…</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {jt.unmapped.length > 0 && (
              <div className="px-4 py-3 bg-amber-50/60">
                <p className="text-xs font-semibold text-amber-800 mb-1.5">In JobTread, not in the app ({jt.unmapped.length}) — their jobs are in nobody's book until they're added</p>
                <div className="flex flex-wrap gap-2">
                  {jt.unmapped.map((n) => (
                    <button key={n} onClick={() => prefillFromJt(n)} className="text-xs px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-amber-900 hover:bg-amber-100">＋ Add {n}</button>
                  ))}
                </div>
              </div>
            )}
            {jt.stale.length > 0 && (
              <div className="px-4 py-3">
                <p className="text-xs font-semibold text-gray-700 mb-1">Mapped here, but JobTread's dropdown no longer has the name</p>
                <ul className="text-xs text-gray-600 space-y-0.5">{jt.stale.map((s) => <li key={s.id}>{s.name} → "{s.repName}"</li>)}</ul>
              </div>
            )}
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-50">
                {jt.options.map((o) => {
                  const m = jt.mapped.find((x) => x.repName.toLowerCase() === o.toLowerCase());
                  const placeholder = ['other', 'unassigned', 'none', 'n/a', 'tbd'].includes(o.toLowerCase());
                  return (
                    <tr key={o}>
                      <td className="px-4 py-2 text-gray-900 w-1/3">{o}</td>
                      <td className="px-4 py-2 text-gray-600">
                        {m ? <>{m.name} <span className="text-gray-400">· {m.email}</span>{!m.active && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">inactive</span>}</>
                          : placeholder ? <span className="text-gray-400">placeholder, not a person</span>
                          : <span className="text-amber-700">not in the app</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <JobTreadArchivePanel />
    </div>
  );
}
