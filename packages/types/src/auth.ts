import type { UserRole } from './domain';

/** `POST /api/auth/login` request body. */
export interface LoginRequest {
  /** Registration Number (student), Employee ID (faculty) or Admin ID (admin). Case-insensitive. */
  loginId: string;
  password: string;
  /**
   * The portal the user is signing in to. When given, an account of another role is refused with
   * 403 WRONG_PORTAL (after the password has been verified), e.g. a faculty member on the student portal.
   */
  role?: UserRole;
}

export interface StudentProfile {
  batchId: number;
  batchName: string;
  yearOfStudy: number;
  academicYear: string;
  departmentCode: string;
  departmentName: string;
}

export interface FacultyProfile {
  departmentId: number;
  departmentCode: string;
  departmentName: string;
  designation: string;
  officeLocation: string;
  slotMinutes: number;
}

interface AuthUserBase {
  id: number;
  loginId: string;
  fullName: string;
}

/** The signed-in user, as returned by login and `GET /api/auth/me`. */
export type AuthUser =
  | (AuthUserBase & { role: 'STUDENT'; student: StudentProfile })
  | (AuthUserBase & { role: 'FACULTY'; faculty: FacultyProfile })
  | (AuthUserBase & { role: 'ADMIN' });

/** `POST /api/auth/login` response body. */
export interface LoginResponse {
  /** JWT to send as `Authorization: Bearer <token>` on every other request. */
  token: string;
  /** ISO timestamp after which the token is rejected and the user must log in again. */
  expiresAt: string;
  user: AuthUser;
}
