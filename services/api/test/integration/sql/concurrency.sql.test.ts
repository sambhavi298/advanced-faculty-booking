import { Pool } from 'pg';
import { translateDatabaseError } from '../../../src/errors/database-error';
import { createTestPool, TEST_DATABASE_URL, withIsolatedSchema } from '../../helpers/database';
import { barrier } from '../../helpers/deferred';
import { createStudent, FIXED_NOW, seededIds, slot } from '../../helpers/sql';

/**
 * The project's central claim, demonstrated on real concurrent connections:
 * several students submit the same faculty slot at the same instant.
 */
describe('Concurrent booking of one slot', () => {
  it('a naive "check, then insert" lets every student book the same slot', async () => {
    await withIsolatedSchema(async (pool) => {
      // What a basic DBMS project typically does: no constraint, just a check before the insert.
      await pool.query(
        'CREATE TABLE naive_bookings (faculty_id int NOT NULL, student text NOT NULL, slot tstzrange NOT NULL)',
      );
      const wanted = slot('2030-01-07', '10:40', '10:55');
      const lineUp = barrier(4);

      const book = async (student: string) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const taken = await client.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM naive_bookings WHERE faculty_id = 1 AND slot && $1',
            [wanted],
          );
          await lineUp.arrive(); // everyone has checked; nobody has inserted yet
          if (taken.rows[0]!.n === 0) {
            await client.query('INSERT INTO naive_bookings VALUES (1, $1, $2)', [student, wanted]);
          }
          await client.query('COMMIT');
        } finally {
          client.release();
        }
      };

      await Promise.all(['priya', 'rekha', 'sankalp', 'izhaan'].map(book));

      const rows = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM naive_bookings');
      expect(rows.rows[0]!.n).toBe(4); // double (quadruple) booked
    });
  });

  it('the exclusion constraint admits exactly one of four simultaneous requests', async () => {
    const admin = createTestPool();
    // Four independent connections, like four students' browsers hitting the API at once.
    const connections = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    const extraLogins = ['RA221100309001', 'RA221100309002', 'RA221100309003'];
    try {
      const setup = await admin.connect();
      let ids: Awaited<ReturnType<typeof seededIds>>;
      let students: number[];
      try {
        ids = await seededIds(setup);
        students = [ids.priya];
        for (const login of extraLogins) {
          students.push(await createStudent(setup, login, ids.batch1, `Student ${login.slice(-1)}`));
        }
      } finally {
        setup.release();
      }

      const wanted = slot('2030-01-07', '11:40', '11:55');
      const lineUp = barrier(4);

      const attempt = async (studentId: number) => {
        const client = await connections.connect();
        try {
          await client.query("SELECT set_config('app.now', $1, false)", [FIXED_NOW]);
          await lineUp.arrive();
          const result = await client.query<{ id: string }>(
            "INSERT INTO appointments (student_id, faculty_id, slot, purpose) VALUES ($1, $2, $3, 'Doubt in normalisation') RETURNING id",
            [studentId, ids.rao, wanted],
          );
          return result.rows[0]!.id;
        } finally {
          await client.query('RESET app.now');
          client.release();
        }
      };

      const outcomes = await Promise.allSettled(students.map(attempt));

      const winners = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const losers = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
      );
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(3);
      for (const loser of losers) {
        expect(loser.reason).toMatchObject({ code: '23P01', constraint: 'appointments_no_double_booking' });
        expect(translateDatabaseError(loser.reason)).toMatchObject({ status: 409, code: 'SLOT_CONFLICT' });
      }

      const stored = await admin.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM appointments WHERE faculty_id = $1 AND status = 'PENDING'",
        [ids.rao],
      );
      expect(stored.rows[0]!.n).toBe(1);
    } finally {
      // Remove what this test committed (notifications cascade with the appointments).
      await admin.query(
        `DELETE FROM appointments WHERE student_id IN (SELECT id FROM users WHERE login_id = ANY($1::text[]))
            OR (purpose = 'Doubt in normalisation')`,
        [extraLogins],
      );
      await admin.query('DELETE FROM users WHERE login_id = ANY($1::text[])', [extraLogins]);
      await connections.end();
      await admin.end();
    }
  });
});
