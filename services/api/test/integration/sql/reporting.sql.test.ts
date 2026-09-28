import type { Pool } from 'pg';
import { createTestPool } from '../../helpers/database';
import { MON, requestAppointment, seededIds, slot, withRollback } from '../../helpers/sql';

const FEB_MON = '2030-02-04'; // four weeks later, still inside the 30-day horizon

describe('Read models', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('appointment_details joins student, batch, faculty and department', async () => {
    await withRollback(pool, async (client) => {
      const { priya, rao } = await seededIds(client);
      const id = await requestAppointment(client, priya, rao, slot(MON, '10:40', '10:55'));

      const result = await client.query('SELECT * FROM appointment_details WHERE id = $1', [id]);

      expect(result.rows[0]).toMatchObject({
        status: 'PENDING',
        purpose: 'Discuss the project proposal',
        student_name: 'Priya Sharma',
        registration_number: 'RA221100301001',
        batch_name: 'Batch 1',
        faculty_name: 'Prof. K. Rao',
        employee_id: 'FAC200',
        faculty_designation: 'Associate Professor',
        faculty_office: 'Tech Park, 7th Floor, Staff Room 712',
        department_code: 'CSE',
      });
      expect((result.rows[0] as { starts_at: Date }).starts_at.toISOString()).toBe(
        '2030-01-07T05:10:00.000Z',
      );
    });
  });

  it('faculty_monthly_report aggregates per month and ranks with window functions after refresh', async () => {
    await withRollback(pool, async (client) => {
      const { priya, rao, iyer } = await seededIds(client);
      const a = await requestAppointment(client, priya, rao, slot(MON, '10:40', '10:55'));
      const b = await requestAppointment(client, priya, rao, slot(MON, '11:10', '11:25'));
      await requestAppointment(client, priya, iyer, slot(MON, '12:00', '12:20'));
      await requestAppointment(client, priya, rao, slot(FEB_MON, '10:40', '10:55'));
      await client.query("UPDATE appointments SET status = 'APPROVED' WHERE id = $1", [a]);
      await client.query("UPDATE appointments SET status = 'REJECTED' WHERE id = $1", [b]);

      const before = await client.query<{ n: number }>('SELECT count(*) AS n FROM faculty_monthly_report');
      expect(before.rows[0]!.n).toBe(0); // materialized: nothing until refreshed

      const refreshed = await client.query<{ refreshed_at: Date }>(
        'SELECT refresh_reports() AS refreshed_at',
      );
      expect(refreshed.rows[0]!.refreshed_at).toBeInstanceOf(Date);

      const report = await client.query(
        `SELECT faculty_name, month::text, total_requests, pending, approved, rejected, approval_rate_pct,
                demand_rank_in_department, change_from_previous_month, cumulative_requests
           FROM faculty_monthly_report ORDER BY month, demand_rank_in_department`,
      );
      expect(report.rows).toEqual([
        {
          faculty_name: 'Prof. K. Rao',
          month: '2030-01-01',
          total_requests: 2,
          pending: 0,
          approved: 1,
          rejected: 1,
          approval_rate_pct: 50,
          demand_rank_in_department: 1,
          change_from_previous_month: null,
          cumulative_requests: 2,
        },
        {
          faculty_name: 'Prof. S. Iyer',
          month: '2030-01-01',
          total_requests: 1,
          pending: 1,
          approved: 0,
          rejected: 0,
          approval_rate_pct: null,
          demand_rank_in_department: 2,
          change_from_previous_month: null,
          cumulative_requests: 1,
        },
        {
          faculty_name: 'Prof. K. Rao',
          month: '2030-02-01',
          total_requests: 1,
          pending: 1,
          approved: 0,
          rejected: 0,
          approval_rate_pct: null,
          demand_rank_in_department: 1,
          change_from_previous_month: -1,
          cumulative_requests: 3,
        },
      ]);
    });
  });
});
