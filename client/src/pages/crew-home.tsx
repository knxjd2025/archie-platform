import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { prepareArchiePhoto } from '../components/JobPhotos';
import {
  CREW_WORDS, STATUS_CHIP, addressLine, directionsUrl, groupCrewJobs, nextCrewStep, telHref, whenLine, type CrewJob,
} from '../lib/crews-view';

interface CrewPhoto { id: string; thumbUrl: string; url: string; caption: string | null; phase: 'before' | 'during' | 'after' | null }

/**
 * A crew member's phone, in a company Roof Lee made: the jobs booked for
 * their crew, and for each one the address, the day, the work to do, a tick
 * for each trade, Start and Done, and photos. Nothing on it shows a price:
 * the server sends an allow-list with no money in it (server/crews/view.ts).
 * The homeowner's phone appears only when the server sends it, which is only
 * around the install days.
 */
export default function CrewHome() {
  const { user } = useAuth();
  const [data, setData] = useState<{ crewName: string | null; today: string; jobs: CrewJob[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get('/api/crew/jobs'));
    } catch (e: any) {
      setError(e?.message || 'Couldn\'t load your jobs.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const job = data?.jobs.find((j) => j.jobKey === open) ?? null;
  const replace = (next: CrewJob) => setData((d) => (d ? { ...d, jobs: d.jobs.map((j) => (j.jobKey === next.jobKey ? next : j)) } : d));

  if (job) return <CrewJobPage job={job} onBack={() => { setOpen(null); load(); }} onChanged={replace} />;

  const firstName = (user?.name || '').split(' ')[0] || 'there';
  const groups = data ? groupCrewJobs(data.jobs, data.today) : null;

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Hi {firstName}</h2>
        <p className="text-sm text-gray-500">{data?.crewName ? `${CREW_WORDS.myJobs} · ${data.crewName}` : CREW_WORDS.myJobs}</p>
      </div>
      {error ? (
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={load} className="mt-2 px-3 py-1.5 text-sm bg-gray-100 rounded-lg">Try again</button>
        </div>
      ) : !data || !groups ? (
        <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : !data.crewName ? (
        <p className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-500">{CREW_WORDS.noCrew}</p>
      ) : data.jobs.length === 0 ? (
        <p className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-500">{CREW_WORDS.noJobs}</p>
      ) : (
        ([['today', CREW_WORDS.today], ['comingUp', CREW_WORDS.comingUp], ['done', CREW_WORDS.done]] as const).map(([key, label]) => groups[key].length > 0 && (
          <section key={key}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">{label}</h3>
            <ul className="space-y-2">
              {groups[key].map((j) => (
                <li key={j.jobKey}>
                  <button onClick={() => setOpen(j.jobKey)} className="w-full text-left bg-white rounded-xl border border-gray-200 p-4 hover:bg-gray-50 active:bg-gray-100">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-gray-900">{j.customer || j.jobName || 'Job'}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_CHIP[j.status]}`}>{j.statusLabel}</span>
                    </div>
                    <p className="text-sm text-gray-600 mt-0.5">{addressLine(j) || 'No address yet'}</p>
                    <p className="text-xs text-gray-500 mt-1">{whenLine(j)}</p>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function CrewJobPage({ job, onBack, onChanged }: { job: CrewJob; onBack: () => void; onChanged: (j: CrewJob) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [photos, setPhotos] = useState<CrewPhoto[]>([]);
  const [phase, setPhase] = useState<'during' | 'after'>(job.status === 'done' ? 'after' : 'during');
  const [saving, setSaving] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const base = `/api/crew/jobs/${job.jobKey}`;

  const loadPhotos = useCallback(async () => {
    try {
      const r = await api.get<{ photos: CrewPhoto[] }>(`${base}/photos`);
      setPhotos(r.photos);
    } catch { /* the job still shows without its photos */ }
  }, [base]);
  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  const act = async (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(true); setMessage(null);
    try {
      const r = await api.post<{ job: CrewJob }>(`${base}/${path}`, body);
      onChanged(r.job);
      setMessage({ ok: true, text: done });
    } catch (e: any) {
      setMessage({ ok: false, text: e?.message || 'That didn\'t save. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const step = nextCrewStep(job.status);
  const pressStep = () => {
    if (step === 'done' && !window.confirm(CREW_WORDS.finishCheck)) return;
    if (step) act('status', { status: step }, step === 'done' ? 'Job marked done' : 'Job started');
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setMessage(null);
    let failed = 0;
    for (const file of Array.from(files)) {
      setSaving((n) => n + 1);
      try {
        const p = await prepareArchiePhoto(file);
        await api.post(`${base}/photos`, { ...p, contentType: 'image/jpeg', phase }, { timeoutMs: 120_000 });
      } catch {
        failed += 1;
      } finally {
        setSaving((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
    setMessage(failed ? { ok: false, text: `${failed} photo${failed === 1 ? '' : 's'} didn't save. Please try again.` } : { ok: true, text: CREW_WORDS.saved });
    loadPhotos();
  };

  const map = directionsUrl(job);
  const call = telHref(job.homeownerPhone);

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <button onClick={onBack} className="text-sm text-blue-600">← {CREW_WORDS.back}</button>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-xl font-bold text-gray-900">{job.customer || job.jobName || 'Job'}</h2>
          <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_CHIP[job.status]}`}>{job.statusLabel}</span>
        </div>
        <p className="text-sm text-gray-700 mt-1">{addressLine(job) || 'No address yet'}</p>
        {map && <a href={map} target="_blank" rel="noreferrer" className="inline-block mt-1 text-sm text-blue-600">{CREW_WORDS.directions} ↗</a>}
        {call && (
          <div className="mt-2">
            <a href={call} className="inline-block text-sm text-blue-600">📞 {CREW_WORDS.callHomeowner}: {job.homeownerPhone}</a>
            <p className="text-xs text-gray-500">{CREW_WORDS.callOnly}</p>
          </div>
        )}
        <p className="text-sm text-gray-600 mt-2">{whenLine(job)}</p>
        {job.jobType && <p className="text-xs text-gray-500 mt-0.5 capitalize">{job.jobType}</p>}
        {job.notes && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-100 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">{CREW_WORDS.notes}</p>
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{job.notes}</p>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-800">The work</h3>
        <ul className="space-y-1">
          {job.trades.map((t) => (
            <li key={t.key} className={`text-sm flex items-center gap-2 ${t.done ? 'text-emerald-700' : 'text-gray-700'}`}>
              <span aria-hidden>{t.done ? '✓' : '○'}</span>{t.label}{t.done ? ' (finished)' : ''}
            </li>
          ))}
        </ul>
        {job.status === 'in_progress' && job.currentTrade && (
          <button disabled={busy} onClick={() => act('trade-done', { trade: job.currentTrade }, CREW_WORDS.tradeDone(job.trades.find((t) => t.key === job.currentTrade)?.label || 'Trade'))}
            className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium disabled:opacity-50">
            ✓ {CREW_WORDS.tradeDone(job.trades.find((t) => t.key === job.currentTrade)?.label || 'Trade')}
          </button>
        )}
        {step && (
          <button disabled={busy} onClick={pressStep}
            className={`w-full py-3 rounded-xl font-medium disabled:opacity-50 ${step === 'in_progress' ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white'}`}>
            {step === 'in_progress' ? CREW_WORDS.start : CREW_WORDS.finish}
          </button>
        )}
        {message && <p className={`text-sm ${message.ok ? 'text-emerald-700' : 'text-red-600'}`} role="status">{message.text}</p>}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-800">{CREW_WORDS.photos}</h3>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs" role="group" aria-label="Photo taken">
            {(['during', 'after'] as const).map((p) => (
              <button key={p} onClick={() => setPhase(p)} aria-pressed={phase === p}
                className={`px-3 py-1.5 ${phase === p ? 'bg-ink text-white' : 'bg-white text-gray-700'}`}>{p === 'during' ? 'During' : 'After'}</button>
            ))}
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} className="w-full py-3 rounded-xl border-2 border-dashed border-gray-300 text-gray-700 font-medium">
          📷 {saving > 0 ? CREW_WORDS.saving : CREW_WORDS.addPhoto}
        </button>
        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block aspect-square rounded-lg overflow-hidden bg-gray-100">
                <img src={p.thumbUrl} alt={p.caption || 'Job photo'} className="w-full h-full object-cover" loading="lazy" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
