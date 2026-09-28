import { readFile } from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { hashPassword } from '../lib/password';
import { withTransaction } from './transaction';

/**
 * Loads database/seeds/seed-data.json into an empty database.
 *
 * - Passwords in the seed file are the documented demo credentials. They are bcrypt-hashed here,
 *   during seeding; only hashes reach the database (which enforces that with a CHECK constraint).
 * - Everything is inserted in one transaction: either the whole seed applies or nothing does.
 * - Seeding only runs when there are no users yet, so running it twice never duplicates or
 *   overwrites anything. Use `db:reset` for a fresh start.
 */

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM (24-hour)');
const dayOfWeek = z.number().int().min(1).max(7);
const password = z.string().min(8);

const SeedSchema = z.object({
  departments: z.array(z.object({ code: z.string(), name: z.string() })).min(1),
  batches: z.array(
    z.object({
      ref: z.string(),
      department: z.string(),
      name: z.string(),
      yearOfStudy: z.number().int(),
      academicYear: z.string(),
    }),
  ),
  students: z.array(z.object({ loginId: z.string(), fullName: z.string(), password, batch: z.string() })),
  faculty: z.array(
    z.object({
      loginId: z.string(),
      fullName: z.string(),
      password,
      department: z.string(),
      designation: z.string(),
      officeLocation: z.string(),
      slotMinutes: z.number().int(),
    }),
  ),
  admins: z.array(z.object({ loginId: z.string(), fullName: z.string(), password })),
  facultyAvailability: z.array(z.object({ faculty: z.string(), dayOfWeek, start: time, end: time })),
  batchSchedule: z.array(
    z.object({
      batch: z.string(),
      faculty: z.string().nullable(),
      courseCode: z.string(),
      courseTitle: z.string(),
      sessionType: z.enum(['LECTURE', 'LAB', 'TUTORIAL']),
      dayOfWeek,
      start: time,
      end: time,
      room: z.string().nullable(),
    }),
  ),
});

export type SeedData = z.infer<typeof SeedSchema>;

export interface SeedResult {
  seeded: boolean;
  counts: {
    departments: number;
    batches: number;
    students: number;
    faculty: number;
    admins: number;
    facultyAvailability: number;
    batchSchedule: number;
  };
}

export class SeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedError';
  }
}

export async function loadSeedFile(file: string): Promise<SeedData> {
  const parsed = SeedSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
  if (!parsed.success) {
    throw new SeedError(`Invalid seed file ${file}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

function lookup<V>(map: Map<string, V>, key: string, what: string): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new SeedError(`Seed data references unknown ${what} "${key}"`);
  }
  return value;
}

async function insertReturningId(client: PoolClient, sql: string, values: unknown[]): Promise<number> {
  const result = await client.query<{ id: number }>(sql, values);
  return (result.rows[0] as { id: number }).id;
}

export async function seedDatabase(pool: Pool, data: SeedData, bcryptCost: number): Promise<SeedResult> {
  const counts: SeedResult['counts'] = {
    departments: data.departments.length,
    batches: data.batches.length,
    students: data.students.length,
    faculty: data.faculty.length,
    admins: data.admins.length,
    facultyAvailability: data.facultyAvailability.length,
    batchSchedule: data.batchSchedule.length,
  };

  // Hash outside the transaction (bcrypt is deliberately slow; don't hold a connection meanwhile).
  const people = [...data.students, ...data.faculty, ...data.admins];
  const hashes = new Map(
    await Promise.all(
      people.map(
        async (person) => [person.loginId, await hashPassword(person.password, bcryptCost)] as const,
      ),
    ),
  );

  return withTransaction(pool, async (client) => {
    const existing = await client.query<{ users: number }>('SELECT count(*) AS users FROM users');
    if ((existing.rows[0] as { users: number }).users > 0) {
      return { seeded: false, counts };
    }

    const departmentIds = new Map<string, number>();
    for (const department of data.departments) {
      departmentIds.set(
        department.code,
        await insertReturningId(client, 'INSERT INTO departments (code, name) VALUES ($1, $2) RETURNING id', [
          department.code,
          department.name,
        ]),
      );
    }

    const batchIds = new Map<string, number>();
    for (const batch of data.batches) {
      batchIds.set(
        batch.ref,
        await insertReturningId(
          client,
          `INSERT INTO batches (department_id, name, year_of_study, academic_year)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [
            lookup(departmentIds, batch.department, 'department'),
            batch.name,
            batch.yearOfStudy,
            batch.academicYear,
          ],
        ),
      );
    }

    const insertUser = (loginId: string, fullName: string, role: string) =>
      insertReturningId(
        client,
        'INSERT INTO users (login_id, full_name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
        [loginId, fullName, role, lookup(hashes, loginId, 'account')],
      );

    for (const student of data.students) {
      const userId = await insertUser(student.loginId, student.fullName, 'STUDENT');
      await client.query('INSERT INTO students (user_id, batch_id) VALUES ($1, $2)', [
        userId,
        lookup(batchIds, student.batch, 'batch'),
      ]);
    }

    const facultyIds = new Map<string, number>();
    for (const member of data.faculty) {
      const userId = await insertUser(member.loginId, member.fullName, 'FACULTY');
      await client.query(
        `INSERT INTO faculty (user_id, department_id, designation, office_location, slot_minutes)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          userId,
          lookup(departmentIds, member.department, 'department'),
          member.designation,
          member.officeLocation,
          member.slotMinutes,
        ],
      );
      facultyIds.set(member.loginId, userId);
    }

    for (const admin of data.admins) {
      await insertUser(admin.loginId, admin.fullName, 'ADMIN');
    }

    for (const window of data.facultyAvailability) {
      await client.query(
        'INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4)',
        [lookup(facultyIds, window.faculty, 'faculty member'), window.dayOfWeek, window.start, window.end],
      );
    }

    for (const session of data.batchSchedule) {
      await client.query(
        `INSERT INTO batch_schedule
           (batch_id, faculty_id, course_code, course_title, session_type, day_of_week, start_time, end_time, room)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          lookup(batchIds, session.batch, 'batch'),
          session.faculty === null ? null : lookup(facultyIds, session.faculty, 'faculty member'),
          session.courseCode,
          session.courseTitle,
          session.sessionType,
          session.dayOfWeek,
          session.start,
          session.end,
          session.room,
        ],
      );
    }

    return { seeded: true, counts };
  });
}
