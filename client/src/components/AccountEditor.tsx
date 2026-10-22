/**
 * Admin-only: correct anything on the client's account at any stage — the
 * customer and job names, the address, the project manager and every
 * insurance-claim detail. Saves to JobTread, the source of truth. Reps,
 * stage, contact info and commission each have their own control on the page.
 */
import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { atLeast } from '../../../shared/rbac';
import { ACCOUNT_JOB_FIELDS, type AccountEdit, type AccountFieldKey } from '../../../shared/client-account';

interface FieldWithOptions { key: AccountFieldKey; label: string; kind: string; options: string[] }

export interface AccountValues {
  customer: string | null;
  jobName: string | null;
  address: string | null;
  fields: Partial<Record<AccountFieldKey, string | boolean | null>>;
}

interface Props {
  externalId: string;
  values: AccountValues;
  onSaved: (edit: AccountEdit) => void;
  flash: (m: string) => void;
}

const asText = (v: string | boolean | null | undefined) => (typeof v === 'string' ? v : '');

export default function AccountEditor({ externalId, values, onSaved, flash }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [defs, setDefs] = useState<FieldWithOptions[]>(ACCOUNT_JOB_FIELDS.map((f) => ({ ...f, options: [] })));
  const [customer, setCustomer] = useState('');
  const [jobName, setJobName] = useState('');
  const [address, setAddress] = useState('');
  const [fields, setFields] = useState<Partial<Record<AccountFieldKey, string | boolean>>>({});

  if (!user || !atLeast(user.role, 'admin')) return null;

  const start = () => {
    setCustomer(values.customer || '');
    setJobName(values.jobName || '');
    setAddress(values.address || '');
    setFields(Object.fromEntries(ACCOUNT_JOB_FIELDS.map((f) => [f.key, f.kind === 'boolean' ? values.fields[f.key] === true : asText(values.fields[f.key])])));
    setOpen(true);
    api.get<{ fields: FieldWithOptions[] }>('/api/jobtread/account-fields')
      .then((r) => { if (r.fields?.length) setDefs(r.fields); })
      .catch(() => { /* free-text inputs still work without JobTread's dropdown choices */ });
  };

  // Send only what changed, so a save never rewrites a field nobody touched.
  const buildEdit = (): AccountEdit => {
    const edit: AccountEdit = {};
    if (customer.trim() !== (values.customer || '').trim()) edit.customer = customer;
    if (jobName.trim() !== (values.jobName || '').trim()) edit.jobName = jobName;
    if (address.trim() !== (values.address || '').trim()) edit.address = address;
    const changed: NonNullable<AccountEdit['fields']> = {};
    for (const f of ACCOUNT_JOB_FIELDS) {
      const now = fields[f.key];
      if (f.kind === 'boolean') {
        if ((now === true) !== (values.fields[f.key] === true)) changed[f.key] = now === true;
      } else if (asText(now).trim() !== asText(values.fields[f.key]).trim()) {
        changed[f.key] = asText(now).trim() || null;
      }
    }
    if (Object.keys(changed).length) edit.fields = changed;
    return edit;
  };

  const save = async () => {
    const edit = buildEdit();
    if (!Object.keys(edit).length) { setOpen(false); return; }
    setSaving(true);
    try {
      await api.patch(`/api/clients/${externalId}/account`, edit);
      onSaved(edit);
      flash('Account saved to JobTread ✅');
      setOpen(false);
    } catch (e: any) { flash(`Couldn't save: ${e?.message || 'failed'}`); }
    finally { setSaving(false); }
  };

  if (!open) {
    return <button onClick={start} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200">✏️ Edit account</button>;
  }

  const input = 'w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:ring-1 focus:ring-blue-400';
  const setField = (k: AccountFieldKey, v: string | boolean) => setFields((prev) => ({ ...prev, [k]: v }));

  return (
    <div className="bg-white rounded-xl border border-blue-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">✏️ Edit account <span className="text-xs font-normal text-gray-400">(admin)</span></h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-xs text-gray-600">Customer name<input value={customer} onChange={(e) => setCustomer(e.target.value)} className={`mt-1 ${input}`} /></label>
        <label className="block text-xs text-gray-600">Job name<input value={jobName} onChange={(e) => setJobName(e.target.value)} className={`mt-1 ${input}`} /></label>
        <label className="block text-xs text-gray-600 sm:col-span-2">Address<input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, City, ST 00000" className={`mt-1 ${input}`} /></label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {defs.map((f) => {
          if (f.kind === 'boolean') {
            return (
              <label key={f.key} className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-3">
                <input type="checkbox" checked={fields[f.key] === true} onChange={(e) => setField(f.key, e.target.checked)} />
                {f.label}
              </label>
            );
          }
          const value = asText(fields[f.key]);
          return (
            <label key={f.key} className="block text-xs text-gray-600">
              {f.label}
              {f.options.length ? (
                <select value={value} onChange={(e) => setField(f.key, e.target.value)} className={`mt-1 ${input}`}>
                  <option value="">—</option>
                  {value && !f.options.includes(value) && <option value={value}>{value}</option>}
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={f.kind === 'date' ? 'date' : f.kind === 'email' ? 'email' : f.kind === 'phone' ? 'tel' : 'text'}
                  value={value}
                  onChange={(e) => setField(f.key, e.target.value)}
                  className={`mt-1 ${input}`}
                />
              )}
            </label>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Save to JobTread'}</button>
        <button onClick={() => setOpen(false)} disabled={saving} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600">Cancel</button>
      </div>
      <p className="text-[11px] text-gray-400">Projected value and the schedule come from the estimate and tasks in JobTread, so they're changed there. Reps, stage, phone/email and commission each have their own edit on this page.</p>
    </div>
  );
}
