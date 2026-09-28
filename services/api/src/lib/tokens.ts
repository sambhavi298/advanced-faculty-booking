import type { UserRole } from '@afb/types';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { USER_ROLES } from '../domain/enums';
import { UnauthenticatedError } from '../errors/app-error';

/** Who is making a request — taken only from a verified token, never from request input. */
export interface AuthContext {
  userId: number;
  role: UserRole;
}

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

/** The claims we rely on: a positive integer user id in `sub` and a known role. */
const ClaimsSchema = z.object({
  sub: z.string().regex(/^[1-9]\d{0,15}$/),
  role: z.enum(USER_ROLES),
});

export const TOKEN_ISSUER = 'afb-api';
export const TOKEN_AUDIENCE = 'afb-portals';

/**
 * Issues and verifies the JWTs that identify users (HS256, `sub` = user id, `role` claim).
 *
 * Verification pins the algorithm (so a token claiming `alg: none` or RS256 is refused), the issuer
 * and the audience, and checks expiry against an injectable clock for deterministic tests.
 */
export class TokenService {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  issue(context: AuthContext): IssuedToken {
    const issuedAt = Math.floor(this.now().getTime() / 1000);
    const token = jwt.sign({ role: context.role, iat: issuedAt }, this.secret, {
      algorithm: 'HS256',
      subject: String(context.userId),
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      expiresIn: this.ttlSeconds,
    });
    return { token, expiresAt: new Date((issuedAt + this.ttlSeconds) * 1000) };
  }

  verify(token: string): AuthContext {
    let payload: unknown;
    try {
      payload = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
        clockTimestamp: Math.floor(this.now().getTime() / 1000),
      });
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new UnauthenticatedError('Your session has expired. Please log in again.');
      }
      throw new UnauthenticatedError('Your session is not valid. Please log in again.');
    }

    const claims = ClaimsSchema.safeParse(payload);
    if (!claims.success) {
      throw new UnauthenticatedError('Your session is not valid. Please log in again.');
    }
    return { userId: Number(claims.data.sub), role: claims.data.role };
  }
}
