import express, { type NextFunction, type Request, type Response } from 'express';
import { DatabaseError } from 'pg';
import request from 'supertest';
import { AppError, NotFoundError } from '../../../src/errors/app-error';
import { errorHandler, toAppError } from '../../../src/middleware/error-handler';
import { notFoundHandler } from '../../../src/middleware/not-found';
import { createRequestLogger } from '../../../src/middleware/request-logger';
import { capturingLogger, silentLogger } from '../../helpers/logger';

describe('toAppError', () => {
  it('passes AppErrors through unchanged', () => {
    const error = new NotFoundError('No such faculty.');
    expect(toAppError(error)).toBe(error);
  });

  it('translates PostgreSQL errors', () => {
    const pgError = new DatabaseError('duplicate key', 0, 'error');
    pgError.code = '23505';
    expect(toAppError(pgError)).toMatchObject({ status: 409, code: 'DUPLICATE' });
  });

  it('maps body-parser errors', () => {
    expect(toAppError({ type: 'entity.parse.failed', status: 400 })).toMatchObject({
      status: 400,
      code: 'MALFORMED_JSON',
    });
    expect(toAppError({ type: 'entity.too.large', status: 413 })).toMatchObject({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
    });
    expect(toAppError({ type: 'charset.unsupported', status: 415 })).toMatchObject({
      status: 400,
      code: 'BAD_REQUEST',
    });
  });

  it('treats body-parser-shaped objects with a 5xx status as internal errors', () => {
    expect(toAppError({ type: 'stream.not.readable', status: 500 })).toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  it.each([new Error('boom'), 'a string', null, { type: 'x' }, { status: 400 }])(
    'turns unknown value %p into a generic 500',
    (value) => {
      expect(toAppError(value)).toMatchObject({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
      });
    },
  );
});

function appThrowing(error: unknown, logger = silentLogger()) {
  const app = express();
  app.use(createRequestLogger(logger));
  app.use(express.json({ limit: '1kb' }));
  app.get('/boom', () => {
    throw error;
  });
  app.post('/echo', (req: Request, res: Response) => {
    res.json(req.body);
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('errorHandler over HTTP', () => {
  it('returns the standard envelope for an AppError, including details and the request id', async () => {
    const app = appThrowing(new AppError(409, 'CONFLICT', 'Slot taken.', { constraint: 'c' }));

    const res = await request(app).get('/boom').set('X-Request-Id', 'req-123');

    expect(res.status).toBe(409);
    expect(res.headers['x-request-id']).toBe('req-123');
    expect(res.body).toEqual({
      error: { code: 'CONFLICT', message: 'Slot taken.', details: { constraint: 'c' }, requestId: 'req-123' },
    });
  });

  it('omits details when there are none', async () => {
    const res = await request(appThrowing(new NotFoundError())).get('/boom');

    expect(res.status).toBe(404);
    expect(res.body.error).not.toHaveProperty('details');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('hides internals of unexpected errors and logs them with the stack', async () => {
    const { logger, lines } = capturingLogger();
    const app = appThrowing(new Error('SELECT secret FROM internals failed'), logger);

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    const failure = lines.find((line) => line.msg === 'Request failed');
    expect(failure).toBeDefined();
    expect(JSON.stringify(failure)).toContain('SELECT secret FROM internals failed');
  });

  it('answers malformed JSON with 400 MALFORMED_JSON', async () => {
    const res = await request(appThrowing(null))
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_JSON');
  });

  it('answers oversized bodies with 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(appThrowing(null))
      .post('/echo')
      .send({ text: 'x'.repeat(2048) });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('answers unknown routes with a JSON 404 ROUTE_NOT_FOUND', async () => {
    const res = await request(appThrowing(null)).delete('/nowhere');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({
      code: 'ROUTE_NOT_FOUND',
      message: 'No route matches DELETE /nowhere.',
    });
  });
});

describe('errorHandler when the response has already started', () => {
  it('delegates to Express instead of writing a second response', () => {
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    const res = { headersSent: true, status: jest.fn(), json: jest.fn() } as unknown as Response;
    const error = new Error('mid-stream');

    errorHandler(error, {} as Request, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });
});
