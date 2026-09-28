/**
 * Every date and time is shown in campus time (Asia/Kolkata), whatever the time zone of the device
 * viewing it, because appointments happen on campus.
 */
export const CAMPUS_TIME_ZONE = 'Asia/Kolkata';

/**
 * The calendar fields of an instant in campus time. Only numeric fields come from Intl; the words are
 * ours, so the output is identical on every ICU version (browsers, Node on Windows, CI).
 */
const campusParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAMPUS_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface CampusFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
}

function campusFields(iso: string): CampusFields {
  const values: Record<string, number> = {};
  for (const part of campusParts.formatToParts(new Date(iso))) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }
  const year = values.year ?? 0;
  const month = values.month ?? 1;
  const day = values.day ?? 1;
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? '';
  return { year, month, day, hour: values.hour ?? 0, minute: values.minute ?? 0, weekday };
}

function dayMonth(fields: CampusFields): string {
  return `${fields.weekday}, ${String(fields.day)} ${MONTHS[fields.month - 1] ?? ''}`;
}

/** "Tue, 29 Sep 2026" */
export function formatDate(iso: string): string {
  const fields = campusFields(iso);
  return `${dayMonth(fields)} ${String(fields.year)}`;
}

/** "Tue, 29 Sep" — for a campus calendar date such as '2026-09-29'. */
export function formatCalendarDate(date: string): string {
  return dayMonth(campusFields(`${date}T12:00:00+05:30`));
}

/** "1:20 pm" */
export function formatTime(iso: string): string {
  const fields = campusFields(iso);
  return formatClock(`${String(fields.hour)}:${String(fields.minute)}`);
}

/** "1:20 pm – 1:35 pm" */
export function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)} – ${formatTime(endIso)}`;
}

/** "Tue, 29 Sep 2026, 1:20 pm" */
export function formatDateTime(iso: string): string {
  return `${formatDate(iso)}, ${formatTime(iso)}`;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** ISO weekday (1 = Monday) → "Monday". */
export function dayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek - 1] ?? `Day ${String(dayOfWeek)}`;
}

/** '14:30' → "2:30 pm" */
export function formatClock(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const suffix = hours >= 12 ? 'pm' : 'am';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(hour12)}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** 580 → "9 h 40 min"; 60 → "1 h"; 45 → "45 min". */
export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) {
    return `${String(minutes)} min`;
  }
  return minutes === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(minutes)} min`;
}
