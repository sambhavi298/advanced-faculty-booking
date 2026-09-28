import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pinoHttp, type HttpLogger } from 'pino-http';
import type { Logger } from '../lib/logger';

/** Accept a caller-supplied request id only if it is short and safe to echo into logs and headers. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function resolveRequestId(incoming: string | string[] | undefined): string {
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

/** pino-http types `req.id` loosely (string | number | object); ours is always a string, but be safe. */
export function requestIdOf(req: IncomingMessage): string {
  return typeof req.id === 'string' ? req.id : JSON.stringify(req.id);
}

export function levelForStatus(statusCode: number, err: Error | undefined): 'error' | 'warn' | 'info' {
  if (err !== undefined || statusCode >= 500) {
    return 'error';
  }
  return statusCode >= 400 ? 'warn' : 'info';
}

/**
 * One structured log line per request, tagged with a request id.
 *
 * The id is echoed back as `X-Request-Id` and embedded in every error body, so a user's
 * screenshot of an error can be matched to the exact server log line.
 */
export function createRequestLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const id = resolveRequestId(req.headers['x-request-id']);
      res.setHeader('X-Request-Id', id);
      return id;
    },
    customLogLevel: (_req, res, err) => levelForStatus(res.statusCode, err),
  });
}
