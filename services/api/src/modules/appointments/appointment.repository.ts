import type { Appointment, AppointmentCounts, AppointmentStatus } from '@afb/types';
import type { Queryable } from '../../db/types';
import { APPOINTMENT_STATUSES } from '../../domain/enums';

/** Columns of the `appointment_details` view (database/migrations/0007_reporting.sql). */
interface AppointmentRow {
  id: string;
  status: AppointmentStatus;
  starts_at: Date;
  ends_at: Date;
  purpose: string;
  decision_note: string | null;
  created_at: Date;
  decided_at: Date | null;
  cancelled_at: Date | null;
  cancelled_by: number | null;
  completed_at: Date | null;
  student_id: number;
  student_name: string;
  registration_number: string;
  batch_name: string;
  faculty_id: number;
  faculty_name: string;
  employee_id: string;
  faculty_designation: string;
  faculty_office: string;
  department_code: string;
  department_name: string;
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

export function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    status: row.status,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    purpose: row.purpose,
    decisionNote: row.decision_note,
    createdAt: row.created_at.toISOString(),
    decidedAt: iso(row.decided_at),
    cancelledAt: iso(row.cancelled_at),
    cancelledBy:
      row.cancelled_by === null ? null : row.cancelled_by === row.student_id ? 'STUDENT' : 'FACULTY',
    completedAt: iso(row.completed_at),
    student: {
      id: row.student_id,
      name: row.student_name,
      registrationNumber: row.registration_number,
      batchName: row.batch_name,
    },
    faculty: {
      id: row.faculty_id,
      name: row.faculty_name,
      employeeId: row.employee_id,
      designation: row.faculty_designation,
      officeLocation: row.faculty_office,
      departmentCode: row.department_code,
      departmentName: row.department_name,
    },
  };
}

/** Row locked with SELECT … FOR UPDATE before a status change. */
export interface LockedAppointment {
  id: string;
  status: AppointmentStatus;
  studentId: number;
  facultyId: number;
  /** Whether the appointment's start time has been reached (by the database's business clock). */
  started: boolean;
}

export type Party = 'student' | 'faculty';

export class AppointmentRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Inserts a request. The slot's end is derived from the faculty member's configured slot length,
   * so a client can only choose a start time. Every booking rule is then enforced by PostgreSQL
   * (BEFORE INSERT trigger + exclusion constraints). Returns null if the faculty member does not exist.
   */
  async create(
    db: Queryable,
    input: { studentId: number; facultyId: number; startsAt: string; purpose: string },
  ): Promise<string | null> {
    const result = await db.query<{ id: string }>(
      `INSERT INTO appointments (student_id, faculty_id, slot, purpose)
       SELECT $1, f.user_id,
              tstzrange($3::timestamptz, $3::timestamptz + make_interval(mins => f.slot_minutes), '[)'),
              $4
         FROM faculty f
        WHERE f.user_id = $2
       RETURNING id`,
      [input.studentId, input.facultyId, input.startsAt, input.purpose],
    );
    return result.rows[0]?.id ?? null;
  }

  /** Reads back an appointment the caller just created or changed (same transaction, so it exists). */
  async getById(db: Queryable, id: string): Promise<Appointment> {
    const result = await db.query<AppointmentRow>('SELECT * FROM appointment_details WHERE id = $1', [id]);
    return toAppointment(result.rows[0] as AppointmentRow);
  }

  /**
   * Pessimistic lock: the row stays locked until the surrounding transaction ends, so a faculty member
   * approving and a student cancelling the same request at the same moment are serialised — the second
   * one sees the first one's result instead of overwriting it.
   */
  async lockForUpdate(db: Queryable, id: string): Promise<LockedAppointment | null> {
    const result = await db.query<{
      id: string;
      status: AppointmentStatus;
      student_id: number;
      faculty_id: number;
      started: boolean;
    }>(
      `SELECT id, status, student_id, faculty_id, lower(slot) <= app_now() AS started
         FROM appointments WHERE id = $1
          FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          id: row.id,
          status: row.status,
          studentId: row.student_id,
          facultyId: row.faculty_id,
          started: row.started,
        };
  }

  async updateStatus(
    db: Queryable,
    id: string,
    change: { status: AppointmentStatus; note: string | null; cancelledBy?: number },
  ): Promise<void> {
    await db.query(
      `UPDATE appointments
          SET status = $2,
              decision_note = coalesce($3, decision_note),
              cancelled_by = coalesce($4, cancelled_by)
        WHERE id = $1`,
      [id, change.status, change.note, change.cancelledBy ?? null],
    );
  }

  /**
   * The caller's appointments, optionally for one status. Upcoming appointments come first (soonest
   * first), then past ones (most recent first) — the order a person wants to read them in.
   */
  async listFor(
    party: Party,
    userId: number,
    status: AppointmentStatus | undefined,
    limit: number,
  ): Promise<Appointment[]> {
    const column = party === 'student' ? 'student_id' : 'faculty_id';
    const result = await this.db.query<AppointmentRow>(
      `SELECT *
         FROM appointment_details
        WHERE ${column} = $1
          AND ($2::appointment_status IS NULL OR status = $2)
        ORDER BY starts_at < app_now(),
                 CASE WHEN starts_at >= app_now() THEN starts_at END ASC,
                 starts_at DESC
        LIMIT $3`,
      [userId, status ?? null, limit],
    );
    return result.rows.map(toAppointment);
  }

  /** Number of appointments per status for the caller (every status present, zeros included). */
  async countsFor(party: Party, userId: number): Promise<AppointmentCounts> {
    const column = party === 'student' ? 'student_id' : 'faculty_id';
    const result = await this.db.query<{ status: AppointmentStatus; n: number }>(
      `SELECT s.status, count(a.id) AS n
         FROM unnest(enum_range(NULL::appointment_status)) AS s(status)
         LEFT JOIN appointments a ON a.status = s.status AND a.${column} = $1
        GROUP BY s.status`,
      [userId],
    );
    const counts = Object.fromEntries(APPOINTMENT_STATUSES.map((status) => [status, 0])) as AppointmentCounts;
    for (const row of result.rows) {
      counts[row.status] = row.n;
    }
    return counts;
  }

  /** A faculty member's pending requests, soonest first. */
  async pendingForFaculty(facultyId: number): Promise<Appointment[]> {
    const result = await this.db.query<AppointmentRow>(
      `SELECT * FROM appointment_details
        WHERE faculty_id = $1 AND status = 'PENDING'
        ORDER BY starts_at, created_at`,
      [facultyId],
    );
    return result.rows.map(toAppointment);
  }

  /** Runs the elapsed-appointment sweep (completes ended meetings, expires unanswered requests). */
  async processElapsed(): Promise<{ completed: number; expired: number }> {
    const result = await this.db.query<{ completed: number; expired: number }>(
      'SELECT completed, expired FROM process_elapsed_appointments()',
    );
    return result.rows[0] as { completed: number; expired: number };
  }
}
