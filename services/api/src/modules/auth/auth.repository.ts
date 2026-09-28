import type { AuthUser, UserRole } from '@afb/types';
import type { Queryable } from '../../db/types';

export interface Credentials {
  id: number;
  loginId: string;
  role: UserRole;
  passwordHash: string;
  isActive: boolean;
}

interface AuthUserRow {
  id: number;
  login_id: string;
  full_name: string;
  role: UserRole;
  batch_id: number | null;
  batch_name: string | null;
  year_of_study: number | null;
  academic_year: string | null;
  student_department_code: string | null;
  student_department_name: string | null;
  faculty_department_id: number | null;
  faculty_department_code: string | null;
  faculty_department_name: string | null;
  designation: string | null;
  office_location: string | null;
  slot_minutes: number | null;
}

export class AuthRepository {
  constructor(private readonly db: Queryable) {}

  /** Login lookup by login id (exact match; callers normalise to upper case). */
  async findCredentials(loginId: string): Promise<Credentials | null> {
    const result = await this.db.query<{
      id: number;
      login_id: string;
      role: UserRole;
      password_hash: string;
      is_active: boolean;
    }>('SELECT id, login_id, role, password_hash, is_active FROM users WHERE login_id = $1', [loginId]);
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          id: row.id,
          loginId: row.login_id,
          role: row.role,
          passwordHash: row.password_hash,
          isActive: row.is_active,
        };
  }

  /** Role and status for per-request session checks (primary-key lookup). */
  async findSessionUser(userId: number): Promise<{ role: UserRole; isActive: boolean } | null> {
    const result = await this.db.query<{ role: UserRole; is_active: boolean }>(
      'SELECT role, is_active FROM users WHERE id = $1',
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? null : { role: row.role, isActive: row.is_active };
  }

  /** Stamps a successful login. Run inside a transaction with the user as actor, so it is audited as theirs. */
  async recordLogin(db: Queryable, userId: number): Promise<void> {
    await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  }

  /** The signed-in user with their role-specific profile, in one query. */
  async findAuthUser(userId: number): Promise<AuthUser | null> {
    const result = await this.db.query<AuthUserRow>(
      `SELECT u.id, u.login_id, u.full_name, u.role,
              s.batch_id, b.name AS batch_name, b.year_of_study, b.academic_year,
              sd.code AS student_department_code, sd.name AS student_department_name,
              f.department_id AS faculty_department_id, fd.code AS faculty_department_code,
              fd.name AS faculty_department_name, f.designation, f.office_location, f.slot_minutes
         FROM users u
         LEFT JOIN students s     ON s.user_id = u.id
         LEFT JOIN batches b      ON b.id = s.batch_id
         LEFT JOIN departments sd ON sd.id = b.department_id
         LEFT JOIN faculty f      ON f.user_id = u.id
         LEFT JOIN departments fd ON fd.id = f.department_id
        WHERE u.id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toAuthUser(row);
  }
}

export class IncompleteAccountError extends Error {
  constructor(userId: number, role: UserRole) {
    super(`User ${userId} has role ${role} but no ${role.toLowerCase()} record`);
    this.name = 'IncompleteAccountError';
  }
}

function toAuthUser(row: AuthUserRow): AuthUser {
  const base = { id: row.id, loginId: row.login_id, fullName: row.full_name };
  switch (row.role) {
    case 'STUDENT':
      if (row.batch_id === null) {
        throw new IncompleteAccountError(row.id, row.role);
      }
      return {
        ...base,
        role: 'STUDENT',
        student: {
          batchId: row.batch_id,
          batchName: row.batch_name as string,
          yearOfStudy: row.year_of_study as number,
          academicYear: row.academic_year as string,
          departmentCode: row.student_department_code as string,
          departmentName: row.student_department_name as string,
        },
      };
    case 'FACULTY':
      if (row.faculty_department_id === null) {
        throw new IncompleteAccountError(row.id, row.role);
      }
      return {
        ...base,
        role: 'FACULTY',
        faculty: {
          departmentId: row.faculty_department_id,
          departmentCode: row.faculty_department_code as string,
          departmentName: row.faculty_department_name as string,
          designation: row.designation as string,
          officeLocation: row.office_location as string,
          slotMinutes: row.slot_minutes as number,
        },
      };
    case 'ADMIN':
      return { ...base, role: 'ADMIN' };
  }
}
