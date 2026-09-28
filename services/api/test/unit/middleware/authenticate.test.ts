import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { TokenService } from '../../../src/lib/tokens';
import {
  authorize,
  createAuthenticate,
  requireAuth,
  type SessionUserLookup,
} from '../../../src/middleware/authenticate';
import { errorHandler } from '../../../src/middleware/error-handler';
import { createRequestLogger } from '../../../src/middleware/request-logger';
import { silentLogger } from '../../helpers/logger';

const tokens = new TokenService('middleware-test-secret-long-enough-000', 3600);

function appWith(lookup: SessionUserLookup['findSessionUser']) {
  const app = express();
  app.use(createRequestLogger(silentLogger()));
  app.use(createAuthenticate(tokens, { findSessionUser: lookup }));
  app.get('/whoami', (req: Request, res: Response) => {
    res.json(requireAuth(req));
  });
  app.get('/faculty-only', authorize('FACULTY'), (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

const active = (role: 'STUDENT' | 'FACULTY' | 'ADMIN') =>
  jest.fn().mockResolvedValue({ role, isActive: true });

describe('authenticate', () => {
  it('accepts a valid Bearer token and exposes the caller as req.auth', async () => {
    const { token } = tokens.issue({ userId: 7, role: 'STUDENT' });
    const lookup = active('STUDENT');

    const res = await request(appWith(lookup)).get('/whoami').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 7, role: 'STUDENT' });
    expect(lookup).toHaveBeenCalledWith(7);
  });

  it('accepts the scheme case-insensitively', async () => {
    const { token } = tokens.issue({ userId: 7, role: 'STUDENT' });
    const res = await request(appWith(active('STUDENT')))
      .get('/whoami')
      .set('Authorization', `bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it.each([
    ['no Authorization header', undefined, 'Please log in to continue.'],
    ['a blank header', '   ', 'Please log in to continue.'],
    ['another scheme', 'Basic dXNlcjpwYXNz', 'The Authorization header must be "Bearer <token>".'],
    ['a bare token', 'abc.def.ghi', 'The Authorization header must be "Bearer <token>".'],
    ['an invalid token', 'Bearer abc.def.ghi', 'Your session is not valid. Please log in again.'],
  ])('rejects %s with 401', async (_label, header, message) => {
    const req = request(appWith(active('STUDENT'))).get('/whoami');
    const res = await (header === undefined ? req : req.set('Authorization', header));

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'UNAUTHENTICATED', message });
  });

  it.each([
    ['the account no longer exists', null],
    ['the account was deactivated', { role: 'STUDENT', isActive: false }],
    ["the account's role no longer matches the token", { role: 'ADMIN', isActive: true }],
  ])('rejects a valid token when %s', async (_label, user) => {
    const { token } = tokens.issue({ userId: 7, role: 'STUDENT' });
    const res = await request(appWith(jest.fn().mockResolvedValue(user)))
      .get('/whoami')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Your session is no longer valid. Please log in again.');
  });
});

describe('authorize', () => {
  it('lets listed roles through', async () => {
    const { token } = tokens.issue({ userId: 2, role: 'FACULTY' });
    const res = await request(appWith(active('FACULTY')))
      .get('/faculty-only')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('answers other roles with 403 FORBIDDEN', async () => {
    const { token } = tokens.issue({ userId: 1, role: 'STUDENT' });
    const res = await request(appWith(active('STUDENT')))
      .get('/faculty-only')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('requireAuth', () => {
  it('refuses a request that never passed authenticate', () => {
    expect(() => requireAuth({} as Request)).toThrow('Authentication is required.');
  });

  it('authorize also refuses such a request', () => {
    expect(() => {
      authorize('ADMIN')({} as Request, {} as Response, jest.fn());
    }).toThrow('Authentication is required.');
  });
});
