/**
 * The season calendar.
 *
 * Matchdays are Tuesday, Thursday and Saturday at 20:00 UTC. Twenty-two of them
 * -- a double round robin between twelve clubs -- takes a shade over seven weeks,
 * which leaves a week of off-season inside an eight-week cycle.
 */

const DAY_MS = 86_400_000;
/** Tuesday, Thursday, Saturday. */
const MATCHDAY_WEEKDAYS = [2, 4, 6];
const KICKOFF_HOUR_UTC = 20;

export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}

/** First matchday slot at or after `from`. */
export function firstKickoff(from: Date): Date {
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), KICKOFF_HOUR_UTC),
  );
  for (let step = 0; step < 8; step++) {
    const candidate = addDays(cursor, step);
    if (MATCHDAY_WEEKDAYS.includes(candidate.getUTCDay()) && candidate >= from) return candidate;
  }
  return cursor;
}

/** `count` kickoff times, walking Tue/Thu/Sat from the season start. */
export function kickoffSchedule(startsOn: Date, count: number): Date[] {
  const slots: Date[] = [];
  let cursor = firstKickoff(startsOn);
  while (slots.length < count) {
    slots.push(cursor);
    // Step forward to the next matchday weekday.
    let next = addDays(cursor, 1);
    while (!MATCHDAY_WEEKDAYS.includes(next.getUTCDay())) next = addDays(next, 1);
    cursor = next;
  }
  return slots;
}

/** Days between two kickoffs, for stamina recovery. */
export function daysBetween(earlier: Date, later: Date): number {
  return Math.max(0, (later.getTime() - earlier.getTime()) / DAY_MS);
}
