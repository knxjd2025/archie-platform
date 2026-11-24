import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { REPORT_PHOTO_CATEGORIES, type ReportPhotoCategory } from '../../../shared/roof-reports';
import { prepareJpeg } from './photo-prepare';
import { UPLOADS_AT_ONCE, runLimited, uploadJpeg } from './upload';
import { countedPhotos, leftOutLine, photosReducer, planAdditions, type PhotoTile } from './wizard-model';
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
    if (tile?.preview) URL.revokeObjectURL(tile.preview);
    files.current.delete(key);
    dispatch({ type: 'remove', key });
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
