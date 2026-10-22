/**
 * Autosave for the field forms (inspection, pre-construction, final
 * walkthrough). A save used to replace the whole answers blob with whatever
 * the phone sent, so a save from a second tab, or one that arrived late,
 * quietly wiped answers it didn't carry. A save is now a patch: keys it
 * carries win, keys it leaves out are kept.
 *
 * Clearing still works: a key sent as "" or null (or false) is a real answer
 * and overwrites. Only a key that is absent is left alone.
 */
export function mergeAnswers(
  existing: Readonly<Record<string, unknown>> | null | undefined,
  patch: Readonly<Record<string, unknown>>,
  locked: readonly string[] = [],
): Record<string, unknown> {
  const base = existing && typeof existing === 'object' ? existing : {};
  const merged: Record<string, unknown> = { ...base, ...patch };
  // Keys fixed at creation (an inspection's form kind) can't be rewritten by a save.
  return locked.reduce((out, key) => (key in base ? { ...out, [key]: base[key] } : out), merged);
}
