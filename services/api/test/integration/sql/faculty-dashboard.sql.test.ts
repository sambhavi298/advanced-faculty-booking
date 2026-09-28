import type { Pool } from 'pg';
import { AppointmentRepository } from '../../../src/modules/appointments/appointment.repository';
import { FacultyDashboardRepository } from '../../../src/modules/dashboard/faculty-dashboard.repository';
import { createTestPool } from '../../helpers/database';
import {
  createStudent,
  FRI,
  MON,
  requestAppointment,
  seededIds,
  setNow,
  slot,
  withRollback,
} from '../../helpers/sql';

/**
 * The faculty dashboard's queries against a pinned business clock (Monday 7 January 2030, 09:00 IST).
 * Prof. K. Rao is free on Monday 10:40–12:25 and on Friday 14:20–15:05 (the 15-minute grid after his Batch 2 class).
 */
describe('Faculty dashboard queries', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('separates today, pending and upcoming work and computes response statistics and weekly activity', async () => {
    await withRollback(pool, async (client) => {
      const ids = await seededIds(client);
      const other = await createStudent(client, 'RA221100301999', ids.batch1, 'Arjun Mehta');
      const repository = new FacultyDashboardRepository(client, new AppointmentRepository(client));

      const todayApproved = await requestAppointment(client, ids.priya, ids.rao, slot(MON, '10:40', '10:55'));
      const todayPending = await requestAppointment(client, other, ids.rao, slot(MON, '11:10', '11:25'));
      const fridayApproved = await requestAppointment(
        client,
        ids.priya,
        ids.rao,
        slot(FRI, '14:20', '14:35'),
      );
      const fridayRejected = await requestAppointment(client, other, ids.rao, slot(FRI, '14:35', '14:50'));
      await requestAppointment(client, other, ids.iyer, slot(MON, '11:40', '12:00')); // someone else's
      await client.query(`UPDATE appointments SET status = 'APPROVED' WHERE id = ANY($1)`, [
        [todayApproved, fridayApproved],
      ]);
      await client.query(`UPDATE appointments SET status = 'REJECTED' WHERE id = $1`, [fridayRejected]);

      // Lunchtime: the 10:40 meeting is over and recorded as completed; it still belongs to "today".
      await setNow(client, `${MON}T12:00:00+05:30`);
      await client.query(`UPDATE appointments SET status = 'COMPLETED' WHERE id = $1`, [todayApproved]);

      const today = await repository.today(ids.rao);
      expect(today.map((a) => [a.id, a.status])).toEqual([[todayApproved, 'COMPLETED']]);

      const upcoming = await repository.upcoming(ids.rao, 5);
      expect(upcoming.map((a) => a.id)).toEqual([fridayApproved]);
      expect(await repository.upcoming(ids.rao, 0)).toEqual([]);

      const recent = await repository.recent(ids.rao, 2);
      expect(recent).toHaveLength(2);
      expect(recent.every((a) => a.faculty.employeeId === 'FAC200')).toBe(true);

      expect(await repository.counts(ids.rao)).toEqual({
        PENDING: 1,
        APPROVED: 1,
        COMPLETED: 1,
        REJECTED: 1,
        CANCELLED: 0,
        total: 4,
      });

      // Three decisions (two approvals, one rejection), all made the moment they were requested.
      expect(await repository.responseStats(ids.rao)).toEqual({
        responded: 3,
        approvalRatePct: 66.7,
        medianResponseMinutes: 0,
      });

      const weekly = await repository.weekly(ids.rao, 8);
      expect(weekly).toHaveLength(8);
      expect(weekly[0]).toEqual({ weekStart: '2029-11-19', requests: 0, accepted: 0 });
      expect(weekly.slice(1, 7).every((week) => week.requests === 0)).toBe(true);
      expect(weekly[7]).toEqual({ weekStart: '2030-01-07', requests: 4, accepted: 2 });

      // The pending request is not today's schedule, and nothing of Prof. Iyer's leaks in.
      expect(today.some((a) => a.id === todayPending)).toBe(false);
    });
  });

  it('does not count expired requests as responses, and reports no rate before any decision', async () => {
    await withRollback(pool, async (client) => {
      const ids = await seededIds(client);
      const repository = new FacultyDashboardRepository(client, new AppointmentRepository(client));
      expect(await repository.responseStats(ids.rao)).toEqual({
        responded: 0,
        approvalRatePct: null,
        medianResponseMinutes: null,
      });

      // A request that nobody answered: the sweeper rejects it once its time arrives. Its decided_at
      // (the sweep) is after the slot started, so it is not a response.
      await client.query(
        `INSERT INTO appointments (student_id, faculty_id, slot, purpose, created_at)
         VALUES ($1, $2, $3, 'Unanswered request example', now())`,
        [ids.priya, ids.rao, slot(MON, '10:40', '10:55')],
      );
      await setNow(client, `${MON}T10:45:00+05:30`);
      await client.query('SELECT * FROM process_elapsed_appointments()');
      await client.query(
        `UPDATE appointments SET decided_at = lower(slot) + interval '5 minutes' WHERE status = 'REJECTED'`,
      );
      expect((await repository.responseStats(ids.rao)).responded).toBe(0);
    });
  });

  it('returns the faculty profile shown in the header', async () => {
    await withRollback(pool, async (client) => {
      const ids = await seededIds(client);
      const repository = new FacultyDashboardRepository(client, new AppointmentRepository(client));
      expect(await repository.profile(ids.iyer)).toEqual({
        name: 'Prof. S. Iyer',
        employeeId: 'FAC201',
        designation: expect.any(String),
        departmentName: 'Computer Science and Engineering',
        officeLocation: expect.any(String),
        slotMinutes: 20,
      });
    });
  });
});
