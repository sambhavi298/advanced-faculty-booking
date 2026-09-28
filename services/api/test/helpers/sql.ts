import bcrypt from 'bcrypt';
import { DatabaseError, type Pool, type PoolClient } from 'pg';

/**
 * Shared vocabulary for SQL-level tests.
 *
 * Tests pin the business clock (app.now) to Monday 7 January 2030, 09:00 IST, and use that week's
 * dates, so results never depend on when the suite runs. Seeded weekly schedules (database/seeds)
 * make these days concrete:
 *   Prof. K. Rao  (15-min slots)  Mon 10:40–12:25 · Fri 13:20–15:05 (teaches Batch 2 13:20–14:10)
 *   Prof. S. Iyer (20-min slots)  Mon 10:40–12:25 · Tue 10:40–12:25 (Priya's Batch 1 has classes then)
 */
export const FIXED_NOW = '2030-01-07T09:00:00+05:30';
export const MON = '2030-01-07';
export const TUE = '2030-01-08';
export const FRI = '2030-01-11';

export function ist(date: string, time: string): string {
  return `${date}T${time}:00+05:30`;
}

/** A half-open tstzrange literal in campus time. */
export function slot(date: string, start: string, end: string): string {
  return `[${ist(date, start)},${ist(date, end)})`;
}

/** Runs `work` in a transaction that is always rolled back, with the business clock pinned. */
export async function withRollback<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
  now: string = FIXED_NOW,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.now', $1, true)", [now]);
    return await work(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/** Re-pins the business clock inside the current transaction. */
export async function setNow(client: PoolClient, now: string): Promise<void> {
  await client.query("SELECT set_config('app.now', $1, true)", [now]);
}

/**
 * Runs a statement expected to fail, inside a savepoint so the surrounding test transaction stays
 * usable, and returns the PostgreSQL error.
 */
export async function sqlError(
  client: PoolClient,
  sql: string,
  values: unknown[] = [],
): Promise<DatabaseError> {
  await client.query('SAVEPOINT expect_error');
  try {
    await client.query(sql, values);
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT expect_error');
    if (err instanceof DatabaseError) {
      return err;
    }
    throw err;
  }
  throw new Error(`Expected statement to fail: ${sql}`);
}

export interface SeededIds {
  priya: number;
  rao: number;
  iyer: number;
  amy: number;
  cse: number;
  batch1: number;
  batch2: number;
}

export async function seededIds(client: PoolClient): Promise<SeededIds> {
  const users = await client.query<{ login_id: string; id: number }>('SELECT login_id, id FROM users');
  const byLogin = new Map(users.rows.map((row) => [row.login_id, row.id]));
  const batches = await client.query<{ name: string; id: number }>('SELECT name, id FROM batches');
  const byBatch = new Map(batches.rows.map((row) => [row.name, row.id]));
  const cse = await client.query<{ id: number }>("SELECT id FROM departments WHERE code = 'CSE'");
  return {
    priya: byLogin.get('RA221100301001')!,
    rao: byLogin.get('FAC200')!,
    iyer: byLogin.get('FAC201')!,
    amy: byLogin.get('ADMIN001')!,
    cse: cse.rows[0]!.id,
    batch1: byBatch.get('Batch 1')!,
    batch2: byBatch.get('Batch 2')!,
  };
}

/** A real bcrypt hash (cost 4) for accounts created inside tests. */
export const TEST_PASSWORD_HASH = bcrypt.hashSync('Password123!', 4);

/** Creates an extra student (only visible inside the calling transaction unless committed). */
export async function createStudent(
  client: PoolClient | Pool,
  loginId: string,
  batchId: number,
  fullName = 'Test Student',
): Promise<number> {
  const user = await client.query<{ id: number }>(
    "INSERT INTO users (login_id, full_name, role, password_hash) VALUES ($1, $2, 'STUDENT', $3) RETURNING id",
    [loginId, fullName, TEST_PASSWORD_HASH],
  );
  const id = user.rows[0]!.id;
  await client.query('INSERT INTO students (user_id, batch_id) VALUES ($1, $2)', [id, batchId]);
  return id;
}

/** Inserts an appointment request and returns its id. */
export async function requestAppointment(
  client: PoolClient | Pool,
  studentId: number,
  facultyId: number,
  range: string,
  purpose = 'Discuss the project proposal',
): Promise<string> {
  const result = await client.query<{ id: string }>(
    'INSERT INTO appointments (student_id, faculty_id, slot, purpose) VALUES ($1, $2, $3, $4) RETURNING id',
    [studentId, facultyId, range, purpose],
  );
  return result.rows[0]!.id;
}
