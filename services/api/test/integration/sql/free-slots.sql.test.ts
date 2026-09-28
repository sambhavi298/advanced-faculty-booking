import type { Pool, PoolClient } from 'pg';
import { createTestPool } from '../../helpers/database';
import {
  FRI,
  ist,
  MON,
  requestAppointment,
  seededIds,
  setNow,
  slot,
  TUE,
  withRollback,
} from '../../helpers/sql';

/** Local HH:MM start times of the free slots, as strings, for readable assertions. */
async function freeStarts(
  client: PoolClient,
  facultyId: number,
  from: string,
  to: string,
  studentId: number | null = null,
): Promise<string[]> {
  const result = await client.query<{ start: string }>(
    `SELECT to_char(slot_start AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS start
       FROM faculty_free_slots($1, $2, $3, $4)`,
    [facultyId, from, to, studentId],
  );
  return result.rows.map((row) => row.start);
}

describe('faculty_free_slots()', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("cuts the weekly window into the faculty member's slot length", async () => {
    await withRollback(pool, async (client) => {
      const { rao, iyer } = await seededIds(client);

      // Rao: Monday 10:40–12:25 in 15-minute slots (the last one must end by 12:25).
      expect(await freeStarts(client, rao, MON, MON)).toEqual(
        ['10:40', '10:55', '11:10', '11:25', '11:40', '11:55', '12:10'].map((t) => `${MON} ${t}`),
      );
      // Iyer: the same window in 20-minute slots.
      expect(await freeStarts(client, iyer, MON, MON)).toEqual(
        ['10:40', '11:00', '11:20', '11:40', '12:00'].map((t) => `${MON} ${t}`),
      );
    });
  });

  it('returns absolute timestamps with the slot length', async () => {
    await withRollback(pool, async (client) => {
      const { rao } = await seededIds(client);
      const result = await client.query<{ slot_start: Date; slot_end: Date }>(
        'SELECT * FROM faculty_free_slots($1, $2, $2) LIMIT 1',
        [rao, MON],
      );
      expect(result.rows[0]!.slot_start.toISOString()).toBe(new Date(ist(MON, '10:40')).toISOString());
      expect(result.rows[0]!.slot_end.getTime() - result.rows[0]!.slot_start.getTime()).toBe(15 * 60 * 1000);
    });
  });

  it("removes slots during the faculty member's own teaching", async () => {
    await withRollback(pool, async (client) => {
      const { rao } = await seededIds(client);
      // Friday window 13:20–15:05, but Rao teaches Batch 2 from 13:20 to 14:10.
      expect(await freeStarts(client, rao, FRI, FRI)).toEqual(
        ['14:20', '14:35', '14:50'].map((t) => `${FRI} ${t}`),
      );
    });
  });

  it("with a student, removes slots during that student's classes", async () => {
    await withRollback(pool, async (client) => {
      const { iyer, priya } = await seededIds(client);
      // Iyer is free on Tuesday 10:40–12:25 …
      expect(await freeStarts(client, iyer, TUE, TUE)).toHaveLength(5);
      // … but Priya's Batch 1 has Compiler Design and Software Engineering then.
      expect(await freeStarts(client, iyer, TUE, TUE, priya)).toEqual([]);
    });
  });

  it('removes slots overlapping an exception (leave, meeting)', async () => {
    await withRollback(pool, async (client) => {
      const { rao } = await seededIds(client);
      await client.query(
        "INSERT INTO faculty_schedule_exceptions (faculty_id, kind, period) VALUES ($1, 'MEETING', $2)",
        [rao, slot(MON, '11:00', '12:00')],
      );
      expect(await freeStarts(client, rao, MON, MON)).toEqual(['10:40', '12:10'].map((t) => `${MON} ${t}`));
    });
  });

  it('removes slots held by pending or approved appointments, and frees them again on rejection', async () => {
    await withRollback(pool, async (client) => {
      const { rao, priya } = await seededIds(client);
      const id = await requestAppointment(client, priya, rao, slot(MON, '10:55', '11:10'));
      expect(await freeStarts(client, rao, MON, MON)).not.toContain(`${MON} 10:55`);

      await client.query("UPDATE appointments SET status = 'REJECTED' WHERE id = $1", [id]);
      expect(await freeStarts(client, rao, MON, MON)).toContain(`${MON} 10:55`);
    });
  });

  it('with a student, removes times when that student already has an appointment elsewhere', async () => {
    await withRollback(pool, async (client) => {
      const { rao, iyer, priya } = await seededIds(client);
      await requestAppointment(client, priya, iyer, slot(MON, '11:00', '11:20'));
      const forPriya = await freeStarts(client, rao, MON, MON, priya);
      expect(forPriya).not.toContain(`${MON} 10:55`); // 10:55–11:10 overlaps 11:00–11:20
      expect(forPriya).not.toContain(`${MON} 11:10`);
      expect(forPriya).toContain(`${MON} 11:25`);
    });
  });

  it('never offers past slots', async () => {
    await withRollback(pool, async (client) => {
      const { rao } = await seededIds(client);
      await setNow(client, ist(MON, '11:30'));
      expect(await freeStarts(client, rao, MON, MON)).toEqual(
        ['11:40', '11:55', '12:10'].map((t) => `${MON} ${t}`),
      );
    });
  });

  it('clips the date range to the 30-day booking horizon', async () => {
    await withRollback(pool, async (client) => {
      const { rao } = await seededIds(client);
      const result = await client.query<{ last: string; n: number }>(
        `SELECT max(slot_start AT TIME ZONE 'Asia/Kolkata')::date::text AS last, count(*) AS n
           FROM faculty_free_slots($1, '2030-01-01', '2030-12-31')`,
        [rao],
      );
      expect(result.rows[0]!.last <= '2030-02-06').toBe(true);
      expect(result.rows[0]!.n).toBeGreaterThan(0);
    });
  });

  it('offers nothing for an inactive faculty member, an unknown id, or an empty range', async () => {
    await withRollback(pool, async (client) => {
      const { rao } = await seededIds(client);
      expect(await freeStarts(client, rao, TUE, MON)).toEqual([]);
      expect(await freeStarts(client, 999_999, MON, FRI)).toEqual([]);
      await client.query('UPDATE users SET is_active = false WHERE id = $1', [rao]);
      expect(await freeStarts(client, rao, MON, FRI)).toEqual([]);
    });
  });
});
