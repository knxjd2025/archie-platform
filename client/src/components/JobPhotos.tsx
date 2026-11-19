import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { exifTakenAt, EXIF_READ_BYTES } from '../lib/photo-exif';
import {
  CATEGORY_LABEL, PHASE_FILTERS, PHASE_LABEL, PHOTO_CATEGORIES, PHOTO_PHASES, PHOTO_WORDS,
  photoDetails, photoPagePath, uploadSummary,
  type ArchiePhoto, type ArchiePhotoPage, type PhaseFilter, type PhotoCategory, type PhotoPhase,
} from '../lib/job-photos-view';

interface Photo { id: string; name: string; url: string | null; description: string | null; createdAt: string | null }

/** Downscale on-device before upload: phone photos are 3-8MB, reports need ~1600px. */
export const MAX_EDGE = 1600;
/** The small copy a job's photo grid shows. */
export const THUMB_EDGE = 400;
const QUALITY = 0.82;

function drawJpeg(bitmap: ImageBitmap, maxEdge: number): string {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process that photo.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', QUALITY).split(',')[1] || '';
}

export async function shrinkImage(file: File, maxEdge = MAX_EDGE): Promise<{ base64: string; contentType: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    return { base64: drawJpeg(bitmap, maxEdge), contentType: 'image/jpeg' };
  } finally {
    bitmap.close?.();
  }
}

/**
 * A photo ready to send for a job Archie keeps: the date it was taken, read
 * from the photo itself BEFORE it is redrawn (the redraw drops every metadata
 * block, location included), then a working copy and a small copy, both
 * redrawn as plain JPEGs.
 */
async function prepareArchiePhoto(file: File): Promise<{ base64: string; thumbBase64: string; takenAt: string | null }> {
  const takenAt = exifTakenAt(await file.slice(0, EXIF_READ_BYTES).arrayBuffer());
  const bitmap = await createImageBitmap(file);
  try {
    return { base64: drawJpeg(bitmap, MAX_EDGE), thumbBase64: drawJpeg(bitmap, THUMB_EDGE), takenAt };
  } finally {
    bitmap.close?.();
  }
}

/**
 * A job's photos. For a job kept in JobTread they come straight from
 * JobTread, exactly as before. A job Archie keeps itself (`keptInArchie`, a
 * company Roof Lee made) keeps its photos in Archie's own private store, with
 * a phase, an optional caption and what they show; it has no JobTread and
 * cannot use CompanyCam, so neither is offered.
 */
export default function JobPhotos({ externalId, onChanged, keptInArchie = false }: { externalId: string; onChanged?: () => void; keptInArchie?: boolean }) {
  return keptInArchie
    ? <ArchieJobPhotos externalId={externalId} onChanged={onChanged} />
    : <JobTreadJobPhotos externalId={externalId} onChanged={onChanged} />;
}

// ---------------------------------------------------------------- a job kept in JobTread (as before)

function JobTreadJobPhotos({ externalId, onChanged }: { externalId: string; onChanged?: () => void }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [cc, setCc] = useState<{ configured: boolean; project: { id: string; name?: string } | null; photos: { id: string; url: string }[] } | null>(null);
  const [pushing, setPushing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 5000); };

  const load = () => {
    setLoadError(null);
    return api.get<{ photos: Photo[] }>(`/api/clients/${externalId}/photos`)
      .then((r) => setPhotos(r.photos || []))
      .catch(() => setLoadError('Couldn\'t load photos.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [externalId]);

  // CompanyCam: photos already reach us via JobTread, but this shows the project
  // directly and lets a rep push photos the other way.
  useEffect(() => {
    api.get<{ configured: boolean; project: any; photos: any[] }>(`/api/clients/${externalId}/companycam`)
      .then((r) => setCc(r as any))
      .catch(() => {});
  }, [externalId]);

  const pushToCompanyCam = async (createProject = false) => {
    if (pushing) return;
    setPushing(true);
    try {
      const r = await api.post<{ pushed: number; attempted: number }>(`/api/clients/${externalId}/companycam/push`, { createProject });
      flash(`Pushed ${r.pushed} of ${r.attempted} photos to CompanyCam ✅`);
    } catch (e: any) {
      const msg = e?.message || 'failed';
      if (/No matching CompanyCam project/i.test(msg) && !createProject) {
        if (window.confirm('No CompanyCam project matches this address. Create one and push the photos?')) {
          setPushing(false);
          return pushToCompanyCam(true);
        }
        flash('Nothing pushed.');
      } else flash(`Couldn't push: ${msg}`);
    } finally { setPushing(false); }
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // let the same file be re-picked later
    if (!files.length) return;

    setBusy({ done: 0, total: files.length });
    let ok = 0; let failed = 0;
    const failedNames: string[] = [];
    for (const [i, file] of files.entries()) {
      try {
        const { base64, contentType } = await shrinkImage(file);
        await api.post(`/api/clients/${externalId}/photos`, { name: file.name, base64, contentType });
        ok++;
      } catch (err: any) {
        failed++;
        failedNames.push(file.name);
        console.error('photo upload failed', err);
      }
      setBusy({ done: i + 1, total: files.length });
    }
    setBusy(null);
    if (failed) {
      const shown = failedNames.slice(0, 3).join(', ');
      const more = failedNames.length > 3 ? ` +${failedNames.length - 3} more` : '';
      flash(`${ok} uploaded, ${failed} failed. Failed: ${shown}${more}`);
    } else {
      flash(`${ok} photo${ok > 1 ? 's' : ''} added to the job ✅`);
    }
    await load();
    onChanged?.();
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">📸 Job photos{photos.length ? <span className="text-gray-400 font-normal"> · {photos.length}</span> : null}</h3>
        <div className="flex items-center gap-2">
        {cc?.configured && photos.length > 0 && (
          <button
            onClick={() => pushToCompanyCam(false)}
            disabled={pushing}
            title={cc.project ? `Push these photos into the CompanyCam project "${cc.project.name || cc.project.id}"` : 'Push these photos to CompanyCam'}
            className="text-xs px-2.5 py-1 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 disabled:opacity-50"
          >
            {pushing ? 'Pushing…' : '📷 → CompanyCam'}
          </button>
        )}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={!!busy}
          // The most-used field action in the app — sized for a thumb, the way
          // canvass.tsx sizes its one-handed controls.
          className="text-xs px-3 py-2 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark disabled:opacity-50"
        >
          {busy ? `Uploading ${busy.done}/${busy.total}…` : '＋ Add photos'}
        </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" onChange={onPick} className="hidden" />
      </div>

      {toast && <div className="px-4 py-2 text-sm bg-gray-900 text-white">{toast}</div>}

      {loading ? (
        <div className="p-3 grid grid-cols-3 sm:grid-cols-5 gap-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="aspect-square bg-gray-100 rounded-lg animate-pulse" />)}</div>
      ) : loadError ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">
          <p>Couldn't load photos.</p>
          <button onClick={load} className="mt-2 text-sm text-blue-600 hover:underline">Retry</button>
        </div>
      ) : photos.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-400">No photos on this job yet, add some from your phone and they'll go straight into your CRM.</p>
      ) : (
        <div className="p-3 grid grid-cols-3 sm:grid-cols-5 gap-2">
          {photos.slice(0, 15).map((p) => (
            p.url ? (
              <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" title={p.description || p.name} className="block aspect-square rounded-lg overflow-hidden bg-gray-100">
                <img src={p.url} alt={p.name} loading="lazy" className="w-full h-full object-cover hover:opacity-90 transition-opacity" />
              </a>
            ) : (
              <div key={p.id} title={p.description || p.name} className="block aspect-square rounded-lg overflow-hidden bg-gray-100" />
            )
          ))}
          {photos.length > 15 && (
            <div className="aspect-square rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center text-xs text-gray-500">+{photos.length - 15}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- a job Archie keeps

/** One photo on its way to the store: shown in the grid with "Saving..." until it lands. */
interface Upload {
  key: string;
  file: File;
  preview: string;
  phase: PhotoPhase;
  category: PhotoCategory | '';
  caption: string;
  state: 'saving' | 'failed';
  error?: string;
}

const chip = (on: boolean) => `px-3 py-1.5 rounded-lg text-xs font-medium border ${on ? 'bg-brand text-on-brand border-transparent' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'}`;

function PhasePicker({ value, onChange, disabled }: { value: PhotoPhase | null; onChange: (p: PhotoPhase) => void; disabled?: boolean }) {
  return (
    <div className="flex gap-1.5" role="radiogroup">
      {PHOTO_PHASES.map((p) => (
        <button key={p} type="button" role="radio" aria-checked={value === p} disabled={disabled} onClick={() => onChange(p)} className={chip(value === p)}>
          {PHASE_LABEL[p]}
        </button>
      ))}
    </div>
  );
}

function CategorySelect({ value, onChange, disabled }: { value: PhotoCategory | ''; onChange: (c: PhotoCategory | '') => void; disabled?: boolean }) {
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as PhotoCategory | '')}
      className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
      <option value="">{PHOTO_WORDS.categoryNone}</option>
      {PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
    </select>
  );
}

function ArchieJobPhotos({ externalId, onChanged }: { externalId: string; onChanged?: () => void }) {
  const [photos, setPhotos] = useState<ArchiePhoto[]>([]);
  const [total, setTotal] = useState(0);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [filter, setFilter] = useState<PhaseFilter>('all');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [phase, setPhase] = useState<PhotoPhase>('before');
  const [category, setCategory] = useState<PhotoCategory | ''>('');
  const [caption, setCaption] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [open, setOpen] = useState<ArchiePhoto | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 5000); };
  const saving = uploads.some((u) => u.state === 'saving');

  const load = useCallback(() => {
    setLoadError(false);
    return api.get<ArchiePhotoPage>(photoPagePath(externalId, filter))
      .then((r) => { setPhotos(r.photos || []); setTotal(r.totalFiles || 0); setNextBefore(r.nextBefore ?? null); })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [externalId, filter]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api.get<ArchiePhotoPage>(photoPagePath(externalId, filter, nextBefore));
      setPhotos((have) => [...have, ...r.photos.filter((p) => !have.some((h) => h.id === p.id))]);
      setTotal(r.totalFiles || 0);
      setNextBefore(r.nextBefore ?? null);
    } catch {
      flash(PHOTO_WORDS.loadFailed);
    } finally {
      setLoadingMore(false);
    }
  };

  /** Sends one photo. True when it landed. */
  const send = async (u: Upload): Promise<boolean> => {
    setUploads((list) => list.map((x) => (x.key === u.key ? { ...x, state: 'saving', error: undefined } : x)));
    try {
      const ready = await prepareArchiePhoto(u.file);
      await api.post(`/api/clients/${externalId}/photos`, {
        ...ready, contentType: 'image/jpeg', phase: u.phase, category: u.category || undefined, caption: u.caption.trim() || undefined,
      }, { timeoutMs: 120_000 });
      setUploads((list) => list.filter((x) => x.key !== u.key));
      URL.revokeObjectURL(u.preview);
      return true;
    } catch (err: any) {
      setUploads((list) => list.map((x) => (x.key === u.key ? { ...x, state: 'failed', error: err?.message || PHOTO_WORDS.notSaved } : x)));
      return false;
    }
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // let the same file be re-picked later
    if (!files.length) return;
    const batch: Upload[] = files.map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`, file, preview: URL.createObjectURL(file), phase, category, caption, state: 'saving',
    }));
    setUploads((list) => [...batch, ...list]);
    let saved = 0;
    for (const u of batch) if (await send(u)) saved++;
    flash(uploadSummary(saved, batch.length - saved));
    if (saved) { setCaption(''); await load(); onChanged?.(); }
  };

  const retry = async (u: Upload) => {
    if (u.state !== 'failed') return;
    if (await send(u)) { flash(uploadSummary(1, 0)); await load(); onChanged?.(); }
  };
  const dropUpload = (u: Upload) => { URL.revokeObjectURL(u.preview); setUploads((list) => list.filter((x) => x.key !== u.key)); };

  const changed = (p: ArchiePhoto) => {
    setPhotos((list) => (filter !== 'all' && p.phase !== filter ? list.filter((x) => x.id !== p.id) : list.map((x) => (x.id === p.id ? p : x))));
    setOpen(p);
  };
  const removed = (p: ArchiePhoto) => {
    setPhotos((list) => list.filter((x) => x.id !== p.id));
    setTotal((n) => Math.max(0, n - 1));
    setOpen(null);
    flash(PHOTO_WORDS.deleted);
    onChanged?.();
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">📸 {PHOTO_WORDS.heading}{total ? <span className="text-gray-400 font-normal"> · {total}</span> : null}</h3>
        <button
          onClick={() => fileRef.current?.click()}
          className="text-xs px-3 py-2 rounded-lg bg-brand text-on-brand font-medium hover:bg-brand-dark disabled:opacity-50"
        >
          {saving ? PHOTO_WORDS.saving : PHOTO_WORDS.add}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" onChange={onPick} className="hidden" />
      </div>

      {/* What the next photos are: picked before the camera opens, so every photo carries it. */}
      <div className="px-4 py-3 border-b border-gray-100 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">{PHOTO_WORDS.phasePrompt}</span>
          <PhasePicker value={phase} onChange={setPhase} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-gray-500">{PHOTO_WORDS.categoryPrompt}</span>
            <CategorySelect value={category} onChange={setCategory} />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">{PHOTO_WORDS.captionPrompt}</span>
            <input value={caption} maxLength={500} onChange={(e) => setCaption(e.target.value)} placeholder={PHOTO_WORDS.captionPlaceholder}
              className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
          </label>
        </div>
      </div>

      {toast && <div className="px-4 py-2 text-sm bg-gray-900 text-white" role="status">{toast}</div>}

      <div className="px-4 pt-3 flex gap-1.5">
        {PHASE_FILTERS.map((f) => (
          <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={chip(filter === f.key)} aria-pressed={filter === f.key}>{f.label}</button>
        ))}
      </div>

      {loading ? (
        <div className="p-3 grid grid-cols-3 sm:grid-cols-5 gap-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="aspect-square bg-gray-100 rounded-lg animate-pulse" />)}</div>
      ) : loadError ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">
          <p>{PHOTO_WORDS.loadFailed}</p>
          <button onClick={load} className="mt-2 text-sm text-blue-600 hover:underline">{PHOTO_WORDS.retry}</button>
        </div>
      ) : photos.length === 0 && uploads.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-400">{filter === 'all' ? PHOTO_WORDS.empty : PHOTO_WORDS.emptyFiltered(filter)}</p>
      ) : (
        <div className="p-3 grid grid-cols-3 sm:grid-cols-5 gap-2">
          {uploads.map((u) => (
            <div key={u.key} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
              <img src={u.preview} alt="" className="w-full h-full object-cover opacity-60" />
              <button type="button" onClick={() => retry(u)} disabled={u.state === 'saving'} title={u.error}
                className={`absolute inset-0 flex items-center justify-center text-xs font-semibold ${u.state === 'failed' ? 'bg-red-600/60 text-white' : 'bg-black/30 text-white'}`}>
                {u.state === 'saving' ? PHOTO_WORDS.saving : PHOTO_WORDS.notSaved}
              </button>
              {u.state === 'failed' && (
                <button type="button" onClick={() => dropUpload(u)} aria-label={PHOTO_WORDS.cancel}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 text-gray-700 text-xs">✕</button>
              )}
            </div>
          ))}
          {photos.map((p) => (
            <button key={p.id} type="button" onClick={() => setOpen(p)} title={p.caption || p.name}
              className="relative block aspect-square rounded-lg overflow-hidden bg-gray-100">
              <img src={p.thumbUrl} alt={p.name} loading="lazy" className="w-full h-full object-cover hover:opacity-90 transition-opacity" />
              {p.phase && <span className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">{PHASE_LABEL[p.phase]}</span>}
            </button>
          ))}
        </div>
      )}

      {nextBefore && !loading && (
        <div className="px-4 pb-3 text-center">
          <button onClick={loadMore} disabled={loadingMore} className="text-sm text-blue-600 hover:underline disabled:opacity-50">
            {loadingMore ? '...' : `${PHOTO_WORDS.showMore} (${photos.length} of ${total})`}
          </button>
        </div>
      )}

      {open && <PhotoViewer photo={open} onClose={() => setOpen(null)} onChanged={changed} onDeleted={removed} />}
    </div>
  );
}

/** One photo, large, with its details. The person who added it, or a manager, may change it; delete only when allowed. */
function PhotoViewer({ photo, onClose, onChanged, onDeleted }: {
  photo: ArchiePhoto; onClose: () => void; onChanged: (p: ArchiePhoto) => void; onDeleted: (p: ArchiePhoto) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [phase, setPhase] = useState<PhotoPhase | null>(photo.phase);
  const [category, setCategory] = useState<PhotoCategory | ''>(photo.category ?? '');
  const [busy, setBusy] = useState<'saving' | 'deleting' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const save = async () => {
    setBusy('saving'); setError(null);
    try {
      const r = await api.patch<{ ok: true; photo: ArchiePhoto }>(`/api/photos/${photo.id}`, { caption, phase, category });
      setEditing(false);
      onChanged(r.photo);
    } catch (e: any) {
      setError(e?.message || PHOTO_WORDS.notSaved);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!window.confirm(PHOTO_WORDS.deleteConfirm)) return;
    setBusy('deleting'); setError(null);
    try {
      await api.delete(`/api/photos/${photo.id}`);
      onDeleted(photo);
    } catch (e: any) {
      setError(e?.message || PHOTO_WORDS.notSaved);
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={photo.name}>
      <div className="absolute inset-0 bg-black/70" onClick={() => !busy && onClose()} />
      <div className="relative bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[94vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-4 py-3 border-b border-gray-100 flex items-center justify-between z-10">
          <h3 className="text-base font-semibold text-gray-900 truncate pr-2">{photo.name}</h3>
          <button onClick={onClose} disabled={!!busy} className="text-gray-400 hover:text-gray-700 text-lg leading-none" aria-label={PHOTO_WORDS.close}>✕</button>
        </div>
        <div className="bg-black">
          <img src={photo.url} alt={photo.name} className="w-full max-h-[60vh] object-contain" />
        </div>
        <div className="p-4 space-y-3">
          {!editing ? (
            <>
              {photo.caption && <p className="text-sm text-gray-800 whitespace-pre-wrap">{photo.caption}</p>}
              <p className="text-xs text-gray-500">{photoDetails(photo)}</p>
            </>
          ) : (
            <div className="space-y-2">
              <PhasePicker value={phase} onChange={setPhase} disabled={!!busy} />
              <label className="block">
                <span className="text-xs text-gray-500">{PHOTO_WORDS.categoryPrompt}</span>
                <CategorySelect value={category} onChange={setCategory} disabled={!!busy} />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">{PHOTO_WORDS.captionPrompt}</span>
                <textarea value={caption} maxLength={500} rows={2} disabled={!!busy} onChange={(e) => setCaption(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
              </label>
            </div>
          )}
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {photo.mayEdit && !editing && (
              <button onClick={() => setEditing(true)} disabled={!!busy} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-800 hover:bg-gray-200 disabled:opacity-50">{PHOTO_WORDS.edit}</button>
            )}
            {editing && (
              <>
                <button onClick={save} disabled={!!busy} className="text-sm px-3 py-1.5 rounded-lg bg-brand text-on-brand font-medium disabled:opacity-50">
                  {busy === 'saving' ? PHOTO_WORDS.saving : PHOTO_WORDS.save}
                </button>
                <button onClick={() => { setEditing(false); setCaption(photo.caption ?? ''); setPhase(photo.phase); setCategory(photo.category ?? ''); setError(null); }}
                  disabled={!!busy} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 text-gray-800 disabled:opacity-50">{PHOTO_WORDS.cancel}</button>
              </>
            )}
            {photo.mayDelete && !editing && (
              <button onClick={remove} disabled={!!busy} className="text-sm px-3 py-1.5 rounded-lg text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50 ml-auto">
                {busy === 'deleting' ? PHOTO_WORDS.deleting : PHOTO_WORDS.delete}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
