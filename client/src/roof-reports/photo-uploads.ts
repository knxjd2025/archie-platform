import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { REPORT_PHOTO_CATEGORIES, type ReportPhotoCategory } from '../../../shared/roof-reports';
import { removeReportPhoto } from './api';
import { prepareJpeg } from './photo-prepare';
import { UPLOADS_AT_ONCE, runLimited, uploadJpeg } from './upload';
import { countedPhotos, leftOutLine, photosReducer, planAdditions, readRemoveError, type PhotoTile } from './wizard-model';
import { RR, plainMessage } from './words';

const asCategory = (v: string): ReportPhotoCategory | null => ((REPORT_PHOTO_CATEGORIES as readonly string[]).includes(v) ? (v as ReportPhotoCategory) : null);

/**
 * The photos of the report being made: their tiles, and the work of getting
 * each one ready and sent. Held by the wizard (not the photo step) so a photo
 * still on its way keeps going when the person steps back or forward.
 */
export function usePhotoUploads(initial: PhotoTile[]) {
  const [tiles, dispatch] = useReducer(photosReducer, initial);
  const [notice, setNotice] = useState('');
  const files = useRef(new Map<string, { file: File; category: ReportPhotoCategory | null }>());
  const live = useRef(tiles);
  live.current = tiles;
  const counter = useRef(0);

  const send = useCallback(async (key: string) => {
    const entry = files.current.get(key);
    if (!entry) { dispatch({ type: 'failed', key, error: RR.photos.notSaved }); return; }
    try {
      const jpeg = await prepareJpeg(entry.file);
      dispatch({ type: 'progress', key, percent: 0 });
      const id = await uploadJpeg(jpeg, entry.category, (percent) => dispatch({ type: 'progress', key, percent }));
      files.current.delete(key);
      // Taken off the screen while it was still going: it arrived, but nobody wants it, so it is taken back.
      if (!live.current.some((t) => t.key === key)) { void removeReportPhoto(id).catch(() => { /* waits unused; the person can do no more about it */ }); return; }
      dispatch({ type: 'done', key, id });
    } catch (e) {
      dispatch({ type: 'failed', key, error: plainMessage(e, RR.photos.notSaved) });
    }
  }, []);

  /** Adds the picked files. Each gets its tile in this same call, before any of the work starts. */
  const add = useCallback((picked: File[], kind: string) => {
    const plan = planAdditions(countedPhotos(live.current), picked);
    setNotice(leftOutLine(plan.leftOutNotPictures, plan.leftOutFull));
    if (plan.accept.length === 0) return;
    const category = asCategory(kind);
    const made = plan.accept.map((file) => {
      const key = `p${Date.now().toString(36)}-${counter.current++}`;
      files.current.set(key, { file, category });
      const tile: PhotoTile = { key, name: file.name, state: 'preparing', percent: 0, id: null, category, error: null, preview: URL.createObjectURL(file) };
      return tile;
    });
    dispatch({ type: 'add', tiles: made });
    void runLimited(made, UPLOADS_AT_ONCE, (t) => send(t.key));
  }, [send]);

  const retry = useCallback((key: string) => {
    dispatch({ type: 'retry', key });
    void send(key);
  }, [send]);

  const remove = useCallback((key: string) => {
    const tile = live.current.find((t) => t.key === key);
    if (!tile || tile.state === 'removing') return;
    const drop = () => {
      if (tile.preview) URL.revokeObjectURL(tile.preview);
      files.current.delete(key);
      dispatch({ type: 'remove', key });
    };
    if (tile.state === 'done' && tile.id) {
      // The server holds a copy: it is asked to take it back, and the tile says "Removing..." in the same frame as the click.
      dispatch({ type: 'removing', key });
      removeReportPhoto(tile.id).then(drop).catch((e) => {
        const outcome = readRemoveError(e);
        if (outcome.gone) drop(); else dispatch({ type: 'removeFailed', key, error: outcome.error });
      });
      return;
    }
    drop();
  }, []);

  const reset = useCallback(() => {
    for (const t of live.current) if (t.preview) URL.revokeObjectURL(t.preview);
    files.current.clear();
    setNotice('');
    dispatch({ type: 'reset', tiles: [] });
  }, []);

  // Pictures held for display are let go when the wizard closes.
  useEffect(() => () => { for (const t of live.current) if (t.preview) URL.revokeObjectURL(t.preview); }, []);

  return { tiles, notice, add, retry, remove, reset };
}
