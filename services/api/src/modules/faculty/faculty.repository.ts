import type {
  AvailabilityWindow,
  ExceptionKind,
  FacultySummary,
  ScheduleException,
  StoredAvailabilityWindow,
  TeachingSession,
  TimeSlot,
} from '@afb/types';
import type { Queryable } from '../../db/types';

interface FacultyRow {
  id: number;
  full_name: string;
  login_id: string;
  designation: string;
  office_location: string;
  slot_minutes: number;
  department_id: number;
  department_code: string;
  department_name: string;
  weekly_minutes: number;
  next_start: Date | null;
  next_end: Date | null;
}

function toSummary(row: FacultyRow): FacultySummary {
  return {
    id: row.id,
    name: row.full_name,
    employeeId: row.login_id,
    designation: row.designation,
    officeLocation: row.office_location,
    slotMinutes: row.slot_minutes,
    department: { id: row.department_id, code: row.department_code, name: row.department_name },
    weeklyAvailableMinutes: row.weekly_minutes,
    nextAvailableSlot:
      row.next_start === null || row.next_end === null
        ? null
        : { startsAt: row.next_start.toISOString(), endsAt: row.next_end.toISOString() },
  };
}

interface ExceptionRow {
  id: number;
  kind: ExceptionKind;
  starts_at: Date;
  ends_at: Date;
  reason: string | null;
  created_at: Date;
}

function toException(row: ExceptionRow): ScheduleException {
  return {
    id: row.id,
    kind: row.kind,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  };
}

/** Escapes LIKE wildcards so a search for "50%" matches literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Campus "today" and a local date n days later, both as 'YYYY-MM-DD'. */
const TODAY = '(app_now() AT TIME ZONE campus_timezone())::date';

/**
 * Faculty directory: active faculty with department, total weekly availability (summing the
 * PostgreSQL 18 virtual column duration_minutes) and the next bookable slot, found by calling
 * faculty_free_slots() through a LATERAL join — personalised when a student is asking.
 */
const FACULTY_SELECT = `
  SELECT f.user_id AS id, u.full_name, u.login_id, f.designation, f.office_location, f.slot_minutes,
         d.id AS department_id, d.code AS department_code, d.name AS department_name,
         coalesce((SELECT sum(a.duration_minutes) FROM faculty_availability a WHERE a.faculty_id = f.user_id), 0)::int
           AS weekly_minutes,
         nxt.slot_start AS next_start, nxt.slot_end AS next_end
    FROM faculty f
    JOIN users u       ON u.id = f.user_id AND u.is_active
    JOIN departments d ON d.id = f.department_id
    LEFT JOIN LATERAL (
      SELECT s.slot_start, s.slot_end
        FROM faculty_free_slots(f.user_id, ${TODAY}, ${TODAY} + 14, $1::bigint) AS s
       LIMIT 1
    ) AS nxt ON true`;

export class FacultyRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Search by name (substring, served by the trigram GIN index), Employee ID prefix, department code or
   * designation. With a search term, results are ranked by trigram similarity to the name.
   */
  async list(filter: {
    search?: string;
    departmentCode?: string;
    studentId: number | null;
  }): Promise<FacultySummary[]> {
    const search = filter.search === undefined ? null : escapeLike(filter.search);
    const result = await this.db.query<FacultyRow>(
      `${FACULTY_SELECT}
        WHERE ($2::text IS NULL
               OR u.full_name ILIKE '%' || $2 || '%'
               OR u.login_id ILIKE $2 || '%'
               OR d.code ILIKE $2
               OR f.designation ILIKE '%' || $2 || '%')
          AND ($3::text IS NULL OR d.code = upper($3))
        ORDER BY CASE WHEN $2::text IS NULL THEN 0 ELSE similarity(u.full_name, $2) END DESC, u.full_name`,
      [filter.studentId, search, filter.departmentCode ?? null],
    );
    return result.rows.map(toSummary);
  }

  async findSummary(facultyId: number, studentId: number | null): Promise<FacultySummary | null> {
    const result = await this.db.query<FacultyRow>(`${FACULTY_SELECT} WHERE f.user_id = $2`, [
      studentId,
      facultyId,
    ]);
    const row = result.rows[0];
    return row === undefined ? null : toSummary(row);
  }

  /** Fills in the default range (today … today + 13) and returns both ends as local dates. */
  async resolveRange(
    from: string | undefined,
    to: string | undefined,
  ): Promise<{ from: string; to: string }> {
    const result = await this.db.query<{ from: string; to: string }>(
      `SELECT r.f AS from, coalesce($2::date, r.f + 13) AS to
         FROM (SELECT coalesce($1::date, ${TODAY}) AS f) AS r`,
      [from ?? null, to ?? null],
    );
    return result.rows[0] as { from: string; to: string };
  }

  /**
   * Every local date in [from, to] with its free slots. A LEFT JOIN from generate_series keeps days
   * without slots; json_agg … FILTER collects each day's slots in order.
   */
  async freeSlotsByDay(
    facultyId: number,
    from: string,
    to: string,
    studentId: number | null,
  ): Promise<{ date: string; slots: TimeSlot[] }[]> {
    const result = await this.db.query<{ date: string; slots: TimeSlot[] }>(
      `SELECT d::date AS date,
              coalesce(
                json_agg(
                  json_build_object(
                    'startsAt', to_char(s.slot_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                    'endsAt',   to_char(s.slot_end   AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                  ORDER BY s.slot_start
                ) FILTER (WHERE s.slot_start IS NOT NULL),
                '[]'::json) AS slots
         FROM generate_series($2::date, $3::date, interval '1 day') AS d
         LEFT JOIN faculty_free_slots($1, $2::date, $3::date, $4::bigint) AS s
                ON (s.slot_start AT TIME ZONE campus_timezone())::date = d::date
        GROUP BY d
        ORDER BY d`,
      [facultyId, from, to, studentId],
    );
    return result.rows;
  }

  async weeklyWindows(db: Queryable, facultyId: number): Promise<StoredAvailabilityWindow[]> {
    const result = await db.query<StoredAvailabilityWindow>(
      `SELECT id, day_of_week AS "dayOfWeek",
              to_char(start_time, 'HH24:MI') AS "startTime",
              to_char(end_time, 'HH24:MI') AS "endTime",
              duration_minutes AS "durationMinutes"
         FROM faculty_availability
        WHERE faculty_id = $1
        ORDER BY day_of_week, start_time`,
      [facultyId],
    );
    return result.rows;
  }

  async teaching(facultyId: number): Promise<TeachingSession[]> {
    const result = await this.db.query<TeachingSession>(
      `SELECT bs.day_of_week AS "dayOfWeek",
              to_char(bs.start_time, 'HH24:MI') AS "startTime",
              to_char(bs.end_time, 'HH24:MI') AS "endTime",
              bs.course_code AS "courseCode", bs.course_title AS "courseTitle",
              bs.session_type AS "sessionType", b.name AS "batchName", bs.room
         FROM batch_schedule bs
         JOIN batches b ON b.id = bs.batch_id
        WHERE bs.faculty_id = $1
        ORDER BY bs.day_of_week, bs.start_time`,
      [facultyId],
    );
    return result.rows;
  }

  async slotMinutes(db: Queryable, facultyId: number): Promise<number> {
    const result = await db.query<{ slot_minutes: number }>(
      'SELECT slot_minutes FROM faculty WHERE user_id = $1',
      [facultyId],
    );
    return (result.rows[0] as { slot_minutes: number }).slot_minutes;
  }

  /**
   * Makes the stored weekly set equal to `windows`, touching only what changed: windows no longer
   * wanted are deleted first, then new ones inserted (so a window can move into a slot another one
   * just vacated). The temporal constraint rejects overlapping windows; the audit log records exactly
   * the rows that changed. Runs inside the caller's transaction.
   */
  async replaceWindows(
    db: Queryable,
    facultyId: number,
    windows: AvailabilityWindow[],
  ): Promise<{ added: number; removed: number }> {
    const wanted = JSON.stringify(windows);
    const removed = await db.query(
      `DELETE FROM faculty_availability a
        WHERE a.faculty_id = $1
          AND NOT EXISTS (
                SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS w("dayOfWeek" smallint, "startTime" time, "endTime" time)
                 WHERE w."dayOfWeek" = a.day_of_week AND w."startTime" = a.start_time AND w."endTime" = a.end_time)`,
      [facultyId, wanted],
    );
    const added = await db.query(
      `INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time)
       SELECT DISTINCT $1::bigint, w."dayOfWeek", w."startTime", w."endTime"
         FROM jsonb_to_recordset($2::jsonb) AS w("dayOfWeek" smallint, "startTime" time, "endTime" time)
        WHERE NOT EXISTS (
                SELECT 1 FROM faculty_availability a
                 WHERE a.faculty_id = $1 AND a.day_of_week = w."dayOfWeek"
                   AND a.start_time = w."startTime" AND a.end_time = w."endTime")`,
      [facultyId, wanted],
    );
    return { added: Number(added.rowCount), removed: Number(removed.rowCount) };
  }

  async upcomingExceptions(db: Queryable, facultyId: number): Promise<ScheduleException[]> {
    const result = await db.query<ExceptionRow>(
      `SELECT id, kind, lower(period) AS starts_at, upper(period) AS ends_at, reason, created_at
         FROM faculty_schedule_exceptions
        WHERE faculty_id = $1 AND upper(period) > app_now()
        ORDER BY lower(period)`,
      [facultyId],
    );
    return result.rows.map(toException);
  }

  /** How many upcoming active appointments an exception over [startsAt, endsAt) would release. */
  async countReleasable(db: Queryable, facultyId: number, startsAt: string, endsAt: string): Promise<number> {
    const result = await db.query<{ n: number }>(
      `SELECT count(*) AS n FROM appointments
        WHERE faculty_id = $1 AND status IN ('PENDING', 'APPROVED')
          AND slot && tstzrange($2::timestamptz, $3::timestamptz, '[)')
          AND lower(slot) > app_now()`,
      [facultyId, startsAt, endsAt],
    );
    return (result.rows[0] as { n: number }).n;
  }

  async createException(
    db: Queryable,
    facultyId: number,
    input: { kind: ExceptionKind; startsAt: string; endsAt: string; reason: string | undefined },
  ): Promise<ScheduleException> {
    const result = await db.query<ExceptionRow>(
      `INSERT INTO faculty_schedule_exceptions (faculty_id, kind, period, reason)
       VALUES ($1, $2, tstzrange($3::timestamptz, $4::timestamptz, '[)'), $5)
       RETURNING id, kind, lower(period) AS starts_at, upper(period) AS ends_at, reason, created_at`,
      [facultyId, input.kind, input.startsAt, input.endsAt, input.reason ?? null],
    );
    return toException(result.rows[0] as ExceptionRow);
  }

  async deleteException(db: Queryable, facultyId: number, exceptionId: number): Promise<boolean> {
    const result = await db.query(
      'DELETE FROM faculty_schedule_exceptions WHERE id = $1 AND faculty_id = $2',
      [exceptionId, facultyId],
    );
    return result.rowCount === 1;
  }
}
