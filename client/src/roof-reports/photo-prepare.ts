/**
 * Redraws a picked picture as a JPEG of at most 1600 pixels on its longest side,
 * on this device, with the same routine the job photo box uses. The redraw drops
 * every metadata block, location included, before anything leaves the device.
 */
import { shrinkImage } from '../components/JobPhotos';
import { RR } from './words';

export async function prepareJpeg(file: File): Promise<Blob> {
  let base64: string;
  try {
    base64 = (await shrinkImage(file)).base64;
  } catch {
    throw new Error(RR.photos.unreadable);
  }
  if (!base64) throw new Error(RR.photos.unreadable);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}
