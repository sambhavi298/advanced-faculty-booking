import type { Appointment, FacultyDashboard, NotificationList, StudentDashboard } from '@afb/types';
import type { Express } from 'express';
import type { Pool } from 'pg';
import request from 'supertest';
import { bearer, bookableSlots, createTestApp, loginAs } from '../../helpers/app';
import { createTestPool } from '../../helpers/database';

describe('Student dashboard and notifications over HTTP', () => {
  let pool: Pool;
  let app: Express;
  let student: string;
  let rao: string;
  let admin: string;
  let raoId: number;
  let slots: string[];

  beforeAll(async () => {
    pool = createTestPool();
    app = createTestApp(pool);
    const sessions = await Promise.all([loginAs(app, 'student'), loginAs(app, 'rao'), loginAs(app, 'admin')]);
    [student, rao, admin] = sessions.map((s) => s.token) as [string, string, string];
    raoId = sessions[1].user.id;
    slots = await bookableSlots(pool, 'FAC200', 'RA221100301001');
  });

  afterEach(async () => {
    await pool.query('DELETE FROM appointments');
    await pool.query('DELETE FROM notifications');
  });

  afterAll(async () => {
    await pool.end();
  });

  async function book(startsAt: string): Promise<Appointment> {
    const res = await request(app)
      .post('/api/appointments')
      .set(...bearer(student))
      .send({ facultyId: raoId, startsAt, purpose: 'Clarify the normalisation assignment' });
    return res.body as Appointment;
  }

  describe('GET /api/student/dashboard', () => {
    it('greets a new student with zero counts and no upcoming appointment', async () => {
      const res = await request(app)
        .get('/api/student/dashboard')
        .set(...bearer(student));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        student: {
          name: 'Priya Sharma',
          registrationNumber: 'RA221100301001',
          batchName: 'Batch 1',
          departmentName: 'Computer Science and Engineering',
        },
        counts: { PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0, COMPLETED: 0, total: 0 },
        upcoming: null,
        recent: [],
      });
    });

    it('shows counts, the next approved appointment and recent activity newest first', async () => {
      const first = await book(slots[0]!);
      const second = await book(slots[2]!);
      const third = await book(slots[4]!);
      await request(app)
        .patch(`/api/appointments/${second.id}/approve`)
        .set(...bearer(rao));
      await request(app)
        .patch(`/api/appointments/${third.id}/reject`)
        .set(...bearer(rao));

      const body = (
        await request(app)
          .get('/api/student/dashboard')
          .set(...bearer(student))
      ).body as StudentDashboard;

      expect(body.counts).toEqual({
        PENDING: 1,
        APPROVED: 1,
        REJECTED: 1,
        CANCELLED: 0,
        COMPLETED: 0,
        total: 3,
      });
      expect(body.upcoming?.id).toBe(second.id);
      expect(body.recent.map((a) => a.id)).toEqual([third.id, second.id, first.id]);
    });

    it('is for students only', async () => {
      expect(
        (
          await request(app)
            .get('/api/student/dashboard')
            .set(...bearer(rao))
        ).status,
      ).toBe(403);
    });
  });

  describe('notifications', () => {
    it('lists the latest notifications with the unread count, and marks them read', async () => {
      const appointment = await book(slots[0]!);
      await request(app)
        .patch(`/api/appointments/${appointment.id}/approve`)
        .set(...bearer(rao));

      const forRao = (
        await request(app)
          .get('/api/notifications')
          .set(...bearer(rao))
      ).body as NotificationList;
      expect(forRao.unread).toBe(1);
      expect(forRao.notifications[0]).toMatchObject({
        kind: 'APPOINTMENT_REQUESTED',
        title: 'New appointment request',
        appointmentId: appointment.id,
        readAt: null,
      });

      const forStudent = (
        await request(app)
          .get('/api/notifications')
          .set(...bearer(student))
      ).body as NotificationList;
      expect(forStudent.notifications.map((n) => n.kind)).toEqual(['APPOINTMENT_APPROVED']);

      const marked = await request(app)
        .post('/api/notifications/read')
        .set(...bearer(student));
      expect(marked.body).toEqual({ marked: 1, unread: 0 });
      const after = (
        await request(app)
          .get('/api/notifications')
          .set(...bearer(student))
      ).body as NotificationList;
      expect(after.unread).toBe(0);
      expect(after.notifications[0]!.readAt).not.toBeNull();
    });

    it('counts all unread notifications even beyond the page size', async () => {
      await book(slots[0]!);
      await book(slots[2]!);
      await book(slots[4]!);

      const page = (
        await request(app)
          .get('/api/notifications?limit=1')
          .set(...bearer(rao))
      ).body as NotificationList;
      expect(page.notifications).toHaveLength(1);
      expect(page.unread).toBe(3);
    });

    it('returns an empty list for someone with no notifications, and validates the limit', async () => {
      expect(
        (
          await request(app)
            .get('/api/notifications')
            .set(...bearer(admin))
        ).body,
      ).toEqual({
        unread: 0,
        notifications: [],
      });
      expect(
        (
          await request(app)
            .get('/api/notifications?limit=0')
            .set(...bearer(admin))
        ).status,
      ).toBe(400);
      expect((await request(app).get('/api/notifications')).status).toBe(401);
    });
  });
  describe('GET /api/faculty/dashboard', () => {
    /** 'YYYY-MM-DD' of an instant on the campus calendar. */
    const campusDate = (iso: string) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));

    it('is for faculty only', async () => {
      for (const token of [student, admin]) {
        const res = await request(app)
          .get('/api/faculty/dashboard')
          .set(...bearer(token));
        expect(res.status).toBe(403);
      }
    });

    it("shows the faculty member's profile, workload and response statistics", async () => {
      const approved = await book(slots[0]!);
      const rejected = await book(slots[2]!);
      const pending = await book(slots[4]!);
      await request(app)
        .patch(`/api/appointments/${approved.id}/approve`)
        .set(...bearer(rao));
      await request(app)
        .patch(`/api/appointments/${rejected.id}/reject`)
        .set(...bearer(rao));

      const res = await request(app)
        .get('/api/faculty/dashboard')
        .set(...bearer(rao));
      expect(res.status).toBe(200);
      const body = res.body as FacultyDashboard;

      expect(body.faculty).toMatchObject({ name: 'Prof. K. Rao', employeeId: 'FAC200', slotMinutes: 15 });
      expect(body.counts).toEqual({
        PENDING: 1,
        APPROVED: 1,
        REJECTED: 1,
        CANCELLED: 0,
        COMPLETED: 0,
        total: 3,
      });
      expect(body.pending.map((a) => a.id)).toEqual([pending.id]);
      // The approved meeting is either today's or upcoming, depending on when the suite runs.
      const isToday = campusDate(approved.startsAt) === campusDate(new Date().toISOString());
      expect(body.today.map((a) => a.id)).toEqual(isToday ? [approved.id] : []);
      expect(body.upcoming.map((a) => a.id)).toEqual(isToday ? [] : [approved.id]);
      expect(body.recent).toHaveLength(3);
      expect(body.stats).toMatchObject({ responded: 2, approvalRatePct: 50 });
      expect(body.stats.medianResponseMinutes).toBeGreaterThanOrEqual(0);
      expect(body.stats.weekly).toHaveLength(8);
      const weekStarts = body.stats.weekly.map((week) => new Date(`${week.weekStart}T00:00:00Z`).getUTCDay());
      expect(new Set(weekStarts)).toEqual(new Set([1])); // every week starts on a Monday
    });
  });
});
