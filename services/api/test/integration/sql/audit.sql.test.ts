import type { Pool, PoolClient } from 'pg';
import { createTestPool } from '../../helpers/database';
import { seededIds, sqlError, TEST_PASSWORD_HASH, withRollback } from '../../helpers/sql';

async function latestAudit(client: PoolClient, table: string) {
  const result = await client.query<{
    action: string;
    record_id: string;
    actor_user_id: number | null;
    actor_role: string | null;
    old_data: Record<string, unknown> | null;
    new_data: Record<string, unknown> | null;
    changed_fields: string[] | null;
  }>(
    `SELECT action, record_id, actor_user_id, actor_role, old_data, new_data, changed_fields
       FROM audit_logs WHERE table_name = $1 ORDER BY id DESC LIMIT 1`,
    [table],
  );
  return result.rows[0];
}

async function actAs(client: PoolClient, userId: number, role: string): Promise<void> {
  await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.user_role', $2, true)", [
    String(userId),
    role,
  ]);
}

describe('Audit logging (triggers)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('records inserts with the acting user and the new row', async () => {
    await withRollback(pool, async (client) => {
      const { rao } = await seededIds(client);
      await actAs(client, rao, 'FACULTY');
      const inserted = await client.query<{ id: number }>(
        "INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time) VALUES ($1, 6, '09:00', '10:00') RETURNING id",
        [rao],
      );

      expect(await latestAudit(client, 'faculty_availability')).toMatchObject({
        action: 'INSERT',
        record_id: String(inserted.rows[0]!.id),
        actor_user_id: rao,
        actor_role: 'FACULTY',
        old_data: null,
        new_data: expect.objectContaining({ day_of_week: 6, start_time: '09:00:00' }) as unknown,
        changed_fields: null,
      });
    });
  });

  it('records updates with old values, new values and exactly which fields changed', async () => {
    await withRollback(pool, async (client) => {
      const { rao, amy } = await seededIds(client);
      await actAs(client, amy, 'ADMIN');
      await client.query(
        "UPDATE faculty SET designation = 'Professor', slot_minutes = 20 WHERE user_id = $1",
        [rao],
      );

      const audit = await latestAudit(client, 'faculty');
      expect(audit).toMatchObject({
        action: 'UPDATE',
        record_id: String(rao),
        actor_user_id: amy,
        actor_role: 'ADMIN',
      });
      expect(audit!.changed_fields).toEqual(['designation', 'slot_minutes']);
      expect(audit!.old_data).toMatchObject({ designation: 'Associate Professor', slot_minutes: 15 });
      expect(audit!.new_data).toMatchObject({ designation: 'Professor', slot_minutes: 20 });
    });
  });

  it('skips updates that change nothing', async () => {
    await withRollback(pool, async (client) => {
      const { rao } = await seededIds(client);
      const before = await client.query<{ n: number }>('SELECT count(*) AS n FROM audit_logs');
      await client.query('UPDATE faculty SET designation = designation WHERE user_id = $1', [rao]);
      const after = await client.query<{ n: number }>('SELECT count(*) AS n FROM audit_logs');
      expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    });
  });

  it('records deletes with the old row, and "system" (NULL actor) outside the API', async () => {
    await withRollback(pool, async (client) => {
      const { rao } = await seededIds(client);
      await client.query('DELETE FROM faculty_availability WHERE faculty_id = $1 AND day_of_week = 5', [rao]);

      expect(await latestAudit(client, 'faculty_availability')).toMatchObject({
        action: 'DELETE',
        actor_user_id: null,
        actor_role: null,
        new_data: null,
        old_data: expect.objectContaining({ day_of_week: 5 }) as unknown,
      });
    });
  });

  it('never copies password hashes into the audit trail, but notes that one changed', async () => {
    await withRollback(pool, async (client) => {
      const { priya } = await seededIds(client);
      await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [priya, TEST_PASSWORD_HASH]);

      const audit = await latestAudit(client, 'users');
      expect(audit!.changed_fields).toEqual(['password_hash']);
      expect(audit!.old_data).not.toHaveProperty('password_hash');
      expect(audit!.new_data).not.toHaveProperty('password_hash');
      const everything = await client.query<{ n: number }>(
        "SELECT count(*) AS n FROM audit_logs WHERE old_data ? 'password_hash' OR new_data ? 'password_hash'",
      );
      expect(everything.rows[0]!.n).toBe(0);
    });
  });

  it('audits the seed itself: one transaction, attributed to "system"', async () => {
    // Every seed insert shares the seed transaction's id (xid8), so the whole seed is one unit in the log.
    const result = await pool.query<{ table_name: string; n: number; actors: number }>(
      `SELECT table_name, count(*) AS n, count(actor_user_id) AS actors
         FROM audit_logs
        WHERE transaction_id = (SELECT transaction_id FROM audit_logs
                                 WHERE table_name = 'users' AND action = 'INSERT' AND new_data->>'login_id' = 'ADMIN001')
        GROUP BY table_name ORDER BY table_name`,
    );
    expect(result.rows).toEqual([
      { table_name: 'batch_schedule', n: 40, actors: 0 },
      { table_name: 'batches', n: 2, actors: 0 },
      { table_name: 'departments', n: 1, actors: 0 },
      { table_name: 'faculty', n: 2, actors: 0 },
      { table_name: 'faculty_availability', n: 10, actors: 0 },
      { table_name: 'students', n: 1, actors: 0 },
      { table_name: 'users', n: 4, actors: 0 },
    ]);
  });

  it.each([
    ['UPDATE', "UPDATE audit_logs SET action = 'DELETE' WHERE id = (SELECT min(id) FROM audit_logs)"],
    ['DELETE', 'DELETE FROM audit_logs WHERE id = (SELECT min(id) FROM audit_logs)'],
    ['TRUNCATE', 'TRUNCATE audit_logs'],
  ])('is append-only: %s is rejected', async (operation, sql) => {
    await withRollback(pool, async (client) => {
      const error = await sqlError(client, sql);
      expect(error.code).toBe('42501');
      expect(error.message).toBe(`audit_logs is append-only: ${operation} is not allowed`);
    });
  });
});
