import type { Pool } from 'pg';
import { translateDatabaseError } from '../../../src/errors/database-error';
import { createTestPool } from '../../helpers/database';
import { requestAppointment, seededIds, slot, sqlError, withRollback } from '../../helpers/sql';

const insertSql = 'INSERT INTO appointments (student_id, faculty_id, slot, purpose) VALUES ($1, $2, $3, $4)';
const PURPOSE = 'Discuss the project proposal';

/** Prof. Rao offers 15-minute slots on Monday 10:40-12:25; Priya has no class then. */
const MONDAY_STARTS = [
  ['10:40', '10:55'],
  ['10:55', '11:10'],
  ['11:10', '11:25'],
  ['11:25', '11:40'],
  ['11:40', '11:55'],
] as const;

describe('Weekly request limit (migration 0008)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('refuses a sixth active appointment in the same week', async () => {
    await withRollback(pool, async (client) => {
      const { priya, rao } = await seededIds(client);
      for (const [from, to] of MONDAY_STARTS) {
        await requestAppointment(client, priya, rao, slot('2030-01-07', from, to));
      }

      const error = await sqlError(client, insertSql, [
        priya,
        rao,
        slot('2030-01-07', '11:55', '12:10'),
        PURPOSE,
      ]);
      expect(error.code).toBe('AB009');
      expect(translateDatabaseError(error)).toMatchObject({ status: 409, code: 'BOOKING_LIMIT_REACHED' });
    });
  });

  it('a cancelled appointment frees a place', async () => {
    await withRollback(pool, async (client) => {
      const { priya, rao } = await seededIds(client);
      const ids: string[] = [];
      for (const [from, to] of MONDAY_STARTS) {
        ids.push(await requestAppointment(client, priya, rao, slot('2030-01-07', from, to)));
      }
      await client.query(
        "UPDATE appointments SET status = 'CANCELLED', cancelled_by = student_id WHERE id = $1",
        [ids[0]],
      );

      await expect(
        requestAppointment(client, priya, rao, slot('2030-01-07', '11:55', '12:10')),
      ).resolves.toBeDefined();
    });
  });

  it('the limit is per calendar week, so next week is unaffected', async () => {
    await withRollback(pool, async (client) => {
      const { priya, rao } = await seededIds(client);
      for (const [from, to] of MONDAY_STARTS) {
        await requestAppointment(client, priya, rao, slot('2030-01-07', from, to));
      }

      await expect(
        requestAppointment(client, priya, rao, slot('2030-01-14', '10:40', '10:55')),
      ).resolves.toBeDefined();
    });
  });
});
