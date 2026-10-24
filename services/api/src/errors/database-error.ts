import type { ErrorCode } from '@afb/types';
import { DatabaseError } from 'pg';
import { AppError, ConflictError, ValidationError } from './app-error';

/**
 * Translates PostgreSQL failures into client-facing AppErrors.
 *
 * The database is the final authority on integrity (constraints, exclusion constraints, triggers,
 * locks). When it rejects a statement, the SQLSTATE code — and for constraint violations the
 * constraint name — tells us exactly *why*, which maps to a precise HTTP answer. For example the
 * exclusion constraint `appointments_no_double_booking` becomes 409 SLOT_CONFLICT, not a 500.
 *
 * Returns `null` for anything that is not a recognised database failure, so the caller can fall
 * through to the generic 500 handling.
 */
export function translateDatabaseError(err: unknown): AppError | null {
  if (err instanceof DatabaseError) {
    return translateSqlState(err);
  }
  if (isConnectionFailure(err)) {
    return databaseUnavailable();
  }
  return null;
}

interface ErrorSpec {
  status: number;
  code: ErrorCode;
}

/**
 * Specific constraints whose violation deserves a specific, user-facing explanation.
 * Constraint names are defined in database/migrations; anything not listed falls back to the
 * generic mapping for its SQLSTATE.
 */
const CONSTRAINT_ERRORS: Record<string, ErrorSpec & { message: string }> = {
  appointments_no_double_booking: {
    status: 409,
    code: 'SLOT_CONFLICT',
    message: 'This slot has just been taken by another request. Please choose a different slot.',
  },
  appointments_student_no_overlap: {
    status: 409,
    code: 'STUDENT_SCHEDULE_CONFLICT',
    message: 'You already have an appointment at this time.',
  },
  faculty_availability_no_overlap: {
    status: 409,
    code: 'AVAILABILITY_OVERLAP',
    message: 'Availability windows on the same day cannot overlap.',
  },
  batch_schedule_no_overlap: {
    status: 409,
    code: 'CLASS_SCHEDULE_OVERLAP',
    message: 'This batch already has a class at that time.',
  },
  users_login_id_key: {
    status: 409,
    code: 'DUPLICATE',
    message: 'An account with this login ID already exists.',
  },
  departments_code_key: {
    status: 409,
    code: 'DUPLICATE',
    message: 'A department with this code already exists.',
  },
  departments_name_key: {
    status: 409,
    code: 'DUPLICATE',
    message: 'A department with this name already exists.',
  },
};

/**
 * Application-defined SQLSTATEs raised by our triggers and functions
 * (see database/migrations/0006_booking_rules.sql). Their messages are written for end users,
 * so the database's message is passed through unchanged.
 */
const BUSINESS_RULE_ERRORS: Record<string, ErrorSpec> = {
  AB001: { status: 400, code: 'SLOT_IN_PAST' },
  AB002: { status: 409, code: 'SLOT_NOT_OFFERED' },
  AB003: { status: 409, code: 'FACULTY_UNAVAILABLE' },
  AB004: { status: 409, code: 'STUDENT_HAS_CLASS' },
  AB005: { status: 409, code: 'INVALID_STATUS_TRANSITION' },
  AB006: { status: 409, code: 'APPOINTMENT_IMMUTABLE' },
  AB007: { status: 400, code: 'SLOT_BEYOND_HORIZON' },
  AB008: { status: 400, code: 'PERIOD_ALREADY_ENDED' },
  AB009: { status: 409, code: 'BOOKING_LIMIT_REACHED' },
};

function databaseUnavailable(): AppError {
  return new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is temporarily unavailable. Please retry.');
}

function translateSqlState(err: DatabaseError): AppError | null {
  const code = err.code ?? '';
  const constraint = err.constraint;

  const businessRule = BUSINESS_RULE_ERRORS[code];
  if (businessRule !== undefined) {
    return new AppError(businessRule.status, businessRule.code, err.message);
  }

  const specific = constraint === undefined ? undefined : CONSTRAINT_ERRORS[constraint];
  if (specific !== undefined) {
    return new AppError(specific.status, specific.code, specific.message, { constraint });
  }

  switch (code) {
    case '23P01': // exclusion_violation
      return new ConflictError('CONFLICT', 'This request overlaps with an existing record.', { constraint });
    case '23505': // unique_violation
      return new ConflictError('DUPLICATE', 'A record with the same unique value already exists.', {
        constraint,
      });
    case '23001': // restrict_violation (ON DELETE RESTRICT)
      return new ConflictError('STILL_REFERENCED', 'This record is still referenced by other records.', {
        constraint,
      });
    case '23503': // foreign_key_violation
      return err.detail?.includes('is still referenced')
        ? new ConflictError('STILL_REFERENCED', 'This record is still referenced by other records.', {
            constraint,
          })
        : new AppError(400, 'INVALID_REFERENCE', 'The request references a record that does not exist.', {
            constraint,
          });
    case '23514': // check_violation
      return new ValidationError('A value violates a data rule.', { constraint });
    case '23502': // not_null_violation
      return new ValidationError('A required value is missing.', { column: err.column });
    case '22P02': // invalid_text_representation (e.g. malformed number or UUID)
    case '22007': // invalid_datetime_format
    case '22008': // datetime_field_overflow
    case '22003': // numeric_value_out_of_range
    case '22000': // data_exception (e.g. range lower bound greater than upper bound)
      return new ValidationError('A value has an invalid format.');
    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return new ConflictError(
        'TRANSACTION_CONFLICT',
        'Another request changed the same data at the same time. Please retry.',
      );
    case '55P03': // lock_not_available (NOWAIT / lock_timeout)
      return new ConflictError(
        'RESOURCE_BUSY',
        'This record is being modified by another request. Please retry.',
      );
    case '57014': // query_canceled (statement_timeout)
    case '57P01': // admin_shutdown
    case '57P03': // cannot_connect_now
    case '53300': // too_many_connections
      return databaseUnavailable();
    default:
      // Class 08 = connection exception.
      return code.startsWith('08') ? databaseUnavailable() : null;
  }
}

const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN']);

function isConnectionFailure(err: unknown): boolean {
  // Duck-typed on purpose: socket errors are created by Node core, and `instanceof Error`
  // is unreliable across realms (e.g. inside Jest's sandbox).
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const { code, message } = err as { code?: unknown; message?: unknown };
  if (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) {
    return true;
  }
  // node-postgres pool messages when no connection could be obtained.
  return (
    typeof message === 'string' &&
    /timeout exceeded when trying to connect|Connection terminated/i.test(message)
  );
}

/** SQLSTATEs after which retrying the whole transaction can succeed. */
export function isRetryableTransactionError(err: unknown): boolean {
  return err instanceof DatabaseError && (err.code === '40001' || err.code === '40P01');
}
