import type { Appointment, AppointmentCounts, FacultyDashboard, WeeklyActivity } from '@afb/types';
import type { Queryable } from '../../db/types';
import { type AppointmentRepository, toAppointment } from '../appointments/appointment.repository';

type AppointmentRow = Parameters<typeof toAppointment>[0];

/** Today's date on the campus calendar, according to the business clock. */
const TODAY = '(app_now() AT TIME ZONE campus_timezone())::date';

export class FacultyDashboardRepository {
  constructor(
    private readonly db: Queryable,
    private readonly appointments: AppointmentRepository,
  ) {}

  async profile(facultyId: number): Promise<FacultyDashboard['faculty']> {
    const result = await this.db.query<FacultyDashboard['faculty']>(
      `SELECT u.full_name AS name, u.login_id AS "employeeId", f.designation, d.name AS "departmentName",
              f.office_location AS "officeLocation", f.slot_minutes AS "slotMinutes"
         FROM users u
         JOIN faculty f     ON f.user_id = u.id
         JOIN departments d ON d.id = f.department_id
        WHERE u.id = $1`,
      [facultyId],
    );
    return result.rows[0] as FacultyDashboard['faculty'];
  }

  async counts(facultyId: number): Promise<AppointmentCounts & { total: number }> {
    const counts = await this.appointments.countsFor('faculty', facultyId);
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    return { ...counts, total };
  }

  /** Approved and completed meetings whose slot is on today's campus date. */
  async today(facultyId: number): Promise<Appointment[]> {
    const result = await this.db.query<AppointmentRow>(
      `SELECT * FROM appointment_details
        WHERE faculty_id = $1
          AND status IN ('APPROVED', 'COMPLETED')
          AND (starts_at AT TIME ZONE campus_timezone())::date = ${TODAY}
        ORDER BY starts_at`,
      [facultyId],
    );
    return result.rows.map(toAppointment);
  }

  /** Approved meetings on later days, soonest first. */
  async upcoming(facultyId: number, limit: number): Promise<Appointment[]> {
    const result = await this.db.query<AppointmentRow>(
      `SELECT * FROM appointment_details
        WHERE faculty_id = $1
          AND status = 'APPROVED'
          AND (starts_at AT TIME ZONE campus_timezone())::date > ${TODAY}
        ORDER BY starts_at
        LIMIT $2`,
      [facultyId, limit],
    );
    return result.rows.map(toAppointment);
  }

  /** Most recent activity: ordered by the latest thing that happened to each appointment. */
  async recent(facultyId: number, limit: number): Promise<Appointment[]> {
    const result = await this.db.query<AppointmentRow>(
      `SELECT * FROM appointment_details
        WHERE faculty_id = $1
        ORDER BY greatest(created_at, decided_at, cancelled_at, completed_at) DESC
        LIMIT $2`,
      [facultyId, limit],
    );
    return result.rows.map(toAppointment);
  }

  /**
   * Response statistics in one pass: a decision counts only if it was made before the slot started
   * (the sweeper's expiry of unanswered requests is not a response). The median uses the ordered-set
   * aggregate percentile_cont, which is robust to one request that waited for days.
   */
  async responseStats(
    facultyId: number,
  ): Promise<Pick<FacultyDashboard['stats'], 'responded' | 'approvalRatePct' | 'medianResponseMinutes'>> {
    const result = await this.db.query<{
      responded: number;
      approvalRatePct: number | null;
      medianResponseMinutes: number | null;
    }>(
      `SELECT count(*)::integer AS responded,
              round(100.0 * count(*) FILTER (WHERE status <> 'REJECTED') / nullif(count(*), 0), 1)::float8
                AS "approvalRatePct",
              round((percentile_cont(0.5) WITHIN GROUP (
                       ORDER BY EXTRACT(EPOCH FROM decided_at - created_at) / 60))::numeric, 1)::float8
                AS "medianResponseMinutes"
         FROM appointments
        WHERE faculty_id = $1 AND decided_at IS NOT NULL AND decided_at < lower(slot)`,
      [facultyId],
    );
    return result.rows[0] as {
      responded: number;
      approvalRatePct: number | null;
      medianResponseMinutes: number | null;
    };
  }

  /**
   * The last `weeks` campus weeks (Monday-based) up to the current one. generate_series produces every
   * week, and the LEFT JOIN keeps weeks without appointments as zero rows — a GROUP BY over appointments
   * alone would silently skip them and the chart would have gaps.
   */
  async weekly(facultyId: number, weeks: number): Promise<WeeklyActivity[]> {
    const result = await this.db.query<WeeklyActivity>(
      `WITH week AS (
         SELECT generate_series(date_trunc('week', ${TODAY}) - make_interval(weeks => $2 - 1),
                                date_trunc('week', ${TODAY}),
                                interval '1 week')::date AS week_start
       )
       SELECT to_char(w.week_start, 'YYYY-MM-DD') AS "weekStart",
              count(a.id)::integer AS requests,
              count(a.id) FILTER (WHERE a.status IN ('APPROVED', 'COMPLETED'))::integer AS accepted
         FROM week w
         LEFT JOIN appointments a
           ON a.faculty_id = $1
          AND date_trunc('week', lower(a.slot) AT TIME ZONE campus_timezone())::date = w.week_start
        GROUP BY w.week_start
        ORDER BY w.week_start`,
      [facultyId, weeks],
    );
    return result.rows;
  }
}
