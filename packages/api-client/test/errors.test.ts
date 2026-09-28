import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';
import { ApiError, toApiError } from '../src/errors';

function axiosErrorWith(response?: Partial<AxiosResponse>): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(
    'failed',
    'ERR',
    config,
    undefined,
    response === undefined
      ? undefined
      : ({ config, headers: {}, statusText: '', ...response } as AxiosResponse),
  );
}

describe('toApiError', () => {
  it('passes ApiErrors through', () => {
    const error = new ApiError(409, 'SLOT_CONFLICT', 'Taken.');
    expect(toApiError(error)).toBe(error);
  });

  it('turns the server error envelope into an ApiError', () => {
    const error = toApiError(
      axiosErrorWith({
        status: 409,
        data: {
          error: { code: 'SLOT_CONFLICT', message: 'Taken.', details: { constraint: 'x' }, requestId: 'r1' },
        },
      }),
    );
    expect(error).toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'SLOT_CONFLICT',
      message: 'Taken.',
      details: { constraint: 'x' },
      requestId: 'r1',
    });
  });

  it('reports a missing response as a network error', () => {
    expect(toApiError(axiosErrorWith())).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it.each([
    ['an HTML error page', '<html>Bad gateway</html>'],
    ['JSON without the envelope', { message: 'nope' }],
    ['an envelope missing its message', { error: { code: 'X' } }],
    ['a null error', { error: null }],
    ['no body', null],
  ])('reports %s as an unexpected response', (_label, data) => {
    expect(toApiError(axiosErrorWith({ status: 502, data }))).toMatchObject({
      status: 502,
      code: 'UNEXPECTED_RESPONSE',
      message: 'The server returned an unexpected response (HTTP 502).',
    });
  });

  it('wraps anything else', () => {
    expect(toApiError(new Error('boom'))).toMatchObject({
      status: 0,
      code: 'UNEXPECTED_RESPONSE',
      message: 'boom',
    });
    expect(toApiError('weird')).toMatchObject({ message: 'Something went wrong.' });
  });
});

describe('ApiError.fieldErrors', () => {
  it('maps validation issues by field, keeping the first message per field', () => {
    const error = new ApiError(400, 'VALIDATION_ERROR', 'Enter your login ID.', {
      issues: [
        { field: 'loginId', message: 'Enter your login ID.' },
        { field: 'password', message: 'Enter your password.' },
        { field: 'loginId', message: 'second message' },
      ],
    });
    expect(error.fieldErrors).toEqual({ loginId: 'Enter your login ID.', password: 'Enter your password.' });
  });

  it('is empty when there are no issues', () => {
    expect(new ApiError(500, 'INTERNAL_ERROR', 'x').fieldErrors).toEqual({});
  });
});
