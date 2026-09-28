import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../../src/errors/app-error';

describe('AppError hierarchy', () => {
  it('carries status, code, message and details', () => {
    const error = new AppError(418, 'BAD_REQUEST', 'short and stout', { spout: true });

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(418);
    expect(error.code).toBe('BAD_REQUEST');
    expect(error.message).toBe('short and stout');
    expect(error.details).toEqual({ spout: true });
    expect(error.name).toBe('AppError');
  });

  it.each([
    [new ValidationError(), 400, 'VALIDATION_ERROR', 'The request is invalid.', 'ValidationError'],
    [
      new UnauthenticatedError(),
      401,
      'UNAUTHENTICATED',
      'Authentication is required.',
      'UnauthenticatedError',
    ],
    [
      new ForbiddenError(),
      403,
      'FORBIDDEN',
      'You do not have permission to perform this action.',
      'ForbiddenError',
    ],
    [new NotFoundError(), 404, 'NOT_FOUND', 'The requested resource was not found.', 'NotFoundError'],
  ])('%p has status %i and code %s by default', (error, status, code, message, name) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
    expect(error.name).toBe(name);
    expect(error.details).toBeUndefined();
  });

  it('accepts custom messages and details', () => {
    expect(new ValidationError('Bad date.', { field: 'date' }).details).toEqual({ field: 'date' });
    expect(new UnauthenticatedError('Token expired.').message).toBe('Token expired.');
    expect(new ForbiddenError('Students only.').message).toBe('Students only.');
    expect(new NotFoundError('No such faculty.').message).toBe('No such faculty.');
  });

  it('builds 409 conflicts with a caller-chosen code', () => {
    const error = new ConflictError('DUPLICATE', 'Already exists.', { constraint: 'x_uq' });

    expect(error.status).toBe(409);
    expect(error.code).toBe('DUPLICATE');
    expect(error.details).toEqual({ constraint: 'x_uq' });
    expect(error.name).toBe('ConflictError');
  });
});
