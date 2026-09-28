import { DatabaseError } from 'pg';
import { translateDatabaseError } from '../../../src/errors/database-error';

function pgError(code: string | undefined, fields: Partial<DatabaseError> = {}): DatabaseError {
  const error = new DatabaseError('simulated', 0, 'error');
  error.code = code;
  Object.assign(error, fields);
  return error;
}

describe('translateDatabaseError', () => {
  it('maps an exclusion violation (23P01) to 409 CONFLICT with the constraint name', () => {
    const result = translateDatabaseError(pgError('23P01', { constraint: 'appointments_no_overlap' }));

    expect(result).toMatchObject({
      status: 409,
      code: 'CONFLICT',
      details: { constraint: 'appointments_no_overlap' },
    });
  });

  it('maps a unique violation (23505) to 409 DUPLICATE', () => {
    expect(translateDatabaseError(pgError('23505', { constraint: 'users_login_id_key' }))).toMatchObject({
      status: 409,
      code: 'DUPLICATE',
      details: { constraint: 'users_login_id_key' },
    });
  });

  it('maps a foreign-key violation on insert (23503) to 400 INVALID_REFERENCE', () => {
    const error = pgError('23503', {
      constraint: 'appointments_faculty_id_fkey',
      detail: 'Key (faculty_id)=(999) is not present in table "faculty".',
    });

    expect(translateDatabaseError(error)).toMatchObject({ status: 400, code: 'INVALID_REFERENCE' });
  });

  it('maps a foreign-key violation on delete (23503) to 409 STILL_REFERENCED', () => {
    const error = pgError('23503', {
      constraint: 'students_batch_id_fkey',
      detail: 'Key (id)=(1) is still referenced from table "students".',
    });

    expect(translateDatabaseError(error)).toMatchObject({ status: 409, code: 'STILL_REFERENCED' });
  });

  it('treats a foreign-key violation without detail as an invalid reference', () => {
    expect(translateDatabaseError(pgError('23503'))).toMatchObject({
      status: 400,
      code: 'INVALID_REFERENCE',
    });
  });

  it('maps a check violation (23514) to 400 VALIDATION_ERROR', () => {
    expect(translateDatabaseError(pgError('23514', { constraint: 'slot_positive_length' }))).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: { constraint: 'slot_positive_length' },
    });
  });

  it('maps a not-null violation (23502) to 400 VALIDATION_ERROR naming the column', () => {
    expect(translateDatabaseError(pgError('23502', { column: 'reason' }))).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: { column: 'reason' },
    });
  });

  it.each(['22P02', '22007', '22008', '22003'])(
    'maps data-format error %s to 400 VALIDATION_ERROR',
    (code) => {
      expect(translateDatabaseError(pgError(code))).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    },
  );

  it.each(['40001', '40P01'])('maps concurrency failure %s to 409 TRANSACTION_CONFLICT', (code) => {
    expect(translateDatabaseError(pgError(code))).toMatchObject({
      status: 409,
      code: 'TRANSACTION_CONFLICT',
    });
  });

  it('maps lock_not_available (55P03) to 409 RESOURCE_BUSY', () => {
    expect(translateDatabaseError(pgError('55P03'))).toMatchObject({ status: 409, code: 'RESOURCE_BUSY' });
  });

  it.each(['57014', '57P01', '57P03', '53300', '08006', '08001'])(
    'maps availability failure %s to 503 DATABASE_UNAVAILABLE',
    (code) => {
      expect(translateDatabaseError(pgError(code))).toMatchObject({
        status: 503,
        code: 'DATABASE_UNAVAILABLE',
      });
    },
  );

  it('returns null for database errors it does not recognise', () => {
    expect(translateDatabaseError(pgError('42P01'))).toBeNull();
    expect(translateDatabaseError(pgError(undefined))).toBeNull();
  });

  it.each(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN'])(
    'maps network error %s to 503 DATABASE_UNAVAILABLE',
    (code) => {
      const error = Object.assign(new Error('network'), { code });
      expect(translateDatabaseError(error)).toMatchObject({ status: 503, code: 'DATABASE_UNAVAILABLE' });
    },
  );

  it.each(['timeout exceeded when trying to connect', 'Connection terminated unexpectedly'])(
    'maps node-postgres pool failure "%s" to 503',
    (message) => {
      expect(translateDatabaseError(new Error(message))).toMatchObject({ status: 503 });
    },
  );

  it('recognises connection failures by shape, not by class (cross-realm safe)', () => {
    expect(translateDatabaseError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' })).toMatchObject({
      status: 503,
    });
    expect(translateDatabaseError({ code: 42, message: 42 })).toBeNull();
  });

  it('returns null for ordinary errors and non-errors', () => {
    expect(translateDatabaseError(new Error('boom'))).toBeNull();
    expect(translateDatabaseError(Object.assign(new Error('fs'), { code: 'ENOENT' }))).toBeNull();
    expect(translateDatabaseError('a string')).toBeNull();
    expect(translateDatabaseError(null)).toBeNull();
  });
});
