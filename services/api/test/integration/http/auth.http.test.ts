import type { Pool } from 'pg';
import request from 'supertest';
import { createTestApp, DEMO_ACCOUNTS, loginAs, testTokens } from '../../helpers/app';
import { createTestPool } from '../../helpers/database';

describe('Authentication over HTTP (real database)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  const app = () => createTestApp(pool);

  describe('POST /api/auth/login', () => {
    it('logs a student in with their Registration Number and returns a token and profile', async () => {
      const res = await request(app()).post('/api/auth/login').send(DEMO_ACCOUNTS.student);

      expect(res.status).toBe(200);
      expect(res.body.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(Date.parse(res.body.expiresAt)).toBeGreaterThan(Date.now());
      expect(res.body.user).toEqual({
        id: expect.any(Number) as number,
        loginId: 'RA221100301001',
        fullName: 'Priya Sharma',
        role: 'STUDENT',
        student: {
          batchId: expect.any(Number) as number,
          batchName: 'Batch 1',
          yearOfStudy: 3,
          academicYear: '2026-2027',
          departmentCode: 'CSE',
          departmentName: 'Computer Science and Engineering',
        },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    it.each([
      ['rao', 'Prof. K. Rao', 'Associate Professor', 15],
      ['iyer', 'Prof. S. Iyer', 'Assistant Professor', 20],
    ] as const)(
      'logs faculty member %s in with their Employee ID',
      async (account, fullName, designation, slotMinutes) => {
        const { user } = await loginAs(app(), account, 'FACULTY');
        expect(user).toMatchObject({
          fullName,
          role: 'FACULTY',
          faculty: { designation, slotMinutes, departmentCode: 'CSE' },
        });
      },
    );

    it('logs the admin in with their Admin ID', async () => {
      const { user } = await loginAs(app(), 'admin', 'ADMIN');
      expect(user).toEqual({
        id: expect.any(Number) as number,
        loginId: 'ADMIN001',
        fullName: 'Amy',
        role: 'ADMIN',
      });
    });

    it('accepts the login id in any case and with surrounding spaces', async () => {
      const res = await request(app())
        .post('/api/auth/login')
        .send({ loginId: '  fac200 ', password: 'Password123!' });
      expect(res.status).toBe(200);
      expect(res.body.user.loginId).toBe('FAC200');
    });

    it('answers a wrong password and an unknown login id identically', async () => {
      const wrong = await request(app())
        .post('/api/auth/login')
        .send({ loginId: 'FAC200', password: 'password123!' });
      const unknown = await request(app())
        .post('/api/auth/login')
        .send({ loginId: 'FAC999', password: 'Password123!' });

      for (const res of [wrong, unknown]) {
        expect(res.status).toBe(401);
        expect(res.body.error).toMatchObject({
          code: 'INVALID_CREDENTIALS',
          message: 'Incorrect login ID or password.',
        });
      }
    });

    it('validates the request body and reports each field', async () => {
      const res = await request(app()).post('/api/auth/login').send({ loginId: '   ', role: 'TEACHER' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Enter your login ID.');
      expect(res.body.error.details.issues.map((issue: { field: string }) => issue.field)).toEqual([
        'loginId',
        'password',
        'role',
      ]);
    });

    it("refuses an account on another role's portal, after verifying the password", async () => {
      const res = await request(app())
        .post('/api/auth/login')
        .send({ ...DEMO_ACCOUNTS.rao, role: 'STUDENT' });

      expect(res.status).toBe(403);
      expect(res.body.error).toEqual(
        expect.objectContaining({
          code: 'WRONG_PORTAL',
          message: 'This is a faculty account. Please sign in on the Faculty portal.',
        }),
      );

      const wrongPasswordToo = await request(app())
        .post('/api/auth/login')
        .send({ loginId: 'FAC200', password: 'x', role: 'STUDENT' });
      expect(wrongPasswordToo.status).toBe(401); // no hint about the role without the right password
    });

    it('refuses a deactivated account', async () => {
      await pool.query("UPDATE users SET is_active = false WHERE login_id = 'FAC201'");
      try {
        const res = await request(app()).post('/api/auth/login').send(DEMO_ACCOUNTS.iyer);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
      } finally {
        await pool.query("UPDATE users SET is_active = true WHERE login_id = 'FAC201'");
      }
    });

    it('records the login time, audited as the user who logged in', async () => {
      const { user } = await loginAs(app(), 'admin');

      const audit = await pool.query<{ actor_user_id: number; actor_role: string; changed_fields: string[] }>(
        `SELECT actor_user_id, actor_role, changed_fields FROM audit_logs
          WHERE table_name = 'users' AND record_id = $1 ORDER BY id DESC LIMIT 1`,
        [String(user.id)],
      );
      expect(audit.rows[0]).toEqual({
        actor_user_id: user.id,
        actor_role: 'ADMIN',
        changed_fields: ['last_login_at'],
      });
    });

    it('rate-limits repeated failed attempts for the same login id', async () => {
      const limited = createTestApp(pool, {
        auth: {
          jwtSecret: 'x'.repeat(32),
          tokenTtlSeconds: 60,
          loginRateLimit: { max: 2, windowMs: 60_000 },
        },
      });
      const fail = () =>
        request(limited).post('/api/auth/login').send({ loginId: 'ADMIN001', password: 'guess' });

      await fail();
      await fail();
      const blocked = await fail();

      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
      // Even the right password is refused while blocked.
      expect((await request(limited).post('/api/auth/login').send(DEMO_ACCOUNTS.admin)).status).toBe(429);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns the signed-in user for a valid Bearer token', async () => {
      const server = app();
      const { token, user } = await loginAs(server, 'student');

      const res = await request(server).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(user);
    });

    it('requires a token', async () => {
      const res = await request(app()).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Please log in to continue.',
      });
    });

    it('ignores identity headers entirely — only the token counts', async () => {
      const res = await request(app()).get('/api/auth/me').set('X-User-Id', '1').set('X-User-Role', 'ADMIN');
      expect(res.status).toBe(401);
    });

    it('rejects a tampered token', async () => {
      const { token } = await loginAs(app(), 'student');
      const [header, payload, signature] = token.split('.') as [string, string, string];
      const forged = Buffer.from(
        JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), role: 'ADMIN' }),
      ).toString('base64url');

      const res = await request(app())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${header}.${forged}.${signature}`);
      expect(res.status).toBe(401);
    });

    it('rejects an expired token', async () => {
      const ids = await pool.query<{ id: number }>("SELECT id FROM users WHERE login_id = 'FAC200'");
      const { token } = testTokens(() => new Date(Date.now() - 2 * 3600_000), 3600).issue({
        userId: ids.rows[0]!.id,
        role: 'FACULTY',
      });

      const res = await request(app()).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Your session has expired. Please log in again.');
    });

    it('locks out a user as soon as their account is deactivated', async () => {
      const server = app();
      const { token } = await loginAs(server, 'iyer');
      await pool.query("UPDATE users SET is_active = false WHERE login_id = 'FAC201'");
      try {
        const res = await request(server).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(401);
        expect(res.body.error.message).toBe('Your session is no longer valid. Please log in again.');
      } finally {
        await pool.query("UPDATE users SET is_active = true WHERE login_id = 'FAC201'");
      }
    });
  });

  it('with a valid token, unknown API routes answer 404', async () => {
    const server = app();
    const { token } = await loginAs(server, 'admin');
    const res = await request(server).get('/api/nothing-here').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
