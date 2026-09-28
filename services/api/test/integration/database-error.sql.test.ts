import type { Pool, PoolClient } from 'pg';
import { translateDatabaseError } from '../../src/errors/database-error';
import { createTestPool, UNREACHABLE_DATABASE_URL } from '../helpers/database';

/**
 * Proves the SQLSTATE → HTTP mapping against errors raised by a real PostgreSQL server,
 * not hand-built error objects. Every table is a TEMP table inside a rolled-back
 * transaction, so nothing persists in the test database.
 */
describe('translateDatabaseError with real PostgreSQL errors', () => {
  let pool: Pool;
  let client: PoolClient;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE parent (id int PRIMARY KEY) ON COMMIT DROP;
      CREATE TEMP TABLE child (
        id        int PRIMARY KEY,
        parent_id int NOT NULL REFERENCES parent (id),
        qty       int NOT NULL CONSTRAINT child_qty_positive CHECK (qty > 0),
        code      text CONSTRAINT child_code_key UNIQUE,
        during    tstzrange,
        CONSTRAINT child_no_overlap EXCLUDE USING gist (during WITH &&)
      ) ON COMMIT DROP;
      INSERT INTO parent VALUES (1);
      INSERT INTO child VALUES (1, 1, 1, 'A', '[2026-09-28 10:00+05:30, 2026-09-28 10:30+05:30)');
    `);
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  /** Runs a statement inside a savepoint and returns the translated error it raised. */
  async function failureOf(sql: string) {
    await client.query('SAVEPOINT attempt');
    try {
      await client.query(sql);
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT attempt');
      return translateDatabaseError(err);
    }
    throw new Error(`Expected statement to fail: ${sql}`);
  }

  it('overlapping time ranges → 409 CONFLICT (exclusion constraint)', async () => {
    await expect(
      failureOf(
        `INSERT INTO child VALUES (2, 1, 1, 'B', '[2026-09-28 10:15+05:30, 2026-09-28 10:45+05:30)')`,
      ),
    ).resolves.toMatchObject({ status: 409, code: 'CONFLICT', details: { constraint: 'child_no_overlap' } });
  });

  it('adjacent (touching) ranges do not conflict', async () => {
    await expect(
      client.query(
        `INSERT INTO child VALUES (3, 1, 1, 'C', '[2026-09-28 10:30+05:30, 2026-09-28 11:00+05:30)')`,
      ),
    ).resolves.toBeDefined();
  });

  it('duplicate unique value → 409 DUPLICATE', async () => {
    await expect(
      failureOf(`INSERT INTO child (id, parent_id, qty, code) VALUES (2, 1, 1, 'A')`),
    ).resolves.toMatchObject({ status: 409, code: 'DUPLICATE', details: { constraint: 'child_code_key' } });
  });

  it('missing parent → 400 INVALID_REFERENCE', async () => {
    await expect(
      failureOf(`INSERT INTO child (id, parent_id, qty) VALUES (2, 99, 1)`),
    ).resolves.toMatchObject({
      status: 400,
      code: 'INVALID_REFERENCE',
    });
  });

  it('deleting a referenced parent → 409 STILL_REFERENCED', async () => {
    await expect(failureOf(`DELETE FROM parent WHERE id = 1`)).resolves.toMatchObject({
      status: 409,
      code: 'STILL_REFERENCED',
    });
  });

  it('check constraint → 400 VALIDATION_ERROR naming the constraint', async () => {
    await expect(failureOf(`INSERT INTO child (id, parent_id, qty) VALUES (2, 1, 0)`)).resolves.toMatchObject(
      {
        status: 400,
        code: 'VALIDATION_ERROR',
        details: { constraint: 'child_qty_positive' },
      },
    );
  });

  it('NULL in a NOT NULL column → 400 VALIDATION_ERROR naming the column', async () => {
    await expect(
      failureOf(`INSERT INTO child (id, parent_id, qty) VALUES (2, 1, NULL)`),
    ).resolves.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: { column: 'qty' },
    });
  });

  it('malformed literal → 400 VALIDATION_ERROR', async () => {
    await expect(failureOf(`SELECT 'not-a-uuid'::uuid`)).resolves.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('statement timeout → 503 DATABASE_UNAVAILABLE', async () => {
    await client.query(`SET LOCAL statement_timeout = '50ms'`);
    await expect(failureOf(`SELECT pg_sleep(1)`)).resolves.toMatchObject({
      status: 503,
      code: 'DATABASE_UNAVAILABLE',
    });
  });

  it('row locked by another transaction with NOWAIT → 409 RESOURCE_BUSY', async () => {
    const other = await pool.connect();
    try {
      await other.query('BEGIN');
      await other.query(`CREATE TEMP TABLE lockme (id int PRIMARY KEY) ON COMMIT DROP`);
      // Temp tables are session-private, so lock a row in a real catalog-backed relation instead:
      // pg_advisory locks are the portable way to simulate a held lock.
      await other.query(`SELECT pg_advisory_xact_lock(424242)`);
      await expect(
        failureOf(`SET LOCAL lock_timeout = '50ms'; SELECT pg_advisory_xact_lock(424242)`),
      ).resolves.toMatchObject({
        status: 409,
        code: 'RESOURCE_BUSY',
      });
    } finally {
      await other.query('ROLLBACK');
      other.release();
    }
  });

  it('unknown SQL errors are left for the generic 500 handler', async () => {
    await expect(failureOf(`SELECT * FROM table_that_does_not_exist`)).resolves.toBeNull();
  });

  it('an unreachable server → 503 DATABASE_UNAVAILABLE', async () => {
    const dead = createTestPool(UNREACHABLE_DATABASE_URL);
    try {
      const error = await dead.query('SELECT 1').catch((err: unknown) => err);
      expect(translateDatabaseError(error)).toMatchObject({ status: 503, code: 'DATABASE_UNAVAILABLE' });
    } finally {
      await dead.end();
    }
  });
});
