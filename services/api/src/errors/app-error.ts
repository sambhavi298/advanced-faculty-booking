import type { ErrorCode } from '@afb/types';

/**
 * Base class for every error the API deliberately returns to a client.
 *
 * Services and repositories throw these; only the central error handler turns them into HTTP
 * responses, so no controller ever decides a status code for a failure on its own.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The request is invalid.', details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication is required.') {
    super(401, 'UNAUTHENTICATED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(409, code, message, details);
  }
}
