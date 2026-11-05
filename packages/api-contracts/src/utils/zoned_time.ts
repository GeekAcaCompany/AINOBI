// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Timezone wall-clock utilities.
 *
 * A live classroom's start_date/start_time (pg date/time strings) are interpreted in the classroom's timezone;
 * the runtime state check (get_live_runtime_state) and section unlock conditions both depend on
 * converting "wall clock ↔ absolute instant". Node has no built-in ZoneInfo, so two Intl iterations
 * correct the offset (converging at DST boundaries).
 */

/** Wall-clock time in a timezone (no milliseconds — pg time columns have second precision) */
export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
}

/** Invalid timezone name → false (the caller falls back to UTC) */
export function isValidTimeZone(timeZone: string | null | undefined): boolean {
  if (!timeZone) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock reading of an absolute instant in a timezone */
export function wallClockInZone(
  timeZone: string,
  epochMs: number = Date.now(),
): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(epochMs));
  const get = (type: string): number =>
    Number.parseInt(parts.find((part) => part.type === type)?.value ?? "0", 10);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** UTC offset of the timezone at a given instant (milliseconds) */
function timeZoneOffsetMs(timeZone: string, atEpochMs: number): number {
  const wall = wallClockInZone(timeZone, atEpochMs);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - atEpochMs;
}

/** Wall clock → absolute instant (resolved in the target timezone; DST boundaries follow ZoneInfo semantics) */
export function wallClockToEpoch(wall: WallClock, timeZone: string): number {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  // Two iterations: guess the offset from UTC first, then correct it with the approximate instant (converges at DST boundaries)
  let offset = timeZoneOffsetMs(timeZone, asUtc);
  offset = timeZoneOffsetMs(timeZone, asUtc - offset);
  return asUtc - offset;
}

/** String literal of the current naive UTC time (for writing timestamp without time zone columns; 3 millisecond digits after the seconds) */
export function pythonNaiveUtcNowString(): string {
  const now = new Date();
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  return (
    `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ` +
    `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}.` +
    String(now.getUTCMilliseconds()).padStart(3, "0")
  );
}

/** pg date string (YYYY-MM-DD) → year/month/day; bad format → null */
export function parsePgDate(value: string | null | undefined): { year: number; month: number; day: number } | null {
  if (!value) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return { year, month, day };
}

/** pg time string (HH:MM:SS[.ffffff]) → hour/minute/second; bad format → null */
export function parsePgTime(value: string | null | undefined): { hour: number; minute: number; second: number } | null {
  if (!value) {
    return null;
  }
  // Seconds are optional ("14:16" — the request value path); DB columns are always the full form and unaffected
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!match) {
    return null;
  }
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  const second = match[3] !== undefined ? Number.parseInt(match[3], 10) : 0;
  if (hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  return { hour, minute, second };
}

/** weekday() of a wall-clock date (Monday = 0) */
export function pythonWeekday(year: number, month: number, day: number): number {
  // 1970-01-01 was a Thursday (weekday=3); constructed in UTC directly to avoid the local timezone
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (jsDay + 6) % 7;
}

/** Date comparison helper: YYYY-MM-DD strings compare lexicographically (the date.max sentinel is "9999-12-31") */
export const PY_DATE_MAX = "9999-12-31";
export const PY_TIME_MAX = "23:59:59.999999";
