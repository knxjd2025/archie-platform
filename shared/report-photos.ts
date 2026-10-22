/**
 * The id a photo gets when a rep adds it to a report from the job's photo
 * pool. Computed from the URL on both sides — the editor needs the id before
 * the server has seen the photo, so it can place it in the drag order.
 */
export function addedPhotoId(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) | 0;
  return `added-${(h >>> 0).toString(36)}`;
}
