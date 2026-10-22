import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';

interface Photo { id: string; name: string; url: string | null; description: string | null; createdAt: string | null }

/** Downscale on-device before upload: phone photos are 3-8MB, reports need ~1600px. */
export const MAX_EDGE = 1600;
const QUALITY = 0.82;

export async function shrinkImage(file: File, maxEdge = MAX_EDGE): Promise<{ base64: string; contentType: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process that photo.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
  return { base64: dataUrl.split(',')[1] || '', contentType: 'image/jpeg' };
}

// A job's photos, straight from JobTread — view them and add new ones from the field.
export default function JobPhotos({ externalId, onChanged }: { externalId: string; onChanged?: () => void }) {
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
        <p className="px-4 py-6 text-center text-sm text-gray-400">No photos on this job yet — add some from your phone and they'll go straight into JobTread.</p>
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
