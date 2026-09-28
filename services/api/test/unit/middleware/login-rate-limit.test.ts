import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { errorHandler } from '../../../src/middleware/error-handler';
import { createLoginRateLimiter } from '../../../src/middleware/login-rate-limit';
import { createRequestLogger } from '../../../src/middleware/request-logger';
import { silentLogger } from '../../helpers/logger';

/** A fake login endpoint: password "right" succeeds, anything else fails with 401. */
function app(max: number) {
  const server = express();
  server.use(createRequestLogger(silentLogger()));
  server.use(express.json());
  server.post('/login', createLoginRateLimiter({ max, windowMs: 60_000 }), (req: Request, res: Response) => {
    const body = req.body as { password?: string };
    res.status(body.password === 'right' ? 200 : 401).json({});
  });
  server.use(errorHandler);
  return server;
}

describe('login rate limiter', () => {
  it('blocks a client + login id after too many failed attempts', async () => {
    const server = app(2);
    const attempt = () => request(server).post('/login').send({ loginId: 'FAC200', password: 'wrong' });

    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    const blocked = await attempt();

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many failed login attempts. Please wait a few minutes and try again.',
    });
    expect(blocked.headers).toHaveProperty('ratelimit');
  });

  it('does not count successful logins', async () => {
    const server = app(1);
    for (let i = 0; i < 3; i += 1) {
      expect(
        (await request(server).post('/login').send({ loginId: 'FAC200', password: 'right' })).status,
      ).toBe(200);
    }
  });

  it('counts each login id separately and ignores case and spaces', async () => {
    const server = app(1);
    await request(server).post('/login').send({ loginId: 'fac200 ', password: 'wrong' });

    expect((await request(server).post('/login').send({ loginId: 'FAC200', password: 'wrong' })).status).toBe(
      429,
    );
    expect((await request(server).post('/login').send({ loginId: 'FAC201', password: 'wrong' })).status).toBe(
      401,
    );
  });

  it('still limits requests without a usable login id', async () => {
    const server = app(1);
    await request(server).post('/login').send({ loginId: 42 });
    expect(
      (await request(server).post('/login').send('not json').set('Content-Type', 'text/plain')).status,
    ).toBe(429);
  });
});
