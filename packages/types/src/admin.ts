import type { Appointment, AppointmentCounts } from './appointments';
import type { AppointmentStatus, UserRole } from './domain';

/** One row of the audit trail (written by the audit_row_change() trigger). */
export interface AuditEntry {
  id: number;
  occurredAt: string;
  /** Database transaction id: rows with the same value were one atomic change. */
  transactionId: string;
  /** null = a change made outside the API (migration, seed, scheduled sweep). */
  actor: { id: number; name: string | null; loginId: string | null; role: UserRole | null } | null;
  tableName: string;
  recordId: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  changedFields: string[] | null;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
}

/** `GET /api/admin/dashboard` — computed live from the tables on every request. */
export interface AdminDashboard {
  totals: {
    students: number;
    faculty: number;
    departments: number;
    batches: number;
    /** Accounts that can currently sign in. */
    activeUsers: number;
    appointments: number;
  };
  appointmentsByStatus: AppointmentCounts;
  today: {
    /** Approved or completed appointments whose slot is on today's campus date. */
    meetings: number;
    /** Requests created today. */
    requests: number;
  };
  /** Requests created per campus day, last 14 days, oldest first; days without requests are 0. */
  daily: { date: string; requests: number }[];
  /** Faculty ranked by number of requests (DENSE_RANK), top 5. */
  topFaculty: {
    rank: number;
    facultyId: number;
    name: string;
    departmentCode: string;
    requests: number;
    pending: number;
    approvalRatePct: number | null;
  }[];
  recentAudit: AuditEntry[];
}

export interface AdminStudent {
  id: number;
  name: string;
  registrationNumber: string;
  batchName: string;
  yearOfStudy: number;
  departmentCode: string;
  isActive: boolean;
  lastLoginAt: string | null;
  appointments: { total: number; pending: number; upcoming: number };
}

export interface AdminFaculty {
  id: number;
  name: string;
  employeeId: string;
  designation: string;
  officeLocation: string;
  departmentCode: string;
  departmentName: string;
  slotMinutes: number;
  weeklyAvailableMinutes: number;
  isActive: boolean;
  lastLoginAt: string | null;
  appointments: { total: number; pending: number; upcoming: number };
}

export interface AdminDepartment {
  id: number;
  code: string;
  name: string;
  faculty: number;
  students: number;
  batches: number;
  appointments: number;
}

/** `PATCH /api/admin/users/:id/status` */
export interface UserStatusRequest {
  isActive: boolean;
}

export interface UserStatusResponse {
  id: number;
  loginId: string;
  name: string;
  role: UserRole;
  isActive: boolean;
}

/** `GET /api/admin/appointments` query */
export interface AdminAppointmentFilter {
  status?: AppointmentStatus;
  facultyId?: number;
  /** Student or faculty name, Registration Number or Employee ID. */
  search?: string;
  /** Campus dates, inclusive, 'YYYY-MM-DD' (by slot start). */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AdminAppointmentPage {
  appointments: Appointment[];
  /** Matching rows in total (for paging), computed with count(*) OVER (). */
  total: number;
  limit: number;
  offset: number;
}

/** `GET /api/admin/audit` query */
export interface AuditFilter {
  table?: string;
  action?: AuditEntry['action'];
  actorId?: number;
  recordId?: string;
  /** Keyset pagination: only entries with a smaller id. */
  before?: number;
  limit?: number;
}

export interface AuditPage {
  entries: AuditEntry[];
  /** Pass as `before` for the next (older) page; null on the last page. */
  nextBefore: number | null;
}

/** One row of the faculty_monthly_report materialized view. */
export interface MonthlyReportRow {
  facultyId: number;
  facultyName: string;
  departmentCode: string;
  /** First day of the month, 'YYYY-MM-DD'. */
  month: string;
  totalRequests: number;
  pending: number;
  approved: number;
  completed: number;
  rejected: number;
  cancelled: number;
  avgResponseMinutes: number | null;
  approvalRatePct: number | null;
  demandRankInDepartment: number;
  changeFromPreviousMonth: number | null;
  cumulativeRequests: number;
}

/** `GET /api/admin/reports` */
export interface MonthlyReport {
  rows: MonthlyReportRow[];
  /** When the materialized view was last refreshed (null if it holds no rows). */
  refreshedAt: string | null;
}
