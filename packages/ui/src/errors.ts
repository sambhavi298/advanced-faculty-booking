import { ApiError } from '@afb/api-client';

/** A sentence to show a person for any failure; the server's own message when it has one. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'NETWORK_ERROR') {
      return 'Cannot reach the server. Check your connection and try again.';
    }
    if (error.code === 'INTERNAL_ERROR' || error.code === 'UNEXPECTED_RESPONSE') {
      return 'Something went wrong on our side. Please try again in a moment.';
    }
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
