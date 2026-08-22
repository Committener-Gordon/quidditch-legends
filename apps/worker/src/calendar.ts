/**
 * The season calendar.
 *
 * By default matchdays are Tuesday, Thursday and Saturday at 20:00 UTC: twenty-two
 * of them takes a shade over seven weeks, which leaves a week of off-season inside
 * an eight-week cycle. That is the right cadence for a league full of people.
 *
 * It is the wrong cadence for one person trying the game out, so a season can also
 * be paced by a fixed interval -- every five minutes, every hour -- and the whole
 * thing plays out in an evening. Same fixtures, same engine, different clock.
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

export interface PaceOptions {
  /**
   * Minutes between matchdays. Omit for the weekly Tue/Thu/Sat calendar; set it
   * and the season runs on a fixed clock instead.
   */
  intervalMinutes?: number;
}

/** `count` kickoff times, either Tue/Thu/Sat or evenly spaced. */
export function kickoffSchedule(startsOn: Date, count: number, pace: PaceOptions = {}): Date[] {
  const slots: Date[] = [];

  if (pace.intervalMinutes && pace.intervalMinutes > 0) {
    // A fixed clock: the first kickoff is the season start itself, so a season
    // created with `--start now` is playable immediately.
    for (let index = 0; index < count; index++) {
      slots.push(new Date(startsOn.getTime() + index * pace.intervalMinutes * 60_000));
    }
    return slots;
  }

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

/**
 * A sensible lineup deadline for a given pace.
 *
 * Fifteen minutes before kickoff is right for a two-day gap and absurd for a
 * five-minute one, where it would already have passed before the fixture was
 * created. A quarter of the gap, capped at fifteen minutes, holds for both.
 */
export function deadlineMinutesFor(pace: PaceOptions): number {
  if (!pace.intervalMinutes || pace.intervalMinutes <= 0) return 15;
  return Math.max(0, Math.min(15, Math.floor(pace.intervalMinutes / 4)));
}

/** Parse `30m`, `2h`, `1d`, or a bare number of minutes. */
export function parseInterval(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*([mhd]?)$/i.exec(value.trim());
  if (!match) throw new Error(`cannot read "${value}" as an interval -- try 5m, 2h or 1d`);
  const amount = Number(match[1]);
  const unit = (match[2] || 'm').toLowerCase();
  return Math.round(amount * (unit === 'd' ? 1440 : unit === 'h' ? 60 : 1));
}

/** Days between two kickoffs, for stamina recovery. */
export function daysBetween(earlier: Date, later: Date): number {
  return Math.max(0, (later.getTime() - earlier.getTime()) / DAY_MS);
}
