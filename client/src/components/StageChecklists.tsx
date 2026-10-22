import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { STAGE_CHECKLISTS, stageForColumn } from '../../../shared/playbook';

type Items = Record<string, { by: string; at: string; followUpIds?: number[] }>;
interface State { stage: string | null; currentChecklist: string | null; checklists: { key: string; items: Items }[] }

/**
 * The five job-stage checklists from the sales playbook, on the job. The
 * stage JobTread has the job in is open by default; every tick is shared
 * with the office (who, when), and steps that have a template open it in
 * the Playbook already filled in for this customer.
 */
export default function StageChecklists({ externalId, stage, onOpenPlaybook }: { externalId: string; stage: string | null; onOpenPlaybook?: (docId: string) => void }) {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    api.get<State>(`/api/clients/${externalId}/checklists`)
      .then((r) => { setS(r); setOpen(r.currentChecklist ?? (stageForColumn(stage)?.key ?? null)); })
      .catch((e: any) => setError(e?.message || 'Could not load the checklists.'));
  }, [externalId, stage]);

  const toggle = async (key: string, item: string, done: boolean) => {
    setBusy(`${key}/${item}`);
    try {
      const r = await api.put<{ items: Items; followUpsCreated: number }>(`/api/clients/${externalId}/checklists/${key}/items/${item}`, { done });
      // Take only this item from the reply. The reply carries the whole list as
      // the server saw it at that moment, so two quick ticks answering out of
      // order had the older reply wipe the newer tick off the screen.
      const mine = r.items?.[item];
      setS((cur) => cur ? {
        ...cur,
        checklists: cur.checklists.map((c) => {
          if (c.key !== key) return c;
          const { [item]: _old, ...rest } = c.items;
          return { ...c, items: mine ? { ...rest, [item]: mine } : rest };
        }),
      } : cur);
      if (r.followUpsCreated) flash(`${r.followUpsCreated} follow-ups scheduled for you`);
    } catch (e: any) { flash(`Couldn't save: ${e?.message || 'failed'}`); }
    finally { setBusy(null); }
  };

  const current = s?.currentChecklist ?? stageForColumn(stage)?.key ?? null;
  const total = STAGE_CHECKLISTS.reduce((n, c) => n + c.items.length, 0);
  const doneCount = s ? s.checklists.reduce((n, c) => n + Object.keys(c.items).length, 0) : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">✅ Job checklists</h3>
          <p className="text-xs text-gray-400">{current ? `This job is in ${STAGE_CHECKLISTS.find((c) => c.key === current)?.title}.` : 'Opens automatically once the job is sold.'} {s ? `${doneCount} of ${total} steps done.` : ''}</p>
        </div>
      </div>
      {toast && <div className="mx-4 mt-3 rounded-lg bg-gray-900 text-white text-sm px-3 py-2">{toast}</div>}
      {error && <p className="px-4 py-3 text-sm text-red-600">{error}</p>}
      <div className="divide-y divide-gray-100">
        {STAGE_CHECKLISTS.map((c) => {
          const items = s?.checklists.find((x) => x.key === c.key)?.items ?? {};
          const n = Object.keys(items).length;
          const isOpen = open === c.key;
          const isCurrent = current === c.key;
          return (
            <div key={c.key}>
              <button onClick={() => setOpen(isOpen ? null : c.key)} className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50">
                <span className="flex items-center gap-2 text-sm">
                  <span className={`font-medium ${n === c.items.length ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{c.title}</span>
                  {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">Current stage</span>}
                </span>
                <span className="text-xs text-gray-400">{n}/{c.items.length} {isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && (
                <ul className="px-4 pb-3 space-y-1.5">
                  <li className="text-[11px] text-gray-400">{c.when}.</li>
                  {c.items.map((it) => {
                    const d = items[it.key];
                    const id = `${c.key}/${it.key}`;
                    return (
                      <li key={it.key} className="flex items-start gap-2">
                        <button type="button" disabled={busy === id || !s} onClick={() => toggle(c.key, it.key, !d)} className="flex items-start gap-2 text-sm text-gray-800 text-left flex-1 disabled:opacity-60" aria-pressed={!!d}>
                          <span className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[10px] text-white ${d ? 'bg-blue-700 border-blue-700' : 'border-gray-300'}`}>{d ? '✓' : ''}</span>
                          <span>
                            <span className={d ? 'text-gray-400 line-through' : ''}>{it.label}</span>
                            {d && <span className="block text-[10px] text-gray-400 no-underline">{d.by} · {fmtDate(d.at)}{d.followUpIds?.length ? ` · ${d.followUpIds.length} follow-ups scheduled` : ''}</span>}
                          </span>
                        </button>
                        {it.doc && onOpenPlaybook && <button onClick={() => onOpenPlaybook(it.doc!)} className="text-[11px] text-blue-600 hover:underline whitespace-nowrap pt-0.5">Open template →</button>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
