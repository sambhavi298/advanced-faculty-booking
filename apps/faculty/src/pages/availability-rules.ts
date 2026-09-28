import type { AvailabilityWindow } from '@afb/types';

export interface WindowRow extends AvailabilityWindow {
  /** Stable React key for a row that is being edited. */
  key: string;
}

/** 'HH:MM' → minutes since midnight. */
export function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * The same rules the API and the database enforce, checked while typing so mistakes show next to the
 * row: a 5-minute grid, end after start, and no two windows overlapping on the same day. (The
 * database's WITHOUT OVERLAPS constraint stays the final guard.)
 */
export function validateWindows(rows: WindowRow[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const row of rows) {
    const start = minutesOf(row.startTime);
    const end = minutesOf(row.endTime);
    if (row.startTime === '' || row.endTime === '') {
      errors[row.key] = 'Enter both times.';
    } else if (start % 5 !== 0 || end % 5 !== 0) {
      errors[row.key] = 'Use times on a 5-minute boundary (e.g. 14:05).';
    } else if (end <= start) {
      errors[row.key] = 'The end time must be after the start time.';
    }
  }
  const valid = rows.filter((row) => errors[row.key] === undefined);
  for (const row of valid) {
    const clash = valid.find(
      (other) =>
        other.key !== row.key &&
        other.dayOfWeek === row.dayOfWeek &&
        minutesOf(other.startTime) < minutesOf(row.endTime) &&
        minutesOf(row.startTime) < minutesOf(other.endTime),
    );
    if (clash !== undefined) {
      errors[row.key] = `Overlaps ${clash.startTime}–${clash.endTime} on the same day.`;
    }
  }
  return errors;
}

/** Monday first, then by start time. */
export function sortWindows<T extends AvailabilityWindow>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || minutesOf(a.startTime) - minutesOf(b.startTime),
  );
}

/** A 'YYYY-MM-DDTHH:MM' value from a datetime-local input, read as campus time (IST). */
export function campusInstant(value: string): string {
  return `${value}:00+05:30`;
}
