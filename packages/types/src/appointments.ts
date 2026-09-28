import type { AppointmentStatus } from './domain';

/** Who cancelled an appointment: the student, the faculty member (directly or by recording leave). */
export type CancelledBy = 'STUDENT' | 'FACULTY';

/** One appointment as every endpoint returns it. Timestamps are ISO 8601 strings. */
export interface Appointment {
  id: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  purpose: string;
  /** The faculty member's note on approval, reason on rejection, or reason for cancellation. */
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: CancelledBy | null;
  completedAt: string | null;
  student: {
    id: number;
    name: string;
    registrationNumber: string;
    batchName: string;
  };
  faculty: {
    id: number;
    name: string;
    employeeId: string;
    designation: string;
    officeLocation: string;
    departmentCode: string;
    departmentName: string;
  };
}

export type AppointmentCounts = Record<AppointmentStatus, number>;

/** `GET /api/appointments/me` */
export interface AppointmentList {
  appointments: Appointment[];
  /** Totals per status for the caller (unaffected by the `status` filter) — for tab badges. */
  counts: AppointmentCounts;
}

/** `POST /api/appointments` */
export interface CreateAppointmentRequest {
  facultyId: number;
  /** Start of one of the slots returned by `GET /api/faculty/:id/availability`. */
  startsAt: string;
  /** Why the student wants to meet (10–500 characters). */
  purpose: string;
}

/** `PATCH /api/appointments/:id/approve` */
export interface ApproveAppointmentRequest {
  note?: string;
}

/** `PATCH /api/appointments/:id/reject` and `/cancel` */
export interface ReasonRequest {
  reason?: string;
}
