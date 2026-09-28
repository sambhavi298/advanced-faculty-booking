import { translateDatabaseError } from '../../../src/errors/database-error';
import type { Pool } from 'pg';
import {
  APPOINTMENT_STATUSES,
  EXCEPTION_KINDS,
  NOTIFICATION_KINDS,
  USER_ROLES,
} from '../../../src/domain/enums';
import { createTestPool } from '../../helpers/database';
import { seededIds, sqlError, TEST_PASSWORD_HASH, withRollback } from '../../helpers/sql';

describe('Schema: tables, keys and constraints', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('has every table the design requires', async () => {
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([
      'appointments',
      'audit_logs',
      'batch_schedule',
      'batches',
      'departments',
      'faculty',
      'faculty_availability',
      'faculty_schedule_exceptions',
      'notifications',
      'schema_migrations',
      'students',
      'users',
    ]);
  });

  it.each([
    ['user_role', USER_ROLES],
    ['appointment_status', APPOINTMENT_STATUSES],
    ['exception_kind', EXCEPTION_KINDS],
    ['notification_kind', NOTIFICATION_KINDS],
  ])('PostgreSQL enum %s matches the TypeScript list exactly', async (typeName, values) => {
    const result = await pool.query<{ label: string }>(
      `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = $1 ORDER BY e.enumsortorder`,
      [typeName],
    );
    expect(result.rows.map((row) => row.label)).toEqual([...values]);
  });

  describe('users', () => {
    it.each([
      ['STUDENT', 'FAC999'],
      ['FACULTY', 'RA221100301999'],
      ['ADMIN', 'admin001'],
      ['STUDENT', 'RA12'],
    ])('rejects a %s with login id %s', async (role, loginId) => {
      await withRollback(pool, async (client) => {
        const error = await sqlError(
          client,
          'INSERT INTO users (login_id, full_name, role, password_hash) VALUES ($1, $2, $3, $4)',
          [loginId, 'Someone', role, TEST_PASSWORD_HASH],
        );
        expect(error.code).toBe('23514');
        expect(error.constraint).toBe('users_login_id_matches_role');
      });
    });

    it.each(['Password123!', 'sha256:abcdef', `$2b$04$${'x'.repeat(20)}`])(
      'refuses to store "%s" as a password (bcrypt hashes only)',
      async (notAHash) => {
        await withRollback(pool, async (client) => {
          const error = await sqlError(
            client,
            "INSERT INTO users (login_id, full_name, role, password_hash) VALUES ('ADMIN002', 'X', 'ADMIN', $1)",
            [notAHash],
          );
          expect(error.constraint).toBe('users_password_is_bcrypt');
        });
      },
    );

    it('keeps login ids unique', async () => {
      await withRollback(pool, async (client) => {
        const error = await sqlError(
          client,
          "INSERT INTO users (login_id, full_name, role, password_hash) VALUES ('FAC200', 'Copy', 'FACULTY', $1)",
          [TEST_PASSWORD_HASH],
        );
        expect(error.code).toBe('23505');
        expect(error.constraint).toBe('users_login_id_key');
      });
    });

    it('maintains updated_at automatically', async () => {
      await withRollback(pool, async (client) => {
        const { amy } = await seededIds(client);
        const result = await client.query<{ touched: boolean }>(
          "UPDATE users SET full_name = 'Amy A.' WHERE id = $1 RETURNING updated_at = now() AS touched",
          [amy],
        );
        expect(result.rows[0]!.touched).toBe(true);
      });
    });
  });

  describe('role subtypes (composite foreign keys)', () => {
    it('a students row can only belong to a STUDENT user', async () => {
      await withRollback(pool, async (client) => {
        const { rao, batch1 } = await seededIds(client);
        const error = await sqlError(client, 'INSERT INTO students (user_id, batch_id) VALUES ($1, $2)', [
          rao,
          batch1,
        ]);
        expect(error.code).toBe('23503');
        expect(error.constraint).toBe('students_user_fkey');
      });
    });

    it('a faculty row can only belong to a FACULTY user', async () => {
      await withRollback(pool, async (client) => {
        const { priya, cse } = await seededIds(client);
        const error = await sqlError(
          client,
          "INSERT INTO faculty (user_id, department_id, designation, office_location) VALUES ($1, $2, 'X', 'Y')",
          [priya, cse],
        );
        expect(error.constraint).toBe('faculty_user_fkey');
      });
    });

    it("a user's role cannot change while their subtype row exists", async () => {
      await withRollback(pool, async (client) => {
        const { priya } = await seededIds(client);
        const error = await sqlError(
          client,
          "UPDATE users SET role = 'ADMIN', login_id = 'ADMIN777' WHERE id = $1",
          [priya],
        );
        expect(error.code).toBe('23503');
      });
    });

    it('the subtype role column cannot be set to another role', async () => {
      await withRollback(pool, async (client) => {
        const { batch1 } = await seededIds(client);
        const error = await sqlError(
          client,
          "INSERT INTO students (user_id, role, batch_id) VALUES (1, 'FACULTY', $1)",
          [batch1],
        );
        expect(error.constraint).toBe('students_role_is_student');
      });
    });
  });

  describe('departments and batches', () => {
    it.each(['cse', 'C', 'COMPUTERSCIENCE'])('rejects department code %s', async (code) => {
      await withRollback(pool, async (client) => {
        const error = await sqlError(
          client,
          "INSERT INTO departments (code, name) VALUES ($1, 'Something')",
          [code],
        );
        expect(error.constraint).toBe('departments_code_format');
      });
    });

    it.each(['2026-2028', '2026/2027', '26-27'])('rejects academic year %s', async (year) => {
      await withRollback(pool, async (client) => {
        const { cse } = await seededIds(client);
        const error = await sqlError(
          client,
          "INSERT INTO batches (department_id, name, year_of_study, academic_year) VALUES ($1, 'Batch 9', 3, $2)",
          [cse, year],
        );
        expect(error.constraint).toBe('batches_academic_year_format');
      });
    });

    it('a department with batches cannot be deleted', async () => {
      await withRollback(pool, async (client) => {
        const { cse } = await seededIds(client);
        const error = await sqlError(client, 'DELETE FROM departments WHERE id = $1', [cse]);
        expect(error.code).toBe('23001'); // restrict_violation (ON DELETE RESTRICT)
        expect(translateDatabaseError(error)).toMatchObject({ status: 409, code: 'STILL_REFERENCED' });
      });
    });
  });

  describe('faculty', () => {
    it.each([5, 12, 90])('rejects a slot length of %i minutes', async (minutes) => {
      await withRollback(pool, async (client) => {
        const { rao } = await seededIds(client);
        const error = await sqlError(client, 'UPDATE faculty SET slot_minutes = $1 WHERE user_id = $2', [
          minutes,
          rao,
        ]);
        expect(error.constraint).toBe('faculty_slot_minutes_valid');
      });
    });
  });
});
