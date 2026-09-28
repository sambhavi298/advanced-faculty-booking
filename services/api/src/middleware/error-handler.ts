import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '@afb/types';
import { AppError } from '../errors/app-error';
import { translateDatabaseError } from '../errors/database-error';
import { requestIdOf } from './request-logger';

/** Shape of the errors thrown by Express's built-in body parser (`express.json()`). */
interface BodyParserError {
  type: string;
  status: number;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as Partial<BodyParserError>).type === 'string' &&
    typeof (err as Partial<BodyParserError>).status === 'number'
  );
}

/** Normalises anything thrown in the pipeline into an AppError. Unknown errors become a 500. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }
  const databaseError = translateDatabaseError(err);
  if (databaseError !== null) {
    return databaseError;
  }
  if (isBodyParserError(err)) {
    if (err.type === 'entity.parse.failed') {
      return new AppError(400, 'MALFORMED_JSON', 'The request body is not valid JSON.');
    }
    if (err.type === 'entity.too.large') {
      return new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
    }
    if (err.status >= 400 && err.status < 500) {
      return new AppError(400, 'BAD_REQUEST', 'The request could not be processed.');
    }
  }
  return new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}

/**
 * The single place where failures become HTTP responses.
 *
 * - Known errors keep their status/code/message.
 * - Unknown errors are logged with their stack and answered with a generic 500, so SQL, stack traces
 *   and other internals never leak to the client.
 */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    // The response is already streaming; let Express close the connection.
    next(err);
    return;
  }

  const appError = toAppError(err);
  if (appError.status >= 500) {
    req.log.error({ err }, 'Request failed');
  }

  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details === undefined ? {} : { details: appError.details }),
      requestId: requestIdOf(req),
    },
  };
  res.status(appError.status).json(body);
}
