/**
 * Domain vocabularies. Each mirrors a PostgreSQL enum type of the same meaning
 * (a test in services/api fails if the two ever drift apart).
 */

/** `user_role` */
export type UserRole = 'STUDENT' | 'FACULTY' | 'ADMIN';

/** `appointment_status` — PENDING → APPROVED | REJECTED | CANCELLED; APPROVED → COMPLETED | CANCELLED. */
export type AppointmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'COMPLETED';

/** `exception_kind` — why a faculty member is unavailable for a one-off period. */
export type ExceptionKind = 'LEAVE' | 'MEETING' | 'BLOCKED';

/** `notification_kind` */
export type NotificationKind =
  'APPOINTMENT_REQUESTED' | 'APPOINTMENT_APPROVED' | 'APPOINTMENT_REJECTED' | 'APPOINTMENT_CANCELLED';
