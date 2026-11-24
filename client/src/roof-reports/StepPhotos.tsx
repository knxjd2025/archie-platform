import type { ReportPhotoCategory } from '../../../shared/roof-reports';
import { MAX_REPORT_PHOTOS, REPORT_PHOTO_CATEGORIES } from '../../../shared/roof-reports';
import { countedPhotos, photoCountLine, progressLine, tileLabel, type PhotoTile } from './wizard-model';
import { PHOTO_KIND_LABEL, RR } from './words';

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';
const BUTTON = `px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 ${FOCUS}`;

export interface PhotosViewProps {
  tiles: PhotoTile[];
  kind: '' | ReportPhotoCategory;
  dragging: boolean;
  /** What the last pick left out, as a sentence. Empty for nothing. */
  notice: string;
  onFiles: (files: File[]) => void;
  onKind: (kind: '' | ReportPhotoCategory) => void;
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
  onDragging: (dragging: boolean) => void;
}

function Tile({ tile, onRemove, onRetry }: { tile: PhotoTile; onRemove: (key: string) => void; onRetry: (key: string) => void }) {
  const working = tile.state === 'preparing' || tile.state === 'uploading';
  const removing = tile.state === 'removing';
  return (
    <li className="relative" aria-busy={removing || undefined}>
      <div className={`relative aspect-square rounded-lg overflow-hidden border ${tile.state === 'failed' ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-100'}`}>
        {tile.preview ? (
          <img src={tile.preview} alt="" className={`w-full h-full object-cover ${working || removing ? 'opacity-50' : ''}`} />
        ) : (
          <p className="p-2 text-xs text-gray-500 break-all">{tile.name}</p>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[11px] px-2 py-1">
          {tileLabel(tile)}
          {tile.state === 'uploading' && (
            <div
              role="progressbar"
              aria-label={RR.photos.progressFor(tile.name)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={tile.percent}
              className="mt-1 h-1 rounded bg-white/30 overflow-hidden"
            >
              <div className="h-full bg-white rounded" style={{ width: `${tile.percent}%` }} />
            </div>
          )}
          {removing && <div className="mt-1 h-1 rounded bg-white/30 overflow-hidden"><div className="h-full w-1/3 bg-white rounded animate-pulse" /></div>}
          {tile.state === 'preparing' && <div className="mt-1 h-1 rounded bg-white/30 overflow-hidden"><div className="h-full w-1/3 bg-white rounded animate-pulse" /></div>}
        </div>
        <button
          type="button"
          onClick={() => onRemove(tile.key)}
          disabled={removing}
          aria-label={RR.photos.removeFor(tile.name)}
          className={`absolute top-1 right-1 w-7 h-7 rounded-full bg-white/90 text-gray-700 text-sm leading-none ${FOCUS}`}
        >
          <span aria-hidden>✕</span>
        </button>
      </div>
      {tile.state === 'done' && tile.error && <p role="alert" className="mt-1 text-xs text-red-600">{tile.error}</p>}
      {tile.state === 'failed' && (
        <div className="mt-1">
          {tile.error && <p role="alert" className="text-xs text-red-600">{tile.error}</p>}
          <button type="button" onClick={() => onRetry(tile.key)} aria-label={RR.photos.retryFor(tile.name)} className={`mt-1 text-xs ${BUTTON}`}>{RR.photos.retry}</button>
        </div>
      )}
    </li>
  );
}

/** Step 2 as it looks for the state it is handed. */
export function PhotosView(p: PhotosViewProps) {
  const counted = countedPhotos(p.tiles);
  const full = counted >= MAX_REPORT_PHOTOS;
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = ''; // so the same file can be picked again later
    if (picked.length) p.onFiles(picked);
  };
  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-base font-semibold text-gray-900">{RR.photos.title}</h4>
        <p id="rr-photo-cap" className="text-sm text-gray-600 mt-1" aria-live="polite">{photoCountLine(counted)}</p>
      </div>

      <div>
        <label htmlFor="rr-photo-kind" className="block text-sm font-medium text-gray-700 mb-1">{RR.photos.kindLabel}</label>
        <select
          id="rr-photo-kind"
          value={p.kind}
          onChange={(e) => p.onKind(e.target.value as '' | ReportPhotoCategory)}
          className={`text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 ${FOCUS}`}
        >
          <option value="">{RR.photos.notSure}</option>
          {REPORT_PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{PHOTO_KIND_LABEL[c]}</option>)}
        </select>
      </div>

      <div
        role="group"
        aria-label={RR.photos.zoneLabel}
        onDragOver={(e) => { e.preventDefault(); p.onDragging(true); }}
        onDragLeave={() => p.onDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          p.onDragging(false);
          const dropped = Array.from(e.dataTransfer?.files || []);
          if (dropped.length) p.onFiles(dropped);
        }}
        className={`rounded-xl border-2 border-dashed p-5 text-center ${p.dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-gray-50'}`}
      >
        <p className="text-sm text-gray-700">{RR.photos.dropHere}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
          {/* A real file control under each label: Enter and Space open the chooser, and the focus ring shows on the wrapper. */}
          <span className="relative rounded-lg focus-within:ring-2 focus-within:ring-blue-400">
            <label htmlFor="rr-photo-files" className={`inline-block cursor-pointer px-4 py-2 text-sm font-medium rounded-lg bg-brand text-on-brand hover:bg-brand-dark ${full ? 'opacity-50' : ''}`}>{RR.photos.choose}</label>
            <input id="rr-photo-files" type="file" accept="image/*" multiple disabled={full} onChange={pick} aria-describedby="rr-photo-cap" className="sr-only" />
          </span>
          <span className="relative rounded-lg focus-within:ring-2 focus-within:ring-blue-400">
            <label htmlFor="rr-photo-camera" className={`inline-block cursor-pointer px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 ${full ? 'opacity-50' : ''}`}>{RR.photos.camera}</label>
            <input id="rr-photo-camera" type="file" accept="image/*" capture="environment" disabled={full} onChange={pick} className="sr-only" />
          </span>
        </div>
        <p className="mt-3 text-xs text-gray-500">{RR.photos.privacy}</p>
      </div>

      {p.notice && <p role="status" className="text-sm text-amber-700">{p.notice}</p>}

      {p.tiles.length > 0 && (
        <>
          <p className="text-sm text-gray-600" aria-live="polite">{progressLine(p.tiles)}</p>
          <ul className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {p.tiles.map((t) => <Tile key={t.key} tile={t} onRemove={p.onRemove} onRetry={p.onRetry} />)}
          </ul>
        </>
      )}
    </div>
  );
}

export interface StepPhotosProps {
  tiles: PhotoTile[];
  notice: string;
  kind: '' | ReportPhotoCategory;
  dragging: boolean;
  onKind: (kind: '' | ReportPhotoCategory) => void;
  onDragging: (dragging: boolean) => void;
  onAdd: (files: File[], kind: string) => void;
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}

export default function StepPhotos(p: StepPhotosProps) {
  return (
    <PhotosView
      tiles={p.tiles}
      kind={p.kind}
      dragging={p.dragging}
      notice={p.notice}
      onFiles={(files) => p.onAdd(files, p.kind)}
      onKind={p.onKind}
      onRemove={p.onRemove}
      onRetry={p.onRetry}
      onDragging={p.onDragging}
    />
  );
}
