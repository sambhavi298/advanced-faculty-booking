import { Pool } from 'pg';
import { withTransaction } from '../../../src/db/transaction';
import { createTestPool, TEST_DATABASE_URL, withIsolatedSchema } from '../../helpers/database';
import { barrier } from '../../helpers/deferred';

class Sentinel extends Error {}

describe('withTransaction against real PostgreSQL', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('commits the work and returns its result', async () => {
    await withIsolatedSchema(async (isolated) => {
      await isolated.query('CREATE TABLE t (v int)');
      const result = await withTransaction(isolated, async (client) => {
        await client.query('INSERT INTO t VALUES (1)');
        return 'done';
      });
      expect(result).toBe('done');
      expect((await isolated.query('SELECT count(*)::int AS n FROM t')).rows[0]).toEqual({ n: 1 });
    });
  });

  it('rolls back everything when the work throws', async () => {
    await withIsolatedSchema(async (isolated) => {
      await isolated.query('CREATE TABLE t (v int)');
      await expect(
        withTransaction(isolated, async (client) => {
          await client.query('INSERT INTO t VALUES (1)');
          throw new Sentinel('abort');
        }),
      ).rejects.toThrow(Sentinel);
      expect((await isolated.query('SELECT count(*)::int AS n FROM t')).rows[0]).toEqual({ n: 0 });
    });
  });

  it('runs at the requested isolation level', async () => {
    const level = await withTransaction(
      pool,
      async (client) =>
        (await client.query<{ transaction_isolation: string }>('SHOW transaction_isolation')).rows[0]!,
      { isolationLevel: 'SERIALIZABLE' },
    );
    expect(level.transaction_isolation).toBe('serializable');
  });

  it('attributes audited changes to the actor', async () => {
    let audit: unknown;
    await expect(
      withTransaction(
        pool,
        async (client) => {
          await client.query("UPDATE faculty SET office_location = 'Tech Park, Room 800' WHERE user_id = 2");
          audit = (
            await client.query(
              "SELECT actor_user_id, actor_role, changed_fields FROM audit_logs WHERE table_name = 'faculty' ORDER BY id DESC LIMIT 1",
            )
          ).rows[0];
          throw new Sentinel('roll back the demo change');
        },
        { actor: { userId: 2, role: 'FACULTY' } },
      ),
    ).rejects.toThrow(Sentinel);
    expect(audit).toEqual({ actor_user_id: 2, actor_role: 'FACULTY', changed_fields: ['office_location'] });
  });

  it('retries a real serialization failure (write skew under SERIALIZABLE) and succeeds', async () => {
    // Classic write-skew: "at least one faculty member must stay on duty". Two transactions each see
    // two on duty and each takes a different one off. SERIALIZABLE detects the conflict, aborts one
    // with SQLSTATE 40001, and withTransaction re-runs it — now it sees one on duty and backs off.
    await withIsolatedSchema(async (isolated, schema) => {
      await isolated.query('CREATE TABLE duty (name text PRIMARY KEY, on_duty boolean NOT NULL)');
      await isolated.query("INSERT INTO duty VALUES ('rao', true), ('iyer', true)");

      const second = new Pool({
        connectionString: TEST_DATABASE_URL,
        max: 2,
        options: `-c search_path=${schema},public`,
      });
      const lineUp = barrier(2);
      const attempts = { rao: 0, iyer: 0 };

      const goOffDuty = (target: Pool, name: 'rao' | 'iyer') =>
        withTransaction(
          target,
          async (client) => {
            attempts[name] += 1;
            const onDuty = await client.query<{ n: number }>(
              'SELECT count(*)::int AS n FROM duty WHERE on_duty',
            );
            if (attempts[name] === 1) {
              await lineUp.arrive(); // both have read before either writes
            }
            if (onDuty.rows[0]!.n >= 2) {
              await client.query('UPDATE duty SET on_duty = false WHERE name = $1', [name]);
            }
          },
          { isolationLevel: 'SERIALIZABLE', retryDelayMs: 5 },
        );

      try {
        await Promise.all([goOffDuty(isolated, 'rao'), goOffDuty(second, 'iyer')]);
      } finally {
        await second.end();
      }

      expect(attempts.rao + attempts.iyer).toBe(3); // exactly one retry
      const stillOn = await isolated.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM duty WHERE on_duty',
      );
      expect(stillOn.rows[0]!.n).toBe(1); // the invariant held
    });
  });
});
