import { DatabaseError, type Pool, type PoolClient } from 'pg';
import { withTransaction } from '../../../src/db/transaction';

function serializationFailure(code = '40001'): DatabaseError {
  const error = new DatabaseError('could not serialize access', 0, 'error');
  error.code = code;
  return error;
}

/** A fake pool whose client records every statement; `failOn` makes chosen statements reject. */
function fakePool(failOn: (sql: string) => Error | undefined = () => undefined) {
  const statements: string[] = [];
  const releases: (boolean | Error | undefined)[] = [];
  const client = {
    query: jest.fn((sql: string) => {
      statements.push(sql);
      const failure = failOn(sql);
      return failure === undefined ? Promise.resolve({ rows: [] }) : Promise.reject(failure);
    }),
    release: jest.fn((arg?: boolean | Error) => releases.push(arg)),
  };
  const pool = {
    connect: jest.fn(() => Promise.resolve(client as unknown as PoolClient)),
  } as unknown as Pool;
  return { pool, statements, releases };
}

describe('withTransaction (unit)', () => {
  it('wraps the work in BEGIN … COMMIT and releases the connection', async () => {
    const { pool, statements, releases } = fakePool();

    await expect(withTransaction(pool, () => Promise.resolve(7))).resolves.toBe(7);

    expect(statements).toEqual(['BEGIN ISOLATION LEVEL READ COMMITTED', 'COMMIT']);
    expect(releases).toEqual([false]);
  });

  it('sets the audit actor as transaction-local settings', async () => {
    const { pool, statements } = fakePool();

    await withTransaction(pool, () => Promise.resolve(), {
      actor: { userId: 1, role: 'STUDENT' },
      isolationLevel: 'REPEATABLE READ',
    });

    expect(statements[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ');
    expect(statements[1]).toMatch(/set_config\('app\.user_id', \$1, true\)/);
  });

  it('retries serialization failures, then gives up after maxRetries', async () => {
    const { pool, statements } = fakePool();
    const work = jest.fn(() => Promise.reject(serializationFailure()));

    await expect(withTransaction(pool, work, { maxRetries: 2, retryDelayMs: 0 })).rejects.toMatchObject({
      code: '40001',
    });

    expect(work).toHaveBeenCalledTimes(3);
    expect(statements.filter((sql) => sql === 'ROLLBACK')).toHaveLength(3);
  });

  it('does not retry other errors', async () => {
    const { pool } = fakePool();
    const work = jest.fn(() => Promise.reject(new Error('validation failed')));

    await expect(withTransaction(pool, work)).rejects.toThrow('validation failed');
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('succeeds on a retry after a transient failure', async () => {
    const { pool } = fakePool();
    const work = jest.fn().mockRejectedValueOnce(serializationFailure()).mockResolvedValueOnce('ok');

    await expect(withTransaction(pool, work, { retryDelayMs: 0 })).resolves.toBe('ok');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('retries deadlocks too, with the default back-off', async () => {
    const { pool } = fakePool();
    const work = jest.fn().mockRejectedValueOnce(serializationFailure('40P01')).mockResolvedValueOnce('ok');

    await expect(withTransaction(pool, work)).resolves.toBe('ok');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('does not retry other PostgreSQL errors', async () => {
    const { pool } = fakePool();
    const work = jest.fn(() => Promise.reject(serializationFailure('23505')));

    await expect(withTransaction(pool, work, { retryDelayMs: 0 })).rejects.toMatchObject({ code: '23505' });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('discards the connection if even ROLLBACK fails', async () => {
    const { pool, releases } = fakePool((sql) =>
      sql === 'ROLLBACK' ? new Error('connection lost') : undefined,
    );

    await expect(withTransaction(pool, () => Promise.reject(new Error('work failed')))).rejects.toThrow(
      'work failed',
    );
    expect(releases).toEqual([true]);
  });
});
