import type { Pool } from 'pg';
import request from 'supertest';
import { createTestApp } from '../helpers/app';
import { createTestPool, UNREACHABLE_DATABASE_URL } from '../helpers/database';

describe('Health endpoints against real PostgreSQL', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  const app = () => createTestApp(pool);

  it('GET /api/health reports liveness with a request id header', async () => {
    const res = await request(app()).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('GET /api/health/ready confirms PostgreSQL 18+ is reachable', async () => {
    const res = await request(app()).get('/api/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.database.reachable).toBe(true);
    expect(res.body.database.serverVersion).toMatch(/^1[89]|^[2-9]\d/);
    expect(res.body.database.name).toMatch(/test/);
  });

  it('GET /api/health/ready answers 503 when the database is unreachable', async () => {
    const deadPool = createTestPool(UNREACHABLE_DATABASE_URL);
    try {
      const res = await request(createTestApp(deadPool)).get('/api/health/ready');

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        status: 'not_ready',
        reason: 'database_unreachable',
        database: { reachable: false, minimumVersion: '18' },
      });
    } finally {
      await deadPool.end();
    }
  });

  it('sets security headers and does not advertise Express', async () => {
    const res = await request(app()).get('/api/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers).not.toHaveProperty('x-powered-by');
  });

  it('allows configured browser origins and exposes the request id header', async () => {
    const res = await request(app()).get('/api/health').set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-expose-headers']).toBe('X-Request-Id');
  });

  it('does not grant CORS to unknown origins', async () => {
    const res = await request(app()).get('/api/health').set('Origin', 'https://evil.example');

    expect(res.headers).not.toHaveProperty('access-control-allow-origin');
  });

  it('answers CORS preflight for the Authorization header', async () => {
    const res = await request(app())
      .options('/api/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'Authorization');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers']).toMatch(/Authorization/);
  });

  it('treats unknown API routes as protected: 401 without a token (default-deny)', async () => {
    const res = await request(app()).get('/api/does-not-exist');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('answers non-API paths with a JSON 404 envelope', async () => {
    const res = await request(app()).get('/favicon.ico');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({
      code: 'ROUTE_NOT_FOUND',
      message: 'No route matches GET /favicon.ico.',
    });
  });

  it('rejects malformed JSON before it reaches any route', async () => {
    const res = await request(app())
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"oops"');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_JSON');
  });

  it('rejects bodies larger than 100kb', async () => {
    const res = await request(app())
      .post('/api/health')
      .send({ blob: 'x'.repeat(110 * 1024) });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
