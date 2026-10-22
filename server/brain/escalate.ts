const RENUDGE_HOURS: Record<string, number> = { emergency: 1, urgent: 2, normal: 4, low: 24 };

export function isQuietHours(d: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }).format(d),
  );
  return hour >= 20 || hour < 7;
}

export function nextEscalationLevel(
  loop: { urgency: string; state: string },
  hoursSinceLastNudge: number,
): 0 | 1 | 2 | null {
  if (!['open', 'nudged', 'escalated'].includes(loop.state)) return null;
  if (loop.state === 'open') return 0;
  const wait = RENUDGE_HOURS[loop.urgency] ?? 4;
  if (hoursSinceLastNudge < wait) return null;
  return loop.state === 'nudged' ? 1 : 2;
}

export function underRateCap(sentTodayToPerson: number): boolean {
  return sentTodayToPerson < 5;
}
