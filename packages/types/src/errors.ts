/**
 * Every machine-readable error code the API can return.
 *
 * Clients branch on `code`, never on `message` (messages are human-readable and may change).
 * New codes are added here first, so the API and every portal stay in lock-step at compile time.
 */
export type ErrorCode =
  // Request shape problems (4xx)
  | 'VALIDATION_ERROR'
  | 'MALFORMED_JSON'
  | 'PAYLOAD_TOO_LARGE'
  | 'BAD_REQUEST'
  | 'ROUTE_NOT_FOUND'
  // Identity and permissions
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'WRONG_PORTAL'
  | 'TOO_MANY_REQUESTS'
  | 'FORBIDDEN'
  // Resource state
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE'
  | 'INVALID_REFERENCE'
  | 'STILL_REFERENCED'
  // Scheduling rules (raised by PostgreSQL constraints and triggers)
  | 'SLOT_CONFLICT'
  | 'STUDENT_SCHEDULE_CONFLICT'
  | 'AVAILABILITY_OVERLAP'
  | 'CLASS_SCHEDULE_OVERLAP'
  | 'SLOT_IN_PAST'
  | 'SLOT_BEYOND_HORIZON'
  | 'SLOT_NOT_OFFERED'
  | 'FACULTY_UNAVAILABLE'
  | 'STUDENT_HAS_CLASS'
  | 'INVALID_STATUS_TRANSITION'
  | 'APPOINTMENT_IMMUTABLE'
  | 'PERIOD_ALREADY_ENDED'
  | 'BOOKING_LIMIT_REACHED'
  // Concurrency (raised by PostgreSQL under contention)
  | 'TRANSACTION_CONFLICT'
  | 'RESOURCE_BUSY'
  // Infrastructure
  | 'DATABASE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/** The single error envelope returned by every failing API response. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Optional structured context, e.g. which field failed validation or which constraint was violated. */
    details?: unknown;
    /** Correlates the response with the server log line (also sent as the `X-Request-Id` header). */
    requestId: string;
  };
}
