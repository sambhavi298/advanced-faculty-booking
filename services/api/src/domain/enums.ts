import type { AppointmentStatus, ExceptionKind, NotificationKind, UserRole } from '@afb/types';

/*
 * Runtime lists of each domain vocabulary. `satisfies` ties every list to its @afb/types union at
 * compile time, and an integration test compares each list with the matching PostgreSQL enum, so
 * TypeScript, the API and the database can never silently disagree.
 */

export const USER_ROLES = ['STUDENT', 'FACULTY', 'ADMIN'] as const satisfies readonly UserRole[];

export const APPOINTMENT_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'COMPLETED',
] as const satisfies readonly AppointmentStatus[];

export const EXCEPTION_KINDS = ['LEAVE', 'MEETING', 'BLOCKED'] as const satisfies readonly ExceptionKind[];

export const NOTIFICATION_KINDS = [
  'APPOINTMENT_REQUESTED',
  'APPOINTMENT_APPROVED',
  'APPOINTMENT_REJECTED',
  'APPOINTMENT_CANCELLED',
] as const satisfies readonly NotificationKind[];
