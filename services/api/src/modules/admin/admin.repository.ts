import type {
  AdminAppointmentFilter,
  AdminDashboard,
  AdminDepartment,
  AdminFaculty,
  AdminStudent,
  Appointment,
  AppointmentCounts,
  AuditEntry,
  AuditFilter,
  MonthlyReportRow,
  UserRole,
  UserStatusResponse,
} from '@afb/types';
import type { Queryable } from '../../db/types';
import { toAppointment } from '../appointments/appointment.repository';

type AppointmentRow = Parameters<typeof toAppointment>[0];

const TODAY = '(app_now() AT TIME ZONE campus_timezone())::date';

interface AuditRow {
  id: number;
  occurred_at: Date;
  transaction_id: string;
  actor_user_id: number | null;
  actor_role: UserRole | null;
  actor_name: string | null;
  actor_login: string | null;
  table_name: string;
  record_id: string;
  action: AuditEntry['action'];
  changed_fields: string[] | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

function toAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    transactionId: row.transaction_id,
    actor:
      row.actor_user_id === null
        ? null
        : { id: row.actor_user_id, name: row.actor_name, loginId: row.actor_login, role: row.actor_role },
    tableName: row.table_name,
    recordId: row.record_id,
    action: row.action,
    changedFields: row.changed_fields,
    oldData: row.old_data,
    newData: row.new_data,
  };
}

const AUDIT_SELECT = `
  SELECT l.id, l.occurred_at, l.transaction_id::text AS transaction_id, l.actor_user_id, l.actor_role,
         u.full_name AS actor_name, u.login_id AS actor_login,
         l.table_name, l.record_id, l.action, l.changed_fields, l.old_data, l.new_data
    FROM audit_logs l
    LEFT JOIN users u ON u.id = l.actor_user_id`;

interface PersonRow {
  id: number;
  name: string;
  login_id: string;
  is_active: boolean;
  last_login_at: Date | null;
  total: number;
  pending: number;
  upcoming: number;
}

/** Per-person appointment totals: conditional aggregation (FILTER) in the same pass as the join. */
const APPOINTMENT_TOTALS = `
  count(a.id)::int AS total,
  count(a.id) FILTER (WHERE a.status = 'PENDING')::int AS pending,
  count(a.id) FILTER (WHERE a.status = 'APPROVED' AND lower(a.slot) > app_now())::int AS upcoming`;

/**
 * Read models for the admin portal. Every figure is computed from the live tables with one SQL
 * statement per panel — no counters are stored, so nothing can drift out of date.
 */
export class AdminRepository {
  constructor(private readonly db: Queryable) {}

  async totals(): Promise<AdminDashboard['totals']> {
    const result = await this.db.query<AdminDashboard['totals']>(
      `SELECT (SELECT count(*) FROM students)::int                AS students,
              (SELECT count(*) FROM faculty)::int                 AS faculty,
              (SELECT count(*) FROM departments)::int             AS departments,
              (SELECT count(*) FROM batches)::int                 AS batches,
              (SELECT count(*) FROM users WHERE is_active)::int   AS "activeUsers",
              (SELECT count(*) FROM appointments)::int            AS appointments`,
    );
    return result.rows[0] as AdminDashboard['totals'];
  }

  async appointmentsByStatus(): Promise<AppointmentCounts> {
    const result = await this.db.query<AppointmentCounts>(
      `SELECT count(*) FILTER (WHERE status = 'PENDING')::int   AS "PENDING",
              count(*) FILTER (WHERE status = 'APPROVED')::int  AS "APPROVED",
              count(*) FILTER (WHERE status = 'REJECTED')::int  AS "REJECTED",
              count(*) FILTER (WHERE status = 'CANCELLED')::int AS "CANCELLED",
              count(*) FILTER (WHERE status = 'COMPLETED')::int AS "COMPLETED"
         FROM appointments`,
    );
    return result.rows[0] as AppointmentCounts;
  }

  async today(): Promise<AdminDashboard['today']> {
    const result = await this.db.query<AdminDashboard['today']>(
      `SELECT count(*) FILTER (WHERE status IN ('APPROVED', 'COMPLETED')
                                 AND (lower(slot) AT TIME ZONE campus_timezone())::date = ${TODAY})::int AS meetings,
              count(*) FILTER (WHERE (created_at AT TIME ZONE campus_timezone())::date = ${TODAY})::int AS requests
         FROM appointments`,
    );
    return result.rows[0] as AdminDashboard['today'];
  }

  /** Requests per campus day; generate_series + LEFT JOIN keeps quiet days as zeros. */
  async daily(days: number): Promise<AdminDashboard['daily']> {
    const result = await this.db.query<AdminDashboard['daily'][number]>(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS date, count(a.id)::int AS requests
         FROM generate_series(${TODAY} - ($1::int - 1), ${TODAY}, interval '1 day') AS d(day)
         LEFT JOIN appointments a ON (a.created_at AT TIME ZONE campus_timezone())::date = d.day::date
        GROUP BY d.day
        ORDER BY d.day`,
      [days],
    );
    return result.rows;
  }

  /** Faculty by demand. DENSE_RANK gives tied faculty the same rank without gaps. */
  async topFaculty(limit: number): Promise<AdminDashboard['topFaculty']> {
    const result = await this.db.query<AdminDashboard['topFaculty'][number]>(
      `WITH per_faculty AS (
         SELECT f.user_id, u.full_name, d.code,
                count(a.id)::int AS requests,
                count(a.id) FILTER (WHERE a.status = 'PENDING')::int AS pending,
                round(100.0 * count(a.id) FILTER (WHERE a.status IN ('APPROVED', 'COMPLETED'))
                      / nullif(count(a.id) FILTER (WHERE a.status IN ('APPROVED', 'COMPLETED', 'REJECTED')), 0),
                      1)::float8 AS approval_rate
           FROM faculty f
           JOIN users u       ON u.id = f.user_id
           JOIN departments d ON d.id = f.department_id
           LEFT JOIN appointments a ON a.faculty_id = f.user_id
          GROUP BY f.user_id, u.full_name, d.code
       )
       SELECT dense_rank() OVER (ORDER BY requests DESC)::int AS rank,
              user_id AS "facultyId", full_name AS name, code AS "departmentCode",
              requests, pending, approval_rate AS "approvalRatePct"
         FROM per_faculty
        ORDER BY rank, user_id
        LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  async students(filter: { search?: string; batchId?: number }): Promise<AdminStudent[]> {
    const result = await this.db.query<
      PersonRow & { batch_name: string; year_of_study: number; department_code: string }
    >(
      `SELECT u.id, u.full_name AS name, u.login_id, u.is_active, u.last_login_at,
              b.name AS batch_name, b.year_of_study, d.code AS department_code,
              ${APPOINTMENT_TOTALS}
         FROM students s
         JOIN users u       ON u.id = s.user_id
         JOIN batches b     ON b.id = s.batch_id
         JOIN departments d ON d.id = b.department_id
         LEFT JOIN appointments a ON a.student_id = s.user_id
        WHERE ($1::text IS NULL OR u.full_name ILIKE '%' || $1 || '%' OR u.login_id ILIKE $1 || '%')
          AND ($2::int IS NULL OR b.id = $2)
        GROUP BY u.id, b.id, d.id
        ORDER BY u.login_id
        LIMIT 500`,
      [filter.search ?? null, filter.batchId ?? null],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      registrationNumber: row.login_id,
      batchName: row.batch_name,
      yearOfStudy: row.year_of_study,
      departmentCode: row.department_code,
      isActive: row.is_active,
      lastLoginAt: row.last_login_at?.toISOString() ?? null,
      appointments: { total: row.total, pending: row.pending, upcoming: row.upcoming },
    }));
  }

  async faculty(filter: { search?: string }): Promise<AdminFaculty[]> {
    const result = await this.db.query<
      PersonRow & {
        designation: string;
        office_location: string;
        department_code: string;
        department_name: string;
        slot_minutes: number;
        weekly_minutes: number;
      }
    >(
      `SELECT u.id, u.full_name AS name, u.login_id, u.is_active, u.last_login_at,
              f.designation, f.office_location, f.slot_minutes,
              d.code AS department_code, d.name AS department_name,
              coalesce((SELECT sum(w.duration_minutes) FROM faculty_availability w WHERE w.faculty_id = f.user_id), 0)::int
                AS weekly_minutes,
              ${APPOINTMENT_TOTALS}
         FROM faculty f
         JOIN users u       ON u.id = f.user_id
         JOIN departments d ON d.id = f.department_id
         LEFT JOIN appointments a ON a.faculty_id = f.user_id
        WHERE ($1::text IS NULL OR u.full_name ILIKE '%' || $1 || '%' OR u.login_id ILIKE $1 || '%'
               OR d.code ILIKE $1)
        GROUP BY u.id, f.user_id, d.id
        ORDER BY u.login_id`,
      [filter.search ?? null],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      employeeId: row.login_id,
      designation: row.designation,
      officeLocation: row.office_location,
      departmentCode: row.department_code,
      departmentName: row.department_name,
      slotMinutes: row.slot_minutes,
      weeklyAvailableMinutes: row.weekly_minutes,
      isActive: row.is_active,
      lastLoginAt: row.last_login_at?.toISOString() ?? null,
      appointments: { total: row.total, pending: row.pending, upcoming: row.upcoming },
    }));
  }

  async departments(): Promise<AdminDepartment[]> {
    const result = await this.db.query<AdminDepartment>(
      `SELECT d.id, d.code, d.name,
              (SELECT count(*) FROM faculty f WHERE f.department_id = d.id)::int AS faculty,
              (SELECT count(*) FROM students s JOIN batches b ON b.id = s.batch_id
                WHERE b.department_id = d.id)::int AS students,
              (SELECT count(*) FROM batches b WHERE b.department_id = d.id)::int AS batches,
              (SELECT count(*) FROM appointments a JOIN faculty f ON f.user_id = a.faculty_id
                WHERE f.department_id = d.id)::int AS appointments
         FROM departments d
        ORDER BY d.code`,
    );
    return result.rows;
  }

  async setActive(db: Queryable, userId: number, isActive: boolean): Promise<UserStatusResponse | null> {
    const result = await db.query<UserStatusResponse>(
      `UPDATE users SET is_active = $2 WHERE id = $1
       RETURNING id, login_id AS "loginId", full_name AS name, role, is_active AS "isActive"`,
      [userId, isActive],
    );
    return result.rows[0] ?? null;
  }

  /** Filtered appointment list with the total match count from a window function over the same scan. */
  async appointments(
    filter: Required<Pick<AdminAppointmentFilter, 'limit' | 'offset'>> & AdminAppointmentFilter,
  ): Promise<{ appointments: Appointment[]; total: number }> {
    const result = await this.db.query<AppointmentRow & { total_count: number }>(
      `SELECT *, count(*) OVER ()::int AS total_count
         FROM appointment_details
        WHERE ($1::appointment_status IS NULL OR status = $1)
          AND ($2::bigint IS NULL OR faculty_id = $2)
          AND ($3::text IS NULL
               OR student_name ILIKE '%' || $3 || '%' OR faculty_name ILIKE '%' || $3 || '%'
               OR registration_number ILIKE $3 || '%' OR employee_id ILIKE $3 || '%')
          AND ($4::date IS NULL OR (starts_at AT TIME ZONE campus_timezone())::date >= $4)
          AND ($5::date IS NULL OR (starts_at AT TIME ZONE campus_timezone())::date <= $5)
        ORDER BY starts_at DESC, id
        LIMIT $6 OFFSET $7`,
      [
        filter.status ?? null,
        filter.facultyId ?? null,
        filter.search ?? null,
        filter.from ?? null,
        filter.to ?? null,
        filter.limit,
        filter.offset,
      ],
    );
    return {
      appointments: result.rows.map(toAppointment),
      total: result.rows[0]?.total_count ?? 0,
    };
  }

  /** Keyset pagination on the identity column (newest first): stable and index-friendly at any depth. */
  async audit(filter: AuditFilter & { limit: number }): Promise<AuditEntry[]> {
    const result = await this.db.query<AuditRow>(
      `${AUDIT_SELECT}
        WHERE ($1::text IS NULL OR l.table_name = $1)
          AND ($2::text IS NULL OR l.action = $2)
          AND ($3::bigint IS NULL OR l.actor_user_id = $3)
          AND ($4::text IS NULL OR l.record_id = $4)
          AND ($5::bigint IS NULL OR l.id < $5)
        ORDER BY l.id DESC
        LIMIT $6`,
      [
        filter.table ?? null,
        filter.action ?? null,
        filter.actorId ?? null,
        filter.recordId ?? null,
        filter.before ?? null,
        filter.limit,
      ],
    );
    return result.rows.map(toAuditEntry);
  }

  async report(month: string | null): Promise<{ rows: MonthlyReportRow[]; refreshedAt: Date | null }> {
    const result = await this.db.query<MonthlyReportRow & { refreshed_at: Date }>(
      `SELECT faculty_id AS "facultyId", faculty_name AS "facultyName", department_code AS "departmentCode",
              to_char(month, 'YYYY-MM-DD') AS month, total_requests AS "totalRequests", pending, approved,
              completed, rejected, cancelled, avg_response_minutes AS "avgResponseMinutes",
              approval_rate_pct AS "approvalRatePct", demand_rank_in_department AS "demandRankInDepartment",
              change_from_previous_month AS "changeFromPreviousMonth", cumulative_requests AS "cumulativeRequests",
              refreshed_at
         FROM faculty_monthly_report
        WHERE ($1::date IS NULL OR month = $1)
        ORDER BY month DESC, department_code, demand_rank_in_department, faculty_id`,
      [month],
    );
    const refreshedAt = result.rows[0]?.refreshed_at ?? null;
    return { rows: result.rows.map(({ refreshed_at: _refreshed, ...row }) => row), refreshedAt };
  }

  /** REFRESH MATERIALIZED VIEW CONCURRENTLY (readers are not blocked while it runs). */
  async refreshReports(): Promise<Date> {
    const result = await this.db.query<{ refreshed_at: Date }>('SELECT refresh_reports() AS refreshed_at');
    return (result.rows[0] as { refreshed_at: Date }).refreshed_at;
  }
}
