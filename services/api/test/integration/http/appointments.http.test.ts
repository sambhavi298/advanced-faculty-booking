import type { Appointment, AppointmentList } from '@afb/types';
import type { Express } from 'express';
import type { Pool } from 'pg';
import request from 'supertest';
import { bearer, bookableSlots, createTestApp, loginAs } from '../../helpers/app';
import { createTestPool } from '../../helpers/database';
import { TEST_PASSWORD_HASH } from '../../helpers/sql';

const PURPOSE = 'Discuss the Advanced SQL mini project';

describe('Appointments over HTTP (real database, real clock)', () => {
  let pool: Pool;
  let app: Express;
  let student: string;
  let rao: string;
  let iyer: string;
  let admin: string;
  let slots: string[];

  beforeAll(async () => {
    pool = createTestPool();
    app = createTestApp(pool);
    [student, rao, iyer, admin] = (
      await Promise.all([
        loginAs(app, 'student'),
        loginAs(app, 'rao'),
        loginAs(app, 'iyer'),
        loginAs(app, 'admin'),
      ])
    ).map((session) => session.token) as [string, string, string, string];
    slots = await bookableSlots(pool, 'FAC200', 'RA221100301001');
    expect(slots.length).toBeGreaterThan(3);
  });

  afterEach(async () => {
    await pool.query('DELETE FROM appointments');
  });

  afterAll(async () => {
    await pool.end();
  });

  async function raoId(): Promise<number> {
    return (await pool.query<{ id: number }>("SELECT id FROM users WHERE login_id = 'FAC200'")).rows[0]!.id;
  }

  async function book(token = student, startsAt = slots[0]!): Promise<request.Response> {
    return request(app)
      .post('/api/appointments')
      .set(...bearer(token))
      .send({ facultyId: await raoId(), startsAt, purpose: PURPOSE });
  }

  describe('POST /api/appointments', () => {
    it('creates a PENDING request for a free slot, with the end derived from the slot length', async () => {
      const res = await book();

      expect(res.status).toBe(201);
      const appointment = res.body as Appointment;
      expect(appointment).toMatchObject({
        status: 'PENDING',
        startsAt: slots[0],
        purpose: PURPOSE,
        decisionNote: null,
        cancelledBy: null,
        student: { name: 'Priya Sharma', registrationNumber: 'RA221100301001', batchName: 'Batch 1' },
        faculty: {
          name: 'Prof. K. Rao',
          employeeId: 'FAC200',
          officeLocation: 'Tech Park, 7th Floor, Staff Room 712',
        },
      });
      expect(Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)).toBe(15 * 60_000);
    });

    it('notifies the faculty member and audits the request as the student', async () => {
      const res = await book();
      const id = (res.body as Appointment).id;

      const notification = await pool.query<{ kind: string; body: string }>(
        'SELECT kind, body FROM notifications WHERE appointment_id = $1',
        [id],
      );
      expect(notification.rows[0]).toMatchObject({ kind: 'APPOINTMENT_REQUESTED' });
      expect(notification.rows[0]!.body).toContain('Priya Sharma requested');

      const audit = await pool.query<{ actor_role: string }>(
        "SELECT actor_role FROM audit_logs WHERE table_name = 'appointments' AND record_id = $1 AND action = 'INSERT'",
        [id],
      );
      expect(audit.rows[0]!.actor_role).toBe('STUDENT');
    });

    it('rejects a second request for the same slot with 409 SLOT_CONFLICT', async () => {
      await pool.query(
        "INSERT INTO users (login_id, full_name, role, password_hash) VALUES ('RA221100309101', 'Rekha D', 'STUDENT', $1)",
        [TEST_PASSWORD_HASH],
      );
      await pool.query(
        "INSERT INTO students (user_id, batch_id) SELECT u.id, s.batch_id FROM users u, students s JOIN users p ON p.id = s.user_id WHERE u.login_id = 'RA221100309101' AND p.login_id = 'RA221100301001'",
      );
      try {
        const rekha = (
          await request(app)
            .post('/api/auth/login')
            .send({ loginId: 'RA221100309101', password: 'Password123!' })
        ).body.token as string;
        expect((await book()).status).toBe(201);

        const second = await book(rekha);
        expect(second.status).toBe(409);
        expect(second.body.error).toMatchObject({
          code: 'SLOT_CONFLICT',
          message: 'This slot has just been taken by another request. Please choose a different slot.',
        });
      } finally {
        await pool.query('DELETE FROM appointments');
        await pool.query("DELETE FROM users WHERE login_id = 'RA221100309101'");
      }
    });

    it('explains precisely why a time cannot be booked', async () => {
      const offGrid = new Date(Date.parse(slots[0]!) + 5 * 60_000).toISOString();
      const res = await book(student, offGrid);

      expect(res.status).toBe(409);
      expect(res.body.error).toEqual(
        expect.objectContaining({
          code: 'SLOT_NOT_OFFERED',
          message: "The selected time is not one of Prof. K. Rao's appointment slots.",
        }),
      );
    });

    it('refuses the past', async () => {
      const res = await book(student, '2020-01-06T05:10:00.000Z');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SLOT_IN_PAST');
    });

    it('validates the body field by field', async () => {
      const res = await request(app)
        .post('/api/appointments')
        .set(...bearer(student))
        .send({ facultyId: 'rao', startsAt: 'tomorrow', purpose: 'hi' });

      expect(res.status).toBe(400);
      expect(res.body.error.details.issues.map((issue: { field: string }) => issue.field)).toEqual([
        'facultyId',
        'startsAt',
        'purpose',
      ]);
    });

    it('answers 404 for an unknown faculty member', async () => {
      const res = await request(app)
        .post('/api/appointments')
        .set(...bearer(student))
        .send({ facultyId: 999_999, startsAt: slots[0], purpose: PURPOSE });
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Faculty member not found.');
    });

    it('is for students only', async () => {
      expect((await book(rao)).status).toBe(403);
      expect((await book(admin)).status).toBe(403);
    });
  });

  describe('four students, one slot, same instant (the demo)', () => {
    const logins = ['RA221100309201', 'RA221100309202', 'RA221100309203'];

    afterAll(async () => {
      await pool.query('DELETE FROM appointments');
      await pool.query('DELETE FROM users WHERE login_id = ANY($1::text[])', [logins]);
    });

    it('exactly one request succeeds; the other three get 409 SLOT_CONFLICT', async () => {
      for (const [index, login] of logins.entries()) {
        const user = await pool.query<{ id: number }>(
          "INSERT INTO users (login_id, full_name, role, password_hash) VALUES ($1, $2, 'STUDENT', $3) RETURNING id",
          [login, `Teammate ${String(index + 1)}`, TEST_PASSWORD_HASH],
        );
        await pool.query(
          "INSERT INTO students (user_id, batch_id) SELECT $1, batch_id FROM students s JOIN users u ON u.id = s.user_id WHERE u.login_id = 'RA221100301001'",
          [user.rows[0]!.id],
        );
      }
      const tokens = [student];
      for (const login of logins) {
        tokens.push(
          (await request(app).post('/api/auth/login').send({ loginId: login, password: 'Password123!' })).body
            .token as string,
        );
      }

      const responses = await Promise.all(tokens.map((token) => book(token, slots[1])));

      const statuses = responses.map((res) => res.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409]);
      for (const res of responses.filter((r) => r.status === 409)) {
        expect(res.body.error.code).toBe('SLOT_CONFLICT');
      }
      const held = await pool.query<{ n: number }>(
        "SELECT count(*) AS n FROM appointments WHERE status = 'PENDING' AND lower(slot) = $1",
        [slots[1]],
      );
      expect(held.rows[0]!.n).toBe(1);
    });
  });

  describe('decisions', () => {
    async function pendingId(): Promise<string> {
      return ((await book()).body as Appointment).id;
    }

    it('faculty see their pending requests, soonest first', async () => {
      await book(student, slots[2]);
      await book(student, slots[0]);

      const res = await request(app)
        .get('/api/faculty/pending')
        .set(...bearer(rao));

      expect(res.status).toBe(200);
      expect((res.body as Appointment[]).map((a) => a.startsAt)).toEqual([slots[0], slots[2]]);
      expect(
        (
          await request(app)
            .get('/api/faculty/pending')
            .set(...bearer(iyer))
        ).body,
      ).toEqual([]);
      expect(
        (
          await request(app)
            .get('/api/faculty/pending')
            .set(...bearer(student))
        ).status,
      ).toBe(403);
    });

    it('the faculty member approves with a note; the student is notified', async () => {
      const id = await pendingId();

      const res = await request(app)
        .patch(`/api/appointments/${id}/approve`)
        .set(...bearer(rao))
        .send({ note: 'Bring your ER diagram.' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'APPROVED', decisionNote: 'Bring your ER diagram.' });
      expect(res.body.decidedAt).not.toBeNull();
      const notice = await pool.query<{ kind: string }>(
        'SELECT kind FROM notifications WHERE appointment_id = $1 ORDER BY created_at DESC LIMIT 1',
        [id],
      );
      expect(notice.rows[0]!.kind).toBe('APPOINTMENT_APPROVED');
    });

    it('approving works without a body; a second decision is refused', async () => {
      const id = await pendingId();
      expect(
        (
          await request(app)
            .patch(`/api/appointments/${id}/approve`)
            .set(...bearer(rao))
        ).status,
      ).toBe(200);

      const again = await request(app)
        .patch(`/api/appointments/${id}/reject`)
        .set(...bearer(rao))
        .send({});
      expect(again.status).toBe(409);
      expect(again.body.error).toMatchObject({
        code: 'INVALID_STATUS_TRANSITION',
        message: 'This request has already been approved.',
      });
    });

    it('the faculty member rejects with a reason', async () => {
      const id = await pendingId();
      const res = await request(app)
        .patch(`/api/appointments/${id}/reject`)
        .set(...bearer(rao))
        .send({ reason: '  Please come to the doubt-clearing session instead.  ' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'REJECTED',
        decisionNote: 'Please come to the doubt-clearing session instead.',
      });
    });

    it("another faculty member cannot see or decide someone else's request (404)", async () => {
      const id = await pendingId();
      const res = await request(app)
        .patch(`/api/appointments/${id}/approve`)
        .set(...bearer(iyer));
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Appointment not found.');
    });

    it('students cannot approve or reject', async () => {
      const id = await pendingId();
      expect(
        (
          await request(app)
            .patch(`/api/appointments/${id}/approve`)
            .set(...bearer(student))
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .patch(`/api/appointments/${id}/reject`)
            .set(...bearer(student))
        ).status,
      ).toBe(403);
    });

    it('two simultaneous decisions on one request: the row lock lets exactly one win', async () => {
      const id = await pendingId();

      const [approve, reject] = await Promise.all([
        request(app)
          .patch(`/api/appointments/${id}/approve`)
          .set(...bearer(rao)),
        request(app)
          .patch(`/api/appointments/${id}/reject`)
          .set(...bearer(rao)),
      ]);

      expect([approve.status, reject.status].sort()).toEqual([200, 409]);
    });

    it('validates ids and note length', async () => {
      const bad = await request(app)
        .patch('/api/appointments/not-a-uuid/approve')
        .set(...bearer(rao));
      expect(bad.status).toBe(400);
      expect(bad.body.error.message).toBe('That is not a valid appointment id.');

      const id = await pendingId();
      const long = await request(app)
        .patch(`/api/appointments/${id}/approve`)
        .set(...bearer(rao))
        .send({ note: 'x'.repeat(501) });
      expect(long.status).toBe(400);
    });

    it('unknown appointment ids answer 404', async () => {
      const res = await request(app)
        .patch('/api/appointments/01890000-0000-7000-8000-000000000000/approve')
        .set(...bearer(rao));
      expect(res.status).toBe(404);
    });
  });

  describe('cancellation', () => {
    it('the student cancels their pending request; the faculty member is notified', async () => {
      const id = ((await book()).body as Appointment).id;

      const res = await request(app)
        .patch(`/api/appointments/${id}/cancel`)
        .set(...bearer(student))
        .send({ reason: 'Doubt resolved in class.' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'CANCELLED',
        cancelledBy: 'STUDENT',
        decisionNote: 'Doubt resolved in class.',
      });
      const notice = await pool.query<{ kind: string; user_id: number }>(
        'SELECT kind, user_id FROM notifications WHERE appointment_id = $1 ORDER BY created_at DESC LIMIT 1',
        [id],
      );
      expect(notice.rows[0]).toEqual({ kind: 'APPOINTMENT_CANCELLED', user_id: await raoId() });
    });

    it('the student can also cancel an approved appointment that has not started', async () => {
      const id = ((await book()).body as Appointment).id;
      await request(app)
        .patch(`/api/appointments/${id}/approve`)
        .set(...bearer(rao));

      const res = await request(app)
        .patch(`/api/appointments/${id}/cancel`)
        .set(...bearer(student))
        .send({ reason: '   ' }); // a blank reason counts as no reason
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', decisionNote: null });
    });

    it('a finished decision cannot be cancelled', async () => {
      const id = ((await book()).body as Appointment).id;
      await request(app)
        .patch(`/api/appointments/${id}/reject`)
        .set(...bearer(rao));

      const res = await request(app)
        .patch(`/api/appointments/${id}/cancel`)
        .set(...bearer(student));
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('This appointment is already rejected and cannot be cancelled.');
    });

    it('a started appointment can no longer be cancelled', async () => {
      const id = ((await book()).body as Appointment).id;
      // Move the stored slot into the past without the (immutable-slot) trigger, as time passing would.
      await pool.query('ALTER TABLE appointments DISABLE TRIGGER appointments_guard_update');
      try {
        await pool.query(
          "UPDATE appointments SET slot = tstzrange(now() - interval '5 minutes', now() + interval '10 minutes', '[)') WHERE id = $1",
          [id],
        );
      } finally {
        await pool.query('ALTER TABLE appointments ENABLE TRIGGER appointments_guard_update');
      }
      const res = await request(app)
        .patch(`/api/appointments/${id}/cancel`)
        .set(...bearer(student));
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe(
        'This appointment has already started and can no longer be cancelled.',
      );
    });

    it("a student cannot cancel someone else's appointment, and faculty cannot use this endpoint", async () => {
      const id = ((await book()).body as Appointment).id;
      const other = await pool.query<{ id: number }>(
        "INSERT INTO users (login_id, full_name, role, password_hash) VALUES ('RA221100309301', 'Other', 'STUDENT', $1) RETURNING id",
        [TEST_PASSWORD_HASH],
      );
      await pool.query(
        "INSERT INTO students (user_id, batch_id) SELECT $1, batch_id FROM students s JOIN users u ON u.id = s.user_id WHERE u.login_id = 'RA221100301001'",
        [other.rows[0]!.id],
      );
      try {
        const token = (
          await request(app)
            .post('/api/auth/login')
            .send({ loginId: 'RA221100309301', password: 'Password123!' })
        ).body.token as string;
        expect(
          (
            await request(app)
              .patch(`/api/appointments/${id}/cancel`)
              .set(...bearer(token))
          ).status,
        ).toBe(404);
        expect(
          (
            await request(app)
              .patch(`/api/appointments/${id}/cancel`)
              .set(...bearer(rao))
          ).status,
        ).toBe(403);
      } finally {
        await pool.query("DELETE FROM users WHERE login_id = 'RA221100309301'");
      }
    });
  });

  describe('GET /api/appointments/me', () => {
    it("lists the student's appointments with per-status counts, upcoming first", async () => {
      const first = ((await book(student, slots[0])).body as Appointment).id;
      await book(student, slots[3]);
      await request(app)
        .patch(`/api/appointments/${first}/approve`)
        .set(...bearer(rao));

      const res = await request(app)
        .get('/api/appointments/me')
        .set(...bearer(student));

      expect(res.status).toBe(200);
      const list = res.body as AppointmentList;
      expect(list.appointments.map((a) => a.startsAt)).toEqual([slots[0], slots[3]]);
      expect(list.counts).toEqual({ PENDING: 1, APPROVED: 1, REJECTED: 0, CANCELLED: 0, COMPLETED: 0 });
    });

    it('filters by status without changing the counts', async () => {
      await book(student, slots[0]);
      const res = await request(app)
        .get('/api/appointments/me?status=APPROVED')
        .set(...bearer(student));
      expect(res.body).toEqual({
        appointments: [],
        counts: { PENDING: 1, APPROVED: 0, REJECTED: 0, CANCELLED: 0, COMPLETED: 0 },
      });
    });

    it('gives faculty their own appointments', async () => {
      await book();
      const forRao = (
        await request(app)
          .get('/api/appointments/me')
          .set(...bearer(rao))
      ).body as AppointmentList;
      const forIyer = (
        await request(app)
          .get('/api/appointments/me')
          .set(...bearer(iyer))
      ).body as AppointmentList;
      expect(forRao.appointments).toHaveLength(1);
      expect(forIyer.appointments).toHaveLength(0);
    });

    it('rejects unknown statuses and admins', async () => {
      expect(
        (
          await request(app)
            .get('/api/appointments/me?status=LOST')
            .set(...bearer(student))
        ).status,
      ).toBe(400);
      expect(
        (
          await request(app)
            .get('/api/appointments/me')
            .set(...bearer(admin))
        ).status,
      ).toBe(403);
    });
  });
});
