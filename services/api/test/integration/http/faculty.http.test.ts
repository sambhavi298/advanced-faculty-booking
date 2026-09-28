import { readFileSync } from 'node:fs';
import type {
  CreateExceptionResponse,
  FacultyAvailability,
  FacultySummary,
  MyAvailability,
  ReplaceAvailabilityResponse,
} from '@afb/types';
import type { Express } from 'express';
import type { Pool } from 'pg';
import request from 'supertest';
import { seedFile } from '../../../src/db/paths';
import { bearer, bookableSlots, createTestApp, loginAs } from '../../helpers/app';
import { createTestPool } from '../../helpers/database';

interface SeedWindow {
  faculty: string;
  dayOfWeek: number;
  start: string;
  end: string;
}

const seededWindows = (JSON.parse(readFileSync(seedFile(), 'utf8')) as { facultyAvailability: SeedWindow[] })
  .facultyAvailability;

describe('Faculty directory and availability over HTTP', () => {
  let pool: Pool;
  let app: Express;
  let student: string;
  let rao: string;
  let iyer: string;
  let admin: string;
  let raoId: number;
  let iyerId: number;

  beforeAll(async () => {
    pool = createTestPool();
    app = createTestApp(pool);
    const sessions = await Promise.all([
      loginAs(app, 'student'),
      loginAs(app, 'rao'),
      loginAs(app, 'iyer'),
      loginAs(app, 'admin'),
    ]);
    [student, rao, iyer, admin] = sessions.map((s) => s.token) as [string, string, string, string];
    raoId = sessions[1].user.id;
    iyerId = sessions[2].user.id;
  });

  afterEach(async () => {
    await pool.query('DELETE FROM appointments');
    await pool.query('DELETE FROM faculty_schedule_exceptions');
  });

  afterAll(async () => {
    await pool.end();
  });

  /** Puts Rao's weekly windows back exactly as seeded. */
  async function restoreRaoWindows(): Promise<void> {
    await pool.query('DELETE FROM faculty_availability WHERE faculty_id = $1', [raoId]);
    for (const w of seededWindows.filter((window) => window.faculty === 'FAC200')) {
      await pool.query(
        'INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)',
        [raoId, w.dayOfWeek, w.start, w.end],
      );
    }
  }

  const list = (token: string, query = '') =>
    request(app)
      .get(`/api/faculty${query}`)
      .set(...bearer(token));

  describe('GET /api/faculty', () => {
    it('lists active faculty with department, weekly hours and the next free slot', async () => {
      const res = await list(student);

      expect(res.status).toBe(200);
      const faculty = res.body as FacultySummary[];
      expect(faculty.map((f) => f.name)).toEqual(['Prof. K. Rao', 'Prof. S. Iyer']);
      expect(faculty[0]).toMatchObject({
        id: raoId,
        employeeId: 'FAC200',
        designation: 'Associate Professor',
        officeLocation: 'Tech Park, 7th Floor, Staff Room 712',
        slotMinutes: 15,
        department: { code: 'CSE', name: 'Computer Science and Engineering' },
        weeklyAvailableMinutes: 580,
      });
      expect(faculty[0]!.nextAvailableSlot).not.toBeNull();
    });

    it("personalises the next free slot to the student's own timetable", async () => {
      const forStudent = (await list(student)).body as FacultySummary[];
      const iyerForStudent = forStudent.find((f) => f.id === iyerId)!;

      expect(iyerForStudent.nextAvailableSlot!.startsAt).toBe(
        (await bookableSlots(pool, 'FAC201', 'RA221100301001'))[0],
      );

      const general = await pool.query<{ slot_start: Date }>(
        `SELECT slot_start FROM faculty_free_slots($1, (now() AT TIME ZONE 'Asia/Kolkata')::date,
                (now() AT TIME ZONE 'Asia/Kolkata')::date + 14) LIMIT 1`,
        [iyerId],
      );
      const forAdmin = (await list(admin)).body as FacultySummary[];
      expect(forAdmin.find((f) => f.id === iyerId)!.nextAvailableSlot!.startsAt).toBe(
        general.rows[0]!.slot_start.toISOString(),
      );
    });

    it.each([
      ['?search=rao', ['Prof. K. Rao']],
      ['?search=IYER', ['Prof. S. Iyer']],
      ['?search=fac20', ['Prof. K. Rao', 'Prof. S. Iyer']],
      ['?search=assistant', ['Prof. S. Iyer']],
      ['?search=%25', []],
      ['?search=   ', ['Prof. K. Rao', 'Prof. S. Iyer']],
      ['?department=cse', ['Prof. K. Rao', 'Prof. S. Iyer']],
      ['?department=ECE', []],
    ])('filters with %s', async (query, names) => {
      const res = await list(student, query);
      expect(res.status).toBe(200);
      expect((res.body as FacultySummary[]).map((f) => f.name)).toEqual(names);
    });

    it('ranks search results by similarity to the name', async () => {
      const res = await list(student, '?search=prof');
      expect((res.body as FacultySummary[]).length).toBe(2);
    });

    it('rejects malformed filters', async () => {
      expect((await list(student, '?department=C1')).status).toBe(400);
      expect((await list(student, `?search=${'x'.repeat(61)}`)).status).toBe(400);
    });

    it('omits deactivated faculty', async () => {
      await pool.query("UPDATE users SET is_active = false WHERE login_id = 'FAC201'");
      try {
        expect(((await list(student)).body as FacultySummary[]).map((f) => f.name)).toEqual(['Prof. K. Rao']);
      } finally {
        await pool.query("UPDATE users SET is_active = true WHERE login_id = 'FAC201'");
      }
    });
  });

  describe('GET /api/faculty/:id/availability', () => {
    const availability = (token: string, id: number, query = '') =>
      request(app)
        .get(`/api/faculty/${String(id)}/availability${query}`)
        .set(...bearer(token));

    it('returns 14 days of personalised free slots plus the weekly and teaching timetables', async () => {
      const res = await availability(student, raoId);

      expect(res.status).toBe(200);
      const body = res.body as FacultyAvailability;
      expect(body.faculty.name).toBe('Prof. K. Rao');
      expect(body.days).toHaveLength(14);
      expect(body.days[0]!.date).toBe(body.from);
      expect(body.days[13]!.date).toBe(body.to);

      const offered = body.days.flatMap((day) => day.slots.map((s) => s.startsAt));
      const bookable = (await bookableSlots(pool, 'FAC200', 'RA221100301001')).filter(
        (s) => s <= offered.at(-1)!,
      );
      expect(offered).toEqual(bookable);
      for (const day of body.days) {
        for (const s of day.slots) {
          expect(Date.parse(s.endsAt) - Date.parse(s.startsAt)).toBe(15 * 60_000);
        }
      }

      expect(
        body.weeklyAvailability.map((w) => [w.dayOfWeek, w.startTime, w.endTime, w.durationMinutes]),
      ).toEqual([
        [1, '10:40', '12:25', 105],
        [2, '13:20', '16:00', 160],
        [3, '14:15', '16:00', 105],
        [4, '10:40', '12:25', 105],
        [5, '13:20', '15:05', 105],
      ]);
      expect(body.teaching).toHaveLength(8);
      expect(body.teaching[0]).toEqual({
        dayOfWeek: 1,
        startTime: '08:00',
        endTime: '08:50',
        courseCode: 'CS301',
        courseTitle: 'Computer Networks',
        sessionType: 'LECTURE',
        batchName: 'Batch 1',
        room: 'TP 401',
      });
    });

    it('accepts an explicit date range', async () => {
      const today = (await pool.query<{ d: string }>("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d"))
        .rows[0]!.d;
      const end = (
        await pool.query<{ d: string }>("SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date + 2) AS d")
      ).rows[0]!.d;
      const body = (await availability(admin, iyerId, `?from=${today}&to=${end}`))
        .body as FacultyAvailability;
      expect(body.days.map((d) => d.date)).toEqual([today, expect.any(String) as string, end]);
    });

    it.each([
      ['?from=2030-01-10&to=2030-01-01', 'The end date must not be before the start date.'],
      ['?from=2030-01-01&to=2030-03-01', 'Choose a range of at most 31 days.'],
      ['?from=01-10-2030', 'Use a date such as 2026-10-05.'],
    ])('rejects the range %s', async (query, message) => {
      const res = await availability(student, raoId, query);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe(message);
    });

    it('answers 404 for an unknown faculty member and 400 for a malformed id', async () => {
      expect((await availability(student, 999_999)).status).toBe(404);
      expect(
        (
          await request(app)
            .get('/api/faculty/abc/availability')
            .set(...bearer(student))
        ).status,
      ).toBe(400);
    });
  });

  describe("faculty member's own availability", () => {
    const put = (token: string, body: object) =>
      request(app)
        .put('/api/faculty/availability')
        .set(...bearer(token))
        .send(body);

    it('GET returns slot length, weekly windows and upcoming exceptions', async () => {
      const res = await request(app)
        .get('/api/faculty/availability')
        .set(...bearer(iyer));
      expect(res.status).toBe(200);
      const body = res.body as MyAvailability;
      expect(body.slotMinutes).toBe(20);
      expect(body.windows).toHaveLength(5);
      expect(body.exceptions).toEqual([]);
      expect(
        (
          await request(app)
            .get('/api/faculty/availability')
            .set(...bearer(student))
        ).status,
      ).toBe(403);
    });

    it('PUT replaces the weekly set, changing only what differs, audited as the faculty member', async () => {
      try {
        const res = await put(rao, {
          windows: [
            { dayOfWeek: 1, startTime: '10:40', endTime: '12:25' }, // unchanged
            { dayOfWeek: 2, startTime: '14:00', endTime: '16:00' }, // changed
            { dayOfWeek: 3, startTime: '14:15', endTime: '16:00' }, // unchanged
            { dayOfWeek: 4, startTime: '10:40', endTime: '12:25' }, // unchanged
            { dayOfWeek: 6, startTime: '09:00', endTime: '10:00' }, // new (Friday removed)
          ],
        });

        expect(res.status).toBe(200);
        const body = res.body as ReplaceAvailabilityResponse;
        expect({ added: body.added, removed: body.removed }).toEqual({ added: 2, removed: 2 });
        expect(body.windows.map((w) => `${String(w.dayOfWeek)} ${w.startTime}-${w.endTime}`)).toEqual([
          '1 10:40-12:25',
          '2 14:00-16:00',
          '3 14:15-16:00',
          '4 10:40-12:25',
          '6 09:00-10:00',
        ]);

        const audit = await pool.query<{ action: string; n: number }>(
          `SELECT action, count(*) AS n FROM audit_logs
            WHERE table_name = 'faculty_availability' AND actor_user_id = $1
              AND occurred_at > now() - interval '1 minute'
            GROUP BY action ORDER BY action`,
          [raoId],
        );
        expect(audit.rows).toEqual([
          { action: 'DELETE', n: 2 },
          { action: 'INSERT', n: 2 },
        ]);

        // Sending the same set again changes nothing.
        const again = (await put(rao, { windows: body.windows })).body as ReplaceAvailabilityResponse;
        expect({ added: again.added, removed: again.removed }).toEqual({ added: 0, removed: 0 });
      } finally {
        await restoreRaoWindows();
      }
    });

    it('PUT with an empty list clears the weekly availability (no slots offered)', async () => {
      try {
        const res = await put(rao, { windows: [] });
        expect((res.body as ReplaceAvailabilityResponse).windows).toEqual([]);
        const offered = (
          (
            await request(app)
              .get(`/api/faculty/${String(raoId)}/availability`)
              .set(...bearer(student))
          ).body as FacultyAvailability
        ).days.flatMap((d) => d.slots);
        expect(offered).toEqual([]);
      } finally {
        await restoreRaoWindows();
      }
    });

    it.each([
      [
        'overlapping windows',
        [
          { dayOfWeek: 1, startTime: '10:00', endTime: '11:00' },
          { dayOfWeek: 1, startTime: '10:30', endTime: '12:00' },
        ],
        'Windows on Monday overlap (10:00–11:00 and 10:30–12:00).',
      ],
      [
        'an end before the start',
        [{ dayOfWeek: 2, startTime: '11:00', endTime: '10:00' }],
        'The end time must be after the start time.',
      ],
      [
        'off-grid times',
        [{ dayOfWeek: 2, startTime: '10:02', endTime: '11:00' }],
        'Times must be on a 5-minute boundary (e.g. 14:05, 14:10).',
      ],
      [
        'a bad day',
        [{ dayOfWeek: 8, startTime: '09:00', endTime: '10:00' }],
        'Day must be 1 (Monday) to 7 (Sunday).',
      ],
      [
        'a bad time',
        [{ dayOfWeek: 1, startTime: '9am', endTime: '10:00' }],
        'Use a 24-hour time such as 14:30.',
      ],
    ])('PUT rejects %s with a clear message', async (_label, windows, message) => {
      const res = await put(rao, { windows });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe(message);
    });

    it('PUT requires the list and is for faculty only', async () => {
      expect((await put(rao, {})).status).toBe(400);
      expect((await put(student, { windows: [] })).status).toBe(403);
    });
  });

  describe('exceptions (leave, meetings, blocked time)', () => {
    const post = (token: string, body: object) =>
      request(app)
        .post('/api/faculty/availability/exceptions')
        .set(...bearer(token))
        .send(body);

    it('records leave, releases the appointments inside it, and stops offering those slots', async () => {
      const [first] = await bookableSlots(pool, 'FAC200', 'RA221100301001');
      const booked = await request(app)
        .post('/api/appointments')
        .set(...bearer(student))
        .send({ facultyId: raoId, startsAt: first, purpose: 'Doubt about the lab record' });
      expect(booked.status).toBe(201);

      const startsAt = new Date(Date.parse(first!) - 30 * 60_000).toISOString();
      const endsAt = new Date(Date.parse(first!) + 60 * 60_000).toISOString();
      const res = await post(rao, { kind: 'MEETING', startsAt, endsAt, reason: 'Board of Studies' });

      expect(res.status).toBe(201);
      const body = res.body as CreateExceptionResponse;
      expect(body.releasedAppointments).toBe(1);
      expect(body.exception).toMatchObject({ kind: 'MEETING', startsAt, endsAt, reason: 'Board of Studies' });

      const appointment = await pool.query<{ status: string; decision_note: string }>(
        'SELECT status, decision_note FROM appointments WHERE id = $1',
        [(booked.body as { id: string }).id],
      );
      expect(appointment.rows[0]).toEqual({
        status: 'REJECTED',
        decision_note: 'Faculty unavailable (meeting): Board of Studies',
      });

      const mine = (
        await request(app)
          .get('/api/faculty/availability')
          .set(...bearer(rao))
      ).body as MyAvailability;
      expect(mine.exceptions.map((e) => e.id)).toEqual([body.exception.id]);
      expect(await bookableSlots(pool, 'FAC200', 'RA221100301001')).not.toContain(first);
    });

    it.each([
      [
        { kind: 'LEAVE', startsAt: '2030-01-07T10:00:00Z', endsAt: '2030-01-07T09:00:00Z' },
        'The end must be after the start.',
      ],
      [
        { kind: 'LEAVE', startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-03-01T00:00:00Z' },
        'An exception can last at most 31 days.',
      ],
      [
        { kind: 'HOLIDAY', startsAt: '2030-01-07T10:00:00Z', endsAt: '2030-01-07T11:00:00Z' },
        'Choose leave, meeting or blocked.',
      ],
      [{ kind: 'LEAVE', startsAt: 'monday', endsAt: '2030-01-07T11:00:00Z' }, 'Choose when it starts.'],
    ])('rejects invalid input %#', async (body, message) => {
      const res = await post(rao, body);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe(message);
    });

    it('rejects a period that is already over (checked by PostgreSQL)', async () => {
      const res = await post(rao, {
        kind: 'LEAVE',
        startsAt: '2020-01-01T00:00:00Z',
        endsAt: '2020-01-02T00:00:00Z',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'PERIOD_ALREADY_ENDED',
        message: 'This period has already ended.',
      });
    });

    it('deletes only your own exceptions', async () => {
      const startsAt = new Date(Date.now() + 86_400_000).toISOString();
      const endsAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
      const created = (await post(rao, { kind: 'LEAVE', startsAt, endsAt, reason: '   ' }))
        .body as CreateExceptionResponse;
      expect(created.exception.reason).toBeNull();
      const url = `/api/faculty/availability/exceptions/${String(created.exception.id)}`;

      expect(
        (
          await request(app)
            .delete(url)
            .set(...bearer(iyer))
        ).status,
      ).toBe(404);
      expect(
        (
          await request(app)
            .delete(url)
            .set(...bearer(rao))
        ).status,
      ).toBe(204);
      expect(
        (
          await request(app)
            .delete(url)
            .set(...bearer(rao))
        ).status,
      ).toBe(404);
      expect(
        (
          await request(app)
            .delete('/api/faculty/availability/exceptions/x')
            .set(...bearer(rao))
        ).status,
      ).toBe(400);
      expect((await post(student, { kind: 'LEAVE', startsAt, endsAt })).status).toBe(403);
    });
  });
});
