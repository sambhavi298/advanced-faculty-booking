import type {
  AdminAppointmentPage,
  AdminDashboard,
  AdminDepartment,
  AdminFaculty,
  AdminStudent,
  Appointment,
  AuditPage,
  MonthlyReport,
} from '@afb/types';
import type { Express } from 'express';
import type { Pool } from 'pg';
import request from 'supertest';
import { bearer, bookableSlots, createTestApp, loginAs } from '../../helpers/app';
import { createTestPool } from '../../helpers/database';

/** 'YYYY-MM-DD' of an instant on the campus calendar. */
const campusDate = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));

describe('Admin API over HTTP', () => {
  let pool: Pool;
  let app: Express;
  let admin: string;
  let adminId: number;
  let student: string;
  let studentId: number;
  let rao: string;
  let raoId: number;
  let iyerId: number;
  let slots: string[];

  beforeAll(async () => {
    pool = createTestPool();
    app = createTestApp(pool);
    const [a, s, r, i] = await Promise.all([
      loginAs(app, 'admin'),
      loginAs(app, 'student'),
      loginAs(app, 'rao'),
      loginAs(app, 'iyer'),
    ]);
    [admin, student, rao] = [a.token, s.token, r.token];
    [adminId, studentId, raoId, iyerId] = [a.user.id, s.user.id, r.user.id, i.user.id];
    slots = await bookableSlots(pool, 'FAC200', 'RA221100301001');
  });

  afterEach(async () => {
    await pool.query('DELETE FROM appointments');
    await pool.query('DELETE FROM notifications');
    await pool.query('UPDATE users SET is_active = true WHERE NOT is_active');
  });

  afterAll(async () => {
    await pool.end();
  });

  const get = (path: string, token = admin) =>
    request(app)
      .get(`/api${path}`)
      .set(...bearer(token));

  async function book(startsAt: string): Promise<Appointment> {
    const res = await request(app)
      .post('/api/appointments')
      .set(...bearer(student))
      .send({ facultyId: raoId, startsAt, purpose: 'Discuss the database project schema' });
    expect(res.status).toBe(201);
    return res.body as Appointment;
  }

  it('is closed to students and faculty', async () => {
    for (const token of [student, rao]) {
      for (const path of ['/admin/dashboard', '/admin/students', '/admin/audit', '/admin/reports']) {
        expect((await get(path, token)).status).toBe(403);
      }
      const res = await request(app)
        .patch(`/api/admin/users/${String(studentId)}/status`)
        .set(...bearer(token))
        .send({ isActive: false });
      expect(res.status).toBe(403);
    }
  });

  it('computes the dashboard live from the tables', async () => {
    const first = await book(slots[0]!);
    await book(slots[2]!);
    await request(app)
      .patch(`/api/appointments/${first.id}/approve`)
      .set(...bearer(rao));

    const res = await get('/admin/dashboard');
    expect(res.status).toBe(200);
    const body = res.body as AdminDashboard;
    expect(body.totals).toEqual({
      students: 1,
      faculty: 2,
      departments: 1,
      batches: 2,
      activeUsers: 4,
      appointments: 2,
    });
    expect(body.appointmentsByStatus).toEqual({
      PENDING: 1,
      APPROVED: 1,
      REJECTED: 0,
      CANCELLED: 0,
      COMPLETED: 0,
    });
    expect(body.today.requests).toBe(2);
    expect(body.today.meetings).toBe(
      campusDate(first.startsAt) === campusDate(new Date().toISOString()) ? 1 : 0,
    );
    expect(body.daily).toHaveLength(14);
    expect(body.daily[13]).toEqual({ date: campusDate(new Date().toISOString()), requests: 2 });
    expect(body.daily.slice(0, 13).every((day) => day.requests === 0)).toBe(true);
    expect(body.topFaculty).toEqual([
      {
        rank: 1,
        facultyId: raoId,
        name: 'Prof. K. Rao',
        departmentCode: 'CSE',
        requests: 2,
        pending: 1,
        approvalRatePct: 100,
      },
      {
        rank: 2,
        facultyId: iyerId,
        name: 'Prof. S. Iyer',
        departmentCode: 'CSE',
        requests: 0,
        pending: 0,
        approvalRatePct: null,
      },
    ]);
    expect(body.recentAudit).toHaveLength(8);
    expect(body.recentAudit[0]!.id).toBeGreaterThan(body.recentAudit[7]!.id);
  });

  it('lists and searches students, faculty and departments with their appointment totals', async () => {
    await book(slots[0]!);

    const students = (await get('/admin/students')).body as AdminStudent[];
    expect(students).toEqual([
      expect.objectContaining({
        id: studentId,
        name: 'Priya Sharma',
        registrationNumber: 'RA221100301001',
        batchName: 'Batch 1',
        departmentCode: 'CSE',
        isActive: true,
        appointments: { total: 1, pending: 1, upcoming: 0 },
      }),
    ]);
    expect(typeof students[0]!.lastLoginAt).toBe('string');
    expect((await get('/admin/students?search=')).body).toHaveLength(1); // blank search = no filter

    // Accounts that never signed in show no last-login time.
    await pool.query(`UPDATE users SET last_login_at = NULL WHERE login_id IN ('RA221100301001', 'FAC201')`);
    expect(((await get('/admin/students')).body as AdminStudent[])[0]!.lastLoginAt).toBeNull();
    expect((await get('/admin/students?search=RA2211')).body).toHaveLength(1);
    expect((await get('/admin/students?search=nobody')).body).toEqual([]);
    const batches = await pool.query<{ id: number; name: string }>('SELECT id, name FROM batches');
    const batch2 = batches.rows.find((b) => b.name === 'Batch 2')!.id;
    expect((await get(`/admin/students?batchId=${String(batch2)}`)).body).toEqual([]);
    expect((await get('/admin/students?batchId=x')).status).toBe(400);

    const faculty = (await get('/admin/faculty')).body as AdminFaculty[];
    expect(faculty.map((f) => f.employeeId)).toEqual(['FAC200', 'FAC201']);
    expect(faculty[0]).toMatchObject({
      name: 'Prof. K. Rao',
      departmentName: 'Computer Science and Engineering',
      slotMinutes: 15,
      isActive: true,
      appointments: { total: 1, pending: 1, upcoming: 0 },
    });
    expect(faculty[0]!.weeklyAvailableMinutes).toBeGreaterThan(0);
    expect(faculty[1]!.lastLoginAt).toBeNull();
    expect(((await get('/admin/faculty?search=iyer')).body as AdminFaculty[]).map((f) => f.name)).toEqual([
      'Prof. S. Iyer',
    ]);
    expect((await get('/admin/faculty?search=cse')).body).toHaveLength(2);

    expect((await get('/admin/departments')).body as AdminDepartment[]).toEqual([
      expect.objectContaining({ code: 'CSE', faculty: 2, students: 1, batches: 2, appointments: 1 }),
    ]);
  });

  describe('account status', () => {
    const setStatus = (id: number, body: unknown, token = admin) =>
      request(app)
        .patch(`/api/admin/users/${String(id)}/status`)
        .set(...bearer(token))
        .send(body as object);

    it('deactivates an account at once (its token stops working) and audits who did it', async () => {
      const res = await setStatus(studentId, { isActive: false });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: studentId,
        loginId: 'RA221100301001',
        name: 'Priya Sharma',
        role: 'STUDENT',
        isActive: false,
      });
      expect((await get('/auth/me', student)).status).toBe(401);
      const login = await request(app)
        .post('/api/auth/login')
        .send({ loginId: 'RA221100301001', password: 'Password123!' });
      expect(login.status).toBe(403);

      const audit = (
        await get(`/admin/audit?table=users&action=UPDATE&recordId=${String(studentId)}&limit=1`)
      ).body as AuditPage;
      expect(audit.entries[0]).toMatchObject({
        actor: { id: adminId, name: 'Amy', loginId: 'ADMIN001', role: 'ADMIN' },
        changedFields: ['is_active'],
        oldData: expect.objectContaining({ is_active: true }),
        newData: expect.objectContaining({ is_active: false }),
      });
      expect(audit.entries[0]!.newData).not.toHaveProperty('password_hash');

      expect((await setStatus(studentId, { isActive: true })).body).toMatchObject({ isActive: true });
      expect((await get('/auth/me', student)).status).toBe(200);
    });

    it('refuses to lock the admin out, unknown users and malformed requests', async () => {
      const self = await setStatus(adminId, { isActive: false });
      expect(self.status).toBe(409);
      expect(self.body.error).toMatchObject({
        code: 'CONFLICT',
        message: 'You cannot deactivate your own account.',
      });
      expect((await setStatus(adminId, { isActive: true })).status).toBe(200);
      expect((await setStatus(999999, { isActive: false })).status).toBe(404);
      expect((await setStatus(studentId, { isActive: 'no' })).status).toBe(400);
      expect((await setStatus(0, { isActive: false })).status).toBe(400);
    });
  });

  it('monitors appointments with filters, paging and a total count', async () => {
    const a = await book(slots[0]!);
    const b = await book(slots[2]!);
    const c = await book(slots[4]!);
    await request(app)
      .patch(`/api/appointments/${b.id}/reject`)
      .set(...bearer(rao))
      .send({ reason: 'Clashes with a meeting' });

    const all = (await get('/admin/appointments')).body as AdminAppointmentPage;
    expect(all.total).toBe(3);
    expect(all.appointments.map((x) => x.id)).toEqual([c.id, b.id, a.id]); // latest slot first
    expect(all).toMatchObject({ limit: 25, offset: 0 });

    const page = (await get('/admin/appointments?limit=1&offset=1')).body as AdminAppointmentPage;
    expect(page.appointments.map((x) => x.id)).toEqual([b.id]);
    expect(page.total).toBe(3);

    expect(((await get('/admin/appointments?status=REJECTED')).body as AdminAppointmentPage).total).toBe(1);
    expect(
      ((await get(`/admin/appointments?facultyId=${String(iyerId)}`)).body as AdminAppointmentPage).total,
    ).toBe(0);
    expect(((await get('/admin/appointments?search=priya')).body as AdminAppointmentPage).total).toBe(3);
    expect(((await get('/admin/appointments?search=FAC2')).body as AdminAppointmentPage).total).toBe(3);
    const day = campusDate(a.startsAt);
    const sameDay = [a, b, c].filter((x) => campusDate(x.startsAt) === day).length;
    expect(
      ((await get(`/admin/appointments?from=${day}&to=${day}`)).body as AdminAppointmentPage).total,
    ).toBe(sameDay);
    expect(((await get('/admin/appointments?to=2000-01-01')).body as AdminAppointmentPage).total).toBe(0);
    expect((await get('/admin/appointments?from=2030-02-01&to=2030-01-01')).status).toBe(400);
    expect((await get('/admin/appointments?status=LOST')).status).toBe(400);
  });

  it('pages through the audit trail with a keyset cursor, newest first', async () => {
    await book(slots[0]!);
    const first = (await get('/admin/audit?limit=3')).body as AuditPage;
    expect(first.entries).toHaveLength(3);
    expect(first.nextBefore).toBe(first.entries[2]!.id);
    expect(first.entries[0]).toMatchObject({
      tableName: 'appointments',
      action: 'INSERT',
      actor: { role: 'STUDENT' },
    });

    const second = (await get(`/admin/audit?limit=3&before=${String(first.nextBefore)}`)).body as AuditPage;
    expect(second.entries.every((entry) => entry.id < first.nextBefore!)).toBe(true);

    // The seed was written outside the API, so it has no actor ("system").
    const seed = (await get('/admin/audit?table=departments&action=INSERT')).body as AuditPage;
    expect(seed).toEqual({
      entries: [expect.objectContaining({ actor: null, recordId: expect.any(String) })],
      nextBefore: null,
    });
    expect(
      ((await get(`/admin/audit?actorId=${String(studentId)}&limit=100`)).body as AuditPage).entries.length,
    ).toBeGreaterThan(0);
    expect((await get('/admin/audit?action=TRUNCATE')).status).toBe(400);
    expect((await get('/admin/audit?table=Users;DROP')).status).toBe(400);
  });

  it('serves the monthly report from the materialized view and refreshes it on demand', async () => {
    const booked = await book(slots[0]!);
    const month = campusDate(booked.startsAt).slice(0, 7);

    const refresh = await request(app)
      .post('/api/admin/reports/refresh')
      .set(...bearer(admin));
    expect(refresh.status).toBe(200);
    expect(Date.parse((refresh.body as { refreshedAt: string }).refreshedAt)).not.toBeNaN();

    const report = (await get(`/admin/reports?month=${month}`)).body as MonthlyReport;
    expect(report.refreshedAt).toBe((refresh.body as { refreshedAt: string }).refreshedAt);
    expect(report.rows).toEqual([
      expect.objectContaining({
        facultyId: raoId,
        facultyName: 'Prof. K. Rao',
        departmentCode: 'CSE',
        month: `${month}-01`,
        totalRequests: 1,
        pending: 1,
        demandRankInDepartment: 1,
        cumulativeRequests: 1,
      }),
    ]);
    expect((await get('/admin/reports')).body).toMatchObject({ rows: expect.any(Array) });
    expect((await get('/admin/reports?month=1999-01')).body).toEqual({ rows: [], refreshedAt: null });
    expect((await get('/admin/reports?month=2026-13')).status).toBe(400);

    await pool.query('DELETE FROM appointments');
    await pool.query('SELECT refresh_reports()');
  });
});
