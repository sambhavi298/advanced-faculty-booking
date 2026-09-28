import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { AuthConfig } from '../config/env';
import { AppError } from '../errors/app-error';

/**
 * Brute-force protection for POST /api/auth/login.
 *
 * Attempts are counted per client address *and* login id, and only failed attempts count
 * (skipSuccessfulRequests), so one student mistyping cannot lock out a whole lab sharing one IP.
 * The in-memory store is appropriate for a single API instance.
 */
export function createLoginRateLimiter({ max, windowMs }: AuthConfig['loginRateLimit']): RequestHandler {
  return rateLimit({
    windowMs,
    limit: max,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const body = req.body as { loginId?: unknown } | undefined;
      const loginId = typeof body?.loginId === 'string' ? body.loginId.trim().toUpperCase() : '';
      return `${ipKeyGenerator(String(req.ip))}|${loginId}`;
    },
    handler: (_req, _res, next) => {
      next(
        new AppError(
          429,
          'TOO_MANY_REQUESTS',
          'Too many failed login attempts. Please wait a few minutes and try again.',
        ),
      );
    },
  });
}
