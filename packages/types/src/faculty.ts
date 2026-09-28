import type { ExceptionKind } from './domain';

/** A bookable time range. ISO 8601 timestamps. */
export interface TimeSlot {
  startsAt: string;
  endsAt: string;
}

/** One faculty member as listed in search results and profiles. */
export interface FacultySummary {
  id: number;
  name: string;
  employeeId: string;
  designation: string;
  officeLocation: string;
  slotMinutes: number;
  department: { id: number; code: string; name: string };
  /** Total weekly availability in minutes. */
  weeklyAvailableMinutes: number;
  /** The earliest slot bookable in the next 14 days (for a student caller: one they can actually attend). */
  nextAvailableSlot: TimeSlot | null;
}

/** A recurring weekly availability window, local campus time. `dayOfWeek`: 1 = Monday … 7 = Sunday. */
export interface AvailabilityWindow {
  dayOfWeek: number;
  /** 'HH:MM', 24-hour */
  startTime: string;
  endTime: string;
}

export interface StoredAvailabilityWindow extends AvailabilityWindow {
  id: number;
  durationMinutes: number;
}

/** A class the faculty member teaches (their teaching timetable). */
export interface TeachingSession {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  courseCode: string;
  courseTitle: string;
  sessionType: 'LECTURE' | 'LAB' | 'TUTORIAL';
  batchName: string;
  room: string | null;
}

/** `GET /api/faculty/:id/availability` */
export interface FacultyAvailability {
  faculty: FacultySummary;
  /** Local campus dates covered, 'YYYY-MM-DD'. */
  from: string;
  to: string;
  /** Every date in the range, each with its free slots (possibly none). */
  days: { date: string; slots: TimeSlot[] }[];
  weeklyAvailability: StoredAvailabilityWindow[];
  teaching: TeachingSession[];
}

/** A one-off period in which a faculty member is unavailable. */
export interface ScheduleException {
  id: number;
  kind: ExceptionKind;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  createdAt: string;
}

/** `GET /api/faculty/availability` — the signed-in faculty member's own settings. */
export interface MyAvailability {
  slotMinutes: number;
  windows: StoredAvailabilityWindow[];
  /** Exceptions that have not ended yet, soonest first. */
  exceptions: ScheduleException[];
}

/** `PUT /api/faculty/availability` — the complete new weekly set (replaces the old one). */
export interface ReplaceAvailabilityRequest {
  windows: AvailabilityWindow[];
}

export interface ReplaceAvailabilityResponse extends MyAvailability {
  added: number;
  removed: number;
}

/** `POST /api/faculty/availability/exceptions` */
export interface CreateExceptionRequest {
  kind: ExceptionKind;
  startsAt: string;
  endsAt: string;
  reason?: string;
}

export interface CreateExceptionResponse {
  exception: ScheduleException;
  /** Upcoming pending/approved appointments in the period that were rejected/cancelled (students notified). */
  releasedAppointments: number;
}
