import type { ApiErrorBody, ErrorCode } from '@afb/types';
import { isAxiosError } from 'axios';

/** Every code an ApiError can carry: the server's codes plus two that only the client can detect. */
export type ApiErrorCode = ErrorCode | 'NETWORK_ERROR' | 'UNEXPECTED_RESPONSE';

/**
 * The single error type every API call rejects with, so pages can branch on `code` (never on text)
 * and always have a human-readable `message` to show.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level messages from a 400 VALIDATION_ERROR, keyed by field name. */
  get fieldErrors(): Record<string, string> {
    const issues =
      (this.details as { issues?: { field: string; message: string }[] } | undefined)?.issues ?? [];
    const result: Record<string, string> = {};
    for (const issue of issues) {
      result[issue.field] ??= issue.message;
    }
    return result;
  }
}

function isErrorBody(data: unknown): data is ApiErrorBody {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const error = (data as { error?: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

/** Converts anything an Axios call can throw into an ApiError. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) {
    return err;
  }
  if (isAxiosError(err)) {
    const response = err.response;
    if (response === undefined) {
      return new ApiError(
        0,
        'NETWORK_ERROR',
        'Could not reach the server. Check your connection and try again.',
      );
    }
    if (isErrorBody(response.data)) {
      const { code, message, details, requestId } = response.data.error;
      return new ApiError(response.status, code, message, details, requestId);
    }
    return new ApiError(
      response.status,
      'UNEXPECTED_RESPONSE',
      `The server returned an unexpected response (HTTP ${String(response.status)}).`,
    );
  }
  return new ApiError(0, 'UNEXPECTED_RESPONSE', err instanceof Error ? err.message : 'Something went wrong.');
}
