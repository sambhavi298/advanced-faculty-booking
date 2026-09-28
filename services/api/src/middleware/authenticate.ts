import type { UserRole } from '@afb/types';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ForbiddenError, UnauthenticatedError } from '../errors/app-error';
import type { AuthContext, TokenService } from '../lib/tokens';

export interface SessionUserLookup {
  /** Current role and status of a user, or null if the account no longer exists. */
  findSessionUser(userId: number): Promise<{ role: UserRole; isActive: boolean } | null>;
}

const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * Requires a valid `Authorization: Bearer <JWT>` header. Mounted in front of every protected route
 * (default-deny: see routes.ts), so a route added later is protected without anyone remembering to.
 *
 * Besides the signature and expiry, the account is re-checked on every request: a deactivated or
 * deleted user is locked out immediately instead of when their token expires.
 */
export function createAuthenticate(tokens: TokenService, users: SessionUserLookup): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    if (header === undefined || header.trim() === '') {
      throw new UnauthenticatedError('Please log in to continue.');
    }
    const match = BEARER.exec(header);
    if (match === null) {
      throw new UnauthenticatedError('The Authorization header must be "Bearer <token>".');
    }

    const context = tokens.verify(match[1] as string);
    const user = await users.findSessionUser(context.userId);
    if (user === null || !user.isActive || user.role !== context.role) {
      throw new UnauthenticatedError('Your session is no longer valid. Please log in again.');
    }

    req.auth = context;
    next();
  };
}

/** Allows the request only for the listed roles (403 otherwise). Must run after authenticate. */
export function authorize(...roles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    if (!roles.includes(auth.role)) {
      throw new ForbiddenError();
    }
    next();
  };
}

/** The authenticated caller. Throws if a route was (wrongly) mounted without authenticate. */
export function requireAuth(req: Request): AuthContext {
  if (req.auth === undefined) {
    throw new UnauthenticatedError();
  }
  return req.auth;
}
