import type { Appointment, AppointmentCounts } from './appointments';
import type { NotificationKind } from './domain';

/** An in-app notification (written by database triggers when an appointment changes). */
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  appointmentId: string | null;
  readAt: string | null;
  createdAt: string;
}

/** `GET /api/notifications` */
export interface NotificationList {
  unread: number;
  notifications: AppNotification[];
}

/** `GET /api/student/dashboard` */
export interface StudentDashboard {
  student: {
    name: string;
    registrationNumber: string;
    batchName: string;
    departmentName: string;
  };
  /** Per-status counts plus the overall total. */
  counts: AppointmentCounts & { total: number };
  /** The next approved appointment that has not ended, if any. */
  upcoming: Appointment | null;
  /** The most recently created or updated appointments (newest first, up to 5). */
  recent: Appointment[];
}

/** One week of the faculty dashboard's activity chart. */
export interface WeeklyActivity {
  /** Monday of the week, 'YYYY-MM-DD' (campus calendar). */
  weekStart: string;
  /** Appointments (any status) whose slot falls in the week. */
  requests: number;
  /** Of those, how many were approved (APPROVED or COMPLETED). */
  accepted: number;
}

/** `GET /api/faculty/dashboard` */
export interface FacultyDashboard {
  faculty: {
    name: string;
    employeeId: string;
    designation: string;
    departmentName: string;
    officeLocation: string;
    slotMinutes: number;
  };
  /** Per-status counts plus the overall total. */
  counts: AppointmentCounts & { total: number };
  /** Approved and completed appointments on today's campus date, in time order. */
  today: Appointment[];
  /** Requests waiting for a decision, soonest slot first (up to 5; the full count is `counts.PENDING`). */
  pending: Appointment[];
  /** Approved appointments after today, soonest first (up to 5). */
  upcoming: Appointment[];
  stats: {
    /** Requests decided before their slot started (expired requests excluded). */
    responded: number;
    /** Share of those decisions that were approvals, 0–100, or null before the first decision. */
    approvalRatePct: number | null;
    /** Median minutes from request to decision, or null before the first decision. */
    medianResponseMinutes: number | null;
    /** The last 8 weeks up to and including the current one, oldest first; weeks without activity are 0. */
    weekly: WeeklyActivity[];
  };
  /** The most recently changed appointments, newest first (up to 5). */
  recent: Appointment[];
}
