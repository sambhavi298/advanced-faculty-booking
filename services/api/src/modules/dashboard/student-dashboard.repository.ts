import type { Appointment, AppointmentCounts, StudentDashboard } from '@afb/types';
import type { Queryable } from '../../db/types';
import { type AppointmentRepository, toAppointment } from '../appointments/appointment.repository';

type AppointmentRow = Parameters<typeof toAppointment>[0];

export class StudentDashboardRepository {
  constructor(
    private readonly db: Queryable,
    private readonly appointments: AppointmentRepository,
  ) {}

  async profile(studentId: number): Promise<StudentDashboard['student']> {
    const result = await this.db.query<StudentDashboard['student']>(
      `SELECT u.full_name AS name, u.login_id AS "registrationNumber", b.name AS "batchName", d.name AS "departmentName"
         FROM users u
         JOIN students s    ON s.user_id = u.id
         JOIN batches b     ON b.id = s.batch_id
         JOIN departments d ON d.id = b.department_id
        WHERE u.id = $1`,
      [studentId],
    );
    return result.rows[0] as StudentDashboard['student'];
  }

  async counts(studentId: number): Promise<AppointmentCounts & { total: number }> {
    const counts = await this.appointments.countsFor('student', studentId);
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    return { ...counts, total };
  }

  /** The next approved appointment that has not ended yet. */
  async upcoming(studentId: number): Promise<Appointment | null> {
    const result = await this.db.query<AppointmentRow>(
      `SELECT * FROM appointment_details
        WHERE student_id = $1 AND status = 'APPROVED' AND ends_at > app_now()
        ORDER BY starts_at
        LIMIT 1`,
      [studentId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toAppointment(row);
  }

  /** Most recent activity: ordered by the latest thing that happened to each appointment. */
  async recent(studentId: number, limit: number): Promise<Appointment[]> {
    const result = await this.db.query<AppointmentRow>(
      `SELECT * FROM appointment_details
        WHERE student_id = $1
        ORDER BY greatest(created_at, decided_at, cancelled_at, completed_at) DESC
        LIMIT $2`,
      [studentId, limit],
    );
    return result.rows.map(toAppointment);
  }
}
