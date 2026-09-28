import type { AuthUser, LoginResponse, UserRole } from '@afb/types';
import type { Express } from 'express';
import type { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../../src/app';
import type { AppConfig } from '../../src/config/env';
import { TokenService } from '../../src/lib/tokens';
import { silentLogger } from './logger';

export const TEST_JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

export type TestAppConfig = Pick<AppConfig, 'corsOrigins' | 'auth' | 'trustProxy'>;

export function testConfig(overrides: Partial<TestAppConfig> = {}): TestAppConfig {
  return {
    corsOrigins: ['http://localhost:5173'],
    auth: {
      jwtSecret: TEST_JWT_SECRET,
      tokenTtlSeconds: 3600,
      loginRateLimit: { max: 1000, windowMs: 60_000 },
    },
    trustProxy: false,
    ...overrides,
  };
}

export function createTestApp(pool: Pool, overrides: Partial<TestAppConfig> = {}): Express {
  return createApp({ config: testConfig(overrides), logger: silentLogger(), db: pool });
}

/** Tokens signed with the test secret, for crafting expired or foreign tokens in tests. */
export function testTokens(now?: () => Date, ttlSeconds = 3600): TokenService {
  return new TokenService(TEST_JWT_SECRET, ttlSeconds, now);
}

export const DEMO_ACCOUNTS = {
  student: { loginId: 'RA221100301001', password: 'Password123!' },
  rao: { loginId: 'FAC200', password: 'Password123!' },
  iyer: { loginId: 'FAC201', password: 'Password123!' },
  admin: { loginId: 'ADMIN001', password: 'Admin123!' },
} as const;

/** Logs in through the real endpoint and returns the token and user. */
export async function loginAs(
  app: Express,
  account: keyof typeof DEMO_ACCOUNTS,
  role?: UserRole,
): Promise<{ token: string; user: AuthUser }> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ ...DEMO_ACCOUNTS[account], ...(role === undefined ? {} : { role }) });
  if (res.status !== 200) {
    throw new Error(`Login as ${account} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const body = res.body as LoginResponse;
  return { token: body.token, user: body.user };
}

/** Real future slots of a faculty member that a student can book right now (as the API would offer them). */
export async function bookableSlots(
  pool: Pool,
  facultyLogin: string,
  studentLogin: string,
): Promise<string[]> {
  const result = await pool.query<{ slot_start: Date }>(
    `SELECT s.slot_start
       FROM users f, users st,
            LATERAL faculty_free_slots(f.id, current_date, current_date + 30, st.id) AS s
      WHERE f.login_id = $1 AND st.login_id = $2
      ORDER BY s.slot_start`,
    [facultyLogin, studentLogin],
  );
  return result.rows.map((row) => row.slot_start.toISOString());
}

export function bearer(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}
