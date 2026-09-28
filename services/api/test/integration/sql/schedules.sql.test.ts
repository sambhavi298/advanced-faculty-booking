import type { Pool } from 'pg';
import { translateDatabaseError } from '../../../src/errors/database-error';
import { createTestPool } from '../../helpers/database';
import { MON, seededIds, setNow, slot, sqlError, withRollback } from '../../helpers/sql';

describe('Schedules: availability, class timetable, exceptions', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  const addWindow =
    'INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)';

  describe('faculty_availability (PostgreSQL 18 WITHOUT OVERLAPS)', () => {
    it('rejects a window that overlaps an existing one on the same day', async () => {
      await withRollback(pool, async (client) => {
        const { rao } = await seededIds(client);
        // Seed: Monday 10:40–12:25.
        const error = await sqlError(client, addWindow, [rao, 1, '12:00', '13:00']);
        expect(error.code).toBe('23P01');
        expect(error.constraint).toBe('faculty_availability_no_overlap');
      });
    });

    it('accepts back-to-back windows and the same hours on another day', async () => {
      await withRollback(pool, async (client) => {
        const { rao } = await seededIds(client);
        await client.query(addWindow, [rao, 1, '12:25', '13:00']); // starts exactly where the seed window ends
        await client.query(addWindow, [rao, 6, '10:40', '12:25']); // Saturday
        const count = await client.query<{ n: number }>(
          'SELECT count(*) AS n FROM faculty_availability WHERE faculty_id = $1',
          [rao],
        );
        expect(count.rows[0]!.n).toBe(7);
      });
    });

    it('lets two different faculty members use the same hours', async () => {
      await withRollback(pool, async (client) => {
        const { iyer } = await seededIds(client);
        await expect(client.query(addWindow, [iyer, 2, '13:20', '16:00'])).resolves.toBeDefined();
      });
    });

    it('computes duration_minutes as a virtual generated column', async () => {
      const result = await pool.query<{ duration_minutes: number; attgenerated: string }>(
        `SELECT a.duration_minutes,
                (SELECT attgenerated FROM pg_attribute
                  WHERE attrelid = 'faculty_availability'::regclass AND attname = 'duration_minutes') AS attgenerated
           FROM faculty_availability a JOIN users u ON u.id = a.faculty_id
          WHERE u.login_id = 'FAC200' AND a.day_of_week = 1`,
      );
      expect(result.rows[0]).toEqual({ duration_minutes: 105, attgenerated: 'v' });
    });

    it.each([
      ['of zero length', '14:00', '14:00', 'faculty_availability_time_order'],
      ['off the 5-minute grid', '10:02', '11:00', 'faculty_availability_five_minute_grid'],
      ['ending at midnight', '23:00', '24:00', 'faculty_availability_same_day'],
    ])('rejects a window %s', async (_label, start, end, constraint) => {
      await withRollback(pool, async (client) => {
        const { rao } = await seededIds(client);
        const error = await sqlError(client, addWindow, [rao, 7, start, end]);
        expect(error.constraint).toBe(constraint);
      });
    });

    it('rejects a window whose end is before its start (the timerange itself is invalid)', async () => {
      await withRollback(pool, async (client) => {
        const { rao } = await seededIds(client);
        const error = await sqlError(client, addWindow, [rao, 7, '14:00', '13:00']);
        expect(error.code).toBe('22000');
        expect(translateDatabaseError(error)).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
      });
    });

    it('rejects day_of_week outside ISO 1–7', async () => {
      await withRollback(pool, async (client) => {
        const { rao } = await seededIds(client);
        const error = await sqlError(client, addWindow, [rao, 0, '09:00', '10:00']);
        expect(error.constraint).toBe('faculty_availability_day_of_week_iso');
      });
    });
  });

  describe('batch_schedule', () => {
    const addClass = `INSERT INTO batch_schedule (batch_id, faculty_id, course_code, course_title, day_of_week, start_time, end_time)
                      VALUES ($1, $2, 'CS399', 'Seminar', $3, $4, $5)`;

    it('one batch cannot have two overlapping classes', async () => {
      await withRollback(pool, async (client) => {
        const { batch1 } = await seededIds(client);
        // Seed: Batch 1 has Computer Networks Monday 08:00–08:50.
        const error = await sqlError(client, addClass, [batch1, null, 1, '08:30', '09:00']);
        expect(error.code).toBe('23P01');
        expect(error.constraint).toBe('batch_schedule_no_overlap');
      });
    });

    it('different batches may have classes at the same time', async () => {
      await withRollback(pool, async (client) => {
        const { batch2 } = await seededIds(client);
        // Batch 2 is free on Monday 08:50–09:40 while Batch 1 has Compiler Design.
        await expect(client.query(addClass, [batch2, null, 1, '08:50', '09:40'])).resolves.toBeDefined();
      });
    });

    it('stores the class interval as a timerange for overlap queries', async () => {
      const result = await pool.query<{ during: string }>(
        "SELECT during::text FROM batch_schedule WHERE course_code = 'CS301L' ORDER BY day_of_week LIMIT 1",
      );
      expect(result.rows[0]!.during).toBe('[14:15:00,16:00:00)');
    });

    it('rejects unknown session types', async () => {
      await withRollback(pool, async (client) => {
        const { batch1 } = await seededIds(client);
        const error = await sqlError(
          client,
          `INSERT INTO batch_schedule (batch_id, course_code, course_title, session_type, day_of_week, start_time, end_time)
           VALUES ($1, 'X1', 'X', 'WORKSHOP', 6, '09:00', '10:00')`,
          [batch1],
        );
        expect(error.constraint).toBe('batch_schedule_session_type_valid');
      });
    });
  });

  describe('faculty_schedule_exceptions', () => {
    const addException =
      'INSERT INTO faculty_schedule_exceptions (faculty_id, kind, period, reason) VALUES ($1, $2, $3, $4)';

    it('accepts a future half-open period', async () => {
      await withRollback(pool, async (client) => {
        const { rao } = await seededIds(client);
        await expect(
          client.query(addException, [rao, 'MEETING', slot(MON, '15:00', '16:00'), 'BoS']),
        ).resolves.toBeDefined();
      });
    });

    it.each([
      [
        'closed upper bound',
        `[2030-01-07 10:00+05:30,2030-01-07 11:00+05:30]`,
        'faculty_schedule_exceptions_period_valid',
      ],
      ['unbounded', `[2030-01-07 10:00+05:30,)`, 'faculty_schedule_exceptions_period_valid'],
      [
        'longer than 31 days',
        `[2030-01-07 10:00+05:30,2030-03-01 10:00+05:30)`,
        'faculty_schedule_exceptions_max_length',
      ],
    ])('rejects a %s period', async (_label, period, constraint) => {
      await withRollback(pool, async (client) => {
        const { rao } = await seededIds(client);
        const error = await sqlError(client, addException, [rao, 'LEAVE', period, null]);
        expect(error.constraint).toBe(constraint);
      });
    });

    it('rejects a period that has already ended (AB008)', async () => {
      await withRollback(pool, async (client) => {
        const { rao } = await seededIds(client);
        await setNow(client, '2030-01-07T17:00:00+05:30');
        const error = await sqlError(client, addException, [rao, 'LEAVE', slot(MON, '10:00', '11:00'), null]);
        expect(error.code).toBe('AB008');
      });
    });
  });
});
