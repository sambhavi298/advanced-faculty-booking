import type { Pool, PoolClient } from 'pg';
import { translateDatabaseError } from '../../../src/errors/database-error';
import { createTestPool } from '../../helpers/database';
import {
  createStudent,
  FRI,
  ist,
  MON,
  requestAppointment,
  seededIds,
  setNow,
  slot,
  sqlError,
  TUE,
  withRollback,
} from '../../helpers/sql';

const insertSql = 'INSERT INTO appointments (student_id, faculty_id, slot, purpose) VALUES ($1, $2, $3, $4)';
const PURPOSE = 'Discuss the project proposal';

async function statusOf(client: PoolClient, id: string) {
  const result = await client.query<{
    status: string;
    decided_at: Date | null;
    cancelled_at: Date | null;
    completed_at: Date | null;
    decision_note: string | null;
    cancelled_by: number | null;
  }>(
    'SELECT status, decided_at, cancelled_at, completed_at, decision_note, cancelled_by FROM appointments WHERE id = $1',
    [id],
  );
  return result.rows[0]!;
}

async function notificationsFor(client: PoolClient, userId: number) {
  const result = await client.query<{ kind: string; title: string; body: string }>(
    'SELECT kind, title, body FROM notifications WHERE user_id = $1 ORDER BY created_at, id',
    [userId],
  );
  return result.rows;
}

describe('Appointments: booking rules enforced by PostgreSQL', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('requesting a slot (BEFORE INSERT trigger + constraints)', () => {
    it('accepts a free slot as a PENDING request and trims the purpose', async () => {
      await withRollback(pool, async (client) => {
        const { priya, rao } = await seededIds(client);
        const result = await client.query<{ status: string; purpose: string; id: string }>(
          `${insertSql} RETURNING id, status, purpose`,
          [priya, rao, slot(MON, '10:40', '10:55'), `  ${PURPOSE}  `],
        );
        expect(result.rows[0]).toMatchObject({ status: 'PENDING', purpose: PURPOSE });
        // uuidv7: version nibble 7.
        expect(result.rows[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
      });
    });

    it.each([
      ['in the past', slot(MON, '08:00', '08:15'), 'AB001', /future time/],
      ['beyond the 30-day horizon', slot('2030-03-04', '10:40', '10:55'), 'AB007', /at most 30 days/],
      [
        'the wrong length',
        slot(MON, '10:40', '11:00'),
        'AB002',
        /not one of Prof\. K\. Rao's appointment slots/,
      ],
      ['off the slot grid', slot(MON, '10:45', '11:00'), 'AB002', /not one of/],
      ['outside availability', slot(MON, '09:30', '09:45'), 'AB002', /not one of/],
      ['spanning midnight', '[2030-01-07T23:50:00+05:30,2030-01-08T00:05:00+05:30)', 'AB002', /not one of/],
      ['while Rao is teaching', slot(FRI, '13:35', '13:50'), 'AB003', /teaching Computer Networks/],
    ])('rejects a slot %s', async (_label, range, code, message) => {
      await withRollback(pool, async (client) => {
        const { priya, rao } = await seededIds(client);
        const error = await sqlError(client, insertSql, [priya, rao, range, PURPOSE]);
        expect(error.code).toBe(code);
        expect(error.message).toMatch(message);
      });
    });

    it("rejects a slot during the student's own class (AB004)", async () => {
      await withRollback(pool, async (client) => {
        const { priya, iyer } = await seededIds(client);
        const error = await sqlError(client, insertSql, [priya, iyer, slot(TUE, '10:40', '11:00'), PURPOSE]);
        expect(error.code).toBe('AB004');
        expect(error.message).toBe('You have a class (Compiler Design) at this time.');
        expect(translateDatabaseError(error)).toMatchObject({ status: 409, code: 'STUDENT_HAS_CLASS' });
      });
    });

    it('rejects a slot inside a faculty exception (AB003)', async () => {
      await withRollback(pool, async (client) => {
        const { priya, rao } = await seededIds(client);
        await client.query(
          "INSERT INTO faculty_schedule_exceptions (faculty_id, kind, period, reason) VALUES ($1, 'LEAVE', $2, 'Conference')",
          [rao, slot(MON, '00:00', '23:55')],
        );
        const error = await sqlError(client, insertSql, [priya, rao, slot(MON, '10:40', '10:55'), PURPOSE]);
        expect(error.code).toBe('AB003');
        expect(error.message).toBe('Prof. K. Rao is unavailable at this time (leave).');
      });
    });

    it('rejects requests to an inactive faculty member (AB003)', async () => {
      await withRollback(pool, async (client) => {
        const { priya, rao } = await seededIds(client);
        await client.query('UPDATE users SET is_active = false WHERE id = $1', [rao]);
        const error = await sqlError(client, insertSql, [priya, rao, slot(MON, '10:40', '10:55'), PURPOSE]);
        expect(error.message).toBe('Prof. K. Rao is not accepting appointments.');
      });
    });

    it('lets the foreign key reject an unknown faculty member', async () => {
      await withRollback(pool, async (client) => {
        const { priya } = await seededIds(client);
        const error = await sqlError(client, insertSql, [
          priya,
          999_999,
          slot(MON, '10:40', '10:55'),
          PURPOSE,
        ]);
        expect(error.code).toBe('23503');
      });
    });

    it('refuses to create an appointment that is already approved (AB005)', async () => {
      await withRollback(pool, async (client) => {
        const { priya, rao } = await seededIds(client);
        const error = await sqlError(
          client,
          "INSERT INTO appointments (student_id, faculty_id, slot, purpose, status) VALUES ($1, $2, $3, $4, 'APPROVED')",
          [priya, rao, slot(MON, '10:40', '10:55'), PURPOSE],
        );
        expect(error.code).toBe('AB005');
      });
    });

    it.each(['too short', 'x'.repeat(501)])('rejects a purpose that is %s', async (purpose) => {
      await withRollback(pool, async (client) => {
        const { priya, rao } = await seededIds(client);
        const error = await sqlError(client, insertSql, [priya, rao, slot(MON, '10:40', '10:55'), purpose]);
        expect(error.constraint).toBe('appointments_purpose_length');
      });
    });

    it('prevents double booking: a second request for a held slot fails with 23P01', async () => {
      await withRollback(pool, async (client) => {
        const { priya, rao, batch1 } = await seededIds(client);
        // Same batch as Priya, so both are free at the same times.
        const other = await createStudent(client, 'RA221100309999', batch1);
        await requestAppointment(client, priya, rao, slot(MON, '10:40', '10:55'));

        const error = await sqlError(client, insertSql, [other, rao, slot(MON, '10:40', '10:55'), PURPOSE]);
        expect(error.code).toBe('23P01');
        expect(error.constraint).toBe('appointments_no_double_booking');
        expect(translateDatabaseError(error)).toMatchObject({ status: 409, code: 'SLOT_CONFLICT' });
      });
    });

    it('a student cannot hold two overlapping appointments with different faculty', async () => {
      await withRollback(pool, async (client) => {
        const { priya, rao, iyer } = await seededIds(client);
        await requestAppointment(client, priya, rao, slot(MON, '11:10', '11:25'));
        const error = await sqlError(client, insertSql, [priya, iyer, slot(MON, '11:00', '11:20'), PURPOSE]);
        expect(error.constraint).toBe('appointments_student_no_overlap');
        expect(translateDatabaseError(error)).toMatchObject({ code: 'STUDENT_SCHEDULE_CONFLICT' });
      });
    });

    it('a rejected or cancelled request no longer holds the slot', async () => {
      await withRollback(pool, async (client) => {
        const { priya, rao, batch1 } = await seededIds(client);
        // Same batch as Priya, so both are free at the same times.
        const other = await createStudent(client, 'RA221100309999', batch1);
        const first = await requestAppointment(client, priya, rao, slot(MON, '10:40', '10:55'));
        await client.query(
          "UPDATE appointments SET status = 'CANCELLED', cancelled_by = student_id WHERE id = $1",
          [first],
        );

        await expect(
          requestAppointment(client, other, rao, slot(MON, '10:40', '10:55')),
        ).resolves.toBeDefined();
      });
    });
  });

  describe('lifecycle (BEFORE UPDATE trigger)', () => {
    it('approval records decided_at and notifies the student', async () => {
      await withRollback(pool, async (client) => {
        const { priya, rao } = await seededIds(client);
        const id = await requestAppointment(client, priya, rao, slot(MON, '10:40', '10:55'));

        await client.query(
          "UPDATE appointments SET status = 'APPROVED', decision_note = 'Bring your draft.' WHERE id = $1",
          [id],
        );

        expect(await statusOf(client, id)).toMatchObject({
          status: 'APPROVED',
          cancelled_at: null,
          completed_at: null,
        });
        expect((await statusOf(client, id)).decided_at).toBeInstanceOf(Date);
        expect(await notificationsFor(client, rao)).toEqual([
          expect.objectContaining({ kind: 'APPOINTMENT_REQUESTED', title: 'New appointment request' }),
        ]);
        expect(await notificationsFor(client, priya)).toEqual([
          {
            kind: 'APPOINTMENT_APPROVED',
            title: 'Appointment approved',
            body: 'Prof. K. Rao approved your appointment on Mon 07 Jan 2030, 10:40 AM. Note: Bring your draft.',
          },
        ]);
      });
    });

    it('rejection notifies the student with the reason', async () => {
      await withRollback(pool, async (client) => {
        const { priya, rao } = await seededIds(client);
        const id = await requestAppointment(client, priya, rao, slot(MON, '10:40', '10:55'));
        await client.query(
          "UPDATE appointments SET status = 'REJECTED', decision_note = 'Please email instead.' WHERE id = $1",
          [id],
        );

        expect((await statusOf(client, id)).decided_at).toBeInstanceOf(Date);
        expect((await notificationsFor(client, priya))[0]).toMatchObject({
          kind: 'APPOINTMENT_REJECTED',
          body: 'Your request to meet Prof. K. Rao on Mon 07 Jan 2030, 10:40 AM was declined. Note: Please email instead.',
        });
      });
    });

    it('cancellation by the student notifies the faculty member', async () => {
      await withRollback(pool, async (client) => {
        const { priya, rao } = await seededIds(client);
        const id = await requestAppointment(client, priya, rao, slot(MON, '10:40', '10:55'));
        await client.query(
          "UPDATE appointments SET status = 'CANCELLED', cancelled_by = student_id WHERE id = $1",
          [id],
        );

        expect((await statusOf(client, id)).cancelled_at).toBeInstanceOf(Date);
        expect((await notificationsFor(client, rao)).at(-1)).toMatchObject({
          kind: 'APPOINTMENT_CANCELLED',
          body: 'Priya Sharma cancelled the appointment on Mon 07 Jan 2030, 10:40 AM.',
        });
      });
    });

    it('cancellation by the faculty member notifies the student', async () => {
      await withRollback(pool, async (client) => {
        const { priya, rao } = await seededIds(client);
        const id = await requestAppointment(client, priya, rao, slot(MON, '10:40', '10:55'));
        await client.query("UPDATE appointments SET status = 'APPROVED' WHERE id = $1", [id]);
        await client.query(
          "UPDATE appointments SET status = 'CANCELLED', cancelled_by = faculty_id, decision_note = 'Called to a meeting.' WHERE id = $1",
          [id],
        );
        expect((await notificationsFor(client, priya)).at(-1)).toMatchObject({
          kind: 'APPOINTMENT_CANCELLED',
          body: 'Your appointment with Prof. K. Rao on Mon 07 Jan 2030, 10:40 AM was cancelled. Note: Called to a meeting.',
        });
      });
    });

    it.each([
      ['PENDING', 'COMPLETED', /already pending; it cannot be changed to completed/],
      ['REJECTED', 'APPROVED', /already rejected; it cannot be changed to approved/],
      ['CANCELLED', 'PENDING', /already cancelled; it cannot be changed to pending/],
    ])('refuses the illegal transition %s → %s (AB005)', async (from, to, message) => {
      await withRollback(pool, async (client) => {
        const { priya, rao } = await seededIds(client);
        const id = await requestAppointment(client, priya, rao, slot(MON, '10:40', '10:55'));
        if (from !== 'PENDING') {
          await client.query('UPDATE appointments SET status = $2, cancelled_by = student_id WHERE id = $1', [
            id,
            from,
          ]);
        }
        const error = await sqlError(client, 'UPDATE appointments SET status = $2 WHERE id = $1', [id, to]);
        expect(error.code).toBe('AB005');
        expect(error.message).toMatch(message);
        expect(translateDatabaseError(error)).toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
      });
    });

    it('refuses to approve a request whose time has passed', async () => {
      await withRollback(pool, async (client) => {
        const { priya, rao } = await seededIds(client);
        const id = await requestAppointment(client, priya, rao, slot(MON, '10:40', '10:55'));
        await setNow(client, ist(MON, '10:45'));
        const error = await sqlError(client, "UPDATE appointments SET status = 'APPROVED' WHERE id = $1", [
          id,
        ]);
        expect(error.message).toMatch(/can no longer be approved/);
      });
    });

    it('refuses to complete an appointment before it ends', async () => {
      await withRollback(pool, async (client) => {
        const { priya, rao } = await seededIds(client);
        const id = await requestAppointment(client, priya, rao, slot(MON, '10:40', '10:55'));
        await client.query("UPDATE appointments SET status = 'APPROVED' WHERE id = $1", [id]);
        const error = await sqlError(client, "UPDATE appointments SET status = 'COMPLETED' WHERE id = $1", [
          id,
        ]);
        expect(error.message).toMatch(/only be completed after it has ended/);
      });
    });

    it.each([
      ['slot', `slot = '${slot(MON, '10:55', '11:10')}'`],
      ['purpose', "purpose = 'A completely different purpose'"],
      ['student', 'student_id = student_id + 0, faculty_id = faculty_id + 1'],
    ])('the %s of an appointment cannot be changed (AB006)', async (_label, assignment) => {
      await withRollback(pool, async (client) => {
        const { priya, rao } = await seededIds(client);
        const id = await requestAppointment(client, priya, rao, slot(MON, '10:40', '10:55'));
        const error = await sqlError(client, `UPDATE appointments SET ${assignment} WHERE id = $1`, [id]);
        expect(error.code).toBe('AB006');
      });
    });

    it('keeps status timestamps consistent even for direct SQL (CHECK constraints)', async () => {
      await withRollback(pool, async (client) => {
        const { priya, rao } = await seededIds(client);
        const id = await requestAppointment(client, priya, rao, slot(MON, '10:40', '10:55'));
        const error = await sqlError(client, 'UPDATE appointments SET cancelled_at = now() WHERE id = $1', [
          id,
        ]);
        expect(error.code).toBe('23514');
        expect(['appointments_pending_has_no_outcome', 'appointments_cancellation_recorded']).toContain(
          error.constraint,
        );
      });
    });
  });

  describe('exceptions release overlapping appointments', () => {
    it('rejects pending and cancels approved appointments in the period, and tells each student', async () => {
      await withRollback(pool, async (client) => {
        const { priya, rao, batch1 } = await seededIds(client);
        const other = await createStudent(client, 'RA221100309999', batch1, 'Rohan Das');
        const pending = await requestAppointment(client, priya, rao, slot(MON, '10:40', '10:55'));
        const approved = await requestAppointment(client, other, rao, slot(MON, '11:10', '11:25'));
        const untouched = await requestAppointment(client, other, rao, slot(MON, '12:10', '12:25'));
        await client.query("UPDATE appointments SET status = 'APPROVED' WHERE id = $1", [approved]);

        await client.query(
          "INSERT INTO faculty_schedule_exceptions (faculty_id, kind, period, reason) VALUES ($1, 'MEETING', $2, 'Academic council')",
          [rao, slot(MON, '10:30', '11:30')],
        );

        expect(await statusOf(client, pending)).toMatchObject({
          status: 'REJECTED',
          decision_note: 'Faculty unavailable (meeting): Academic council',
          cancelled_by: null,
        });
        expect(await statusOf(client, approved)).toMatchObject({ status: 'CANCELLED', cancelled_by: rao });
        expect(await statusOf(client, untouched)).toMatchObject({ status: 'PENDING' });
        expect((await notificationsFor(client, priya)).at(-1)).toMatchObject({
          kind: 'APPOINTMENT_REJECTED',
        });
        expect((await notificationsFor(client, other)).at(-1)).toMatchObject({
          kind: 'APPOINTMENT_CANCELLED',
          body: expect.stringContaining('Faculty unavailable (meeting): Academic council') as string,
        });
      });
    });

    it('leaves appointments that have already started alone', async () => {
      await withRollback(pool, async (client) => {
        const { priya, rao } = await seededIds(client);
        const id = await requestAppointment(client, priya, rao, slot(MON, '10:40', '10:55'));
        await client.query("UPDATE appointments SET status = 'APPROVED' WHERE id = $1", [id]);
        await setNow(client, ist(MON, '10:45'));
        await client.query(
          "INSERT INTO faculty_schedule_exceptions (faculty_id, kind, period) VALUES ($1, 'BLOCKED', $2)",
          [rao, slot(MON, '10:30', '12:00')],
        );
        expect(await statusOf(client, id)).toMatchObject({ status: 'APPROVED' });
      });
    });
  });

  describe('process_elapsed_appointments()', () => {
    it('completes approved meetings that ended and expires unanswered requests', async () => {
      await withRollback(pool, async (client) => {
        const { priya, rao, iyer } = await seededIds(client);
        const approved = await requestAppointment(client, priya, rao, slot(MON, '10:40', '10:55'));
        const unanswered = await requestAppointment(client, priya, iyer, slot(MON, '11:20', '11:40'));
        const future = await requestAppointment(client, priya, rao, slot(MON, '12:10', '12:25'));
        await client.query("UPDATE appointments SET status = 'APPROVED' WHERE id = $1", [approved]);

        await setNow(client, ist(MON, '11:45'));
        const result = await client.query<{ completed: number; expired: number }>(
          'SELECT * FROM process_elapsed_appointments()',
        );

        expect(result.rows[0]).toEqual({ completed: 1, expired: 1 });
        expect(await statusOf(client, approved)).toMatchObject({ status: 'COMPLETED' });
        expect((await statusOf(client, approved)).completed_at).toBeInstanceOf(Date);
        expect(await statusOf(client, unanswered)).toMatchObject({
          status: 'REJECTED',
          decision_note: 'Expired: the faculty member did not respond before the requested time.',
        });
        expect(await statusOf(client, future)).toMatchObject({ status: 'PENDING' });

        // Running it again is a no-op.
        const again = await client.query<{ completed: number; expired: number }>(
          'SELECT * FROM process_elapsed_appointments()',
        );
        expect(again.rows[0]).toEqual({ completed: 0, expired: 0 });
      });
    });
  });
});
