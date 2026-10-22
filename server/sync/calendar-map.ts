export interface RawGEvent {
  id?: string;
  summary?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string }>;
}

export function classifyKind(summary: string): 'inspection' | 'adjuster' | 'internal' | 'other' {
  const s = (summary || '').toLowerCase();
  if (s.includes('adjuster')) return 'adjuster';
  if (s.includes('inspection') || s.includes('inspect')) return 'inspection';
  if (s.includes('leadership') || s.includes('meeting') || s.includes('call time') || s.includes('catch up') || s.includes('office')) return 'internal';
  return 'other';
}

export function mapAppointment(ev: RawGEvent, calendarSource: string) {
  const startRaw = ev.start?.dateTime || ev.start?.date;
  if (!ev.id || !startRaw) return null;
  const endRaw = ev.end?.dateTime || ev.end?.date;
  return {
    sourceId: `${calendarSource}:${ev.id}`,
    title: ev.summary ?? null,
    start: new Date(startRaw),
    end: endRaw ? new Date(endRaw) : null,
    address: ev.location ?? null,
    calendarSource,
    kind: classifyKind(ev.summary ?? ''),
    attendees: (ev.attendees ?? []).map((a) => a.email).filter(Boolean) as string[],
  };
}
