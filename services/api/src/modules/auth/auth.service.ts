import type { AuthUser, LoginRequest, LoginResponse, UserRole } from '@afb/types';
import type { Pool } from 'pg';
import { withTransaction } from '../../db/transaction';
import { AppError, UnauthenticatedError } from '../../errors/app-error';
import { verifyPassword } from '../../lib/password';
import type { TokenService } from '../../lib/tokens';
import type { AuthRepository } from './auth.repository';

/**
 * A bcrypt hash (cost 12) of a random value nobody knows. When the login id does not exist we still
 * run one bcrypt comparison against it, so the response time does not reveal which login ids exist.
 */
export const TIMING_EQUALISER_HASH = '$2b$12$7JKAVRZ9V5CeTZkzeutafePOnvUj9ez1WNkw7F1RFVODTZylLEOjK';

const PORTAL_NAMES: Record<UserRole, string> = {
  STUDENT: 'Student',
  FACULTY: 'Faculty',
  ADMIN: 'Admin',
};

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly pool: Pool,
    private readonly tokens: TokenService,
  ) {}

  /**
   * 1. find the account by login id  2. verify the password against the bcrypt hash
   * 3. check the account is active and matches the portal  4. record the login (audited as the user)
   * 5. issue a JWT carrying the user id and role.
   */
  async login(request: LoginRequest): Promise<LoginResponse> {
    const account = await this.repository.findCredentials(request.loginId);
    const passwordMatches = await verifyPassword(
      request.password,
      account?.passwordHash ?? TIMING_EQUALISER_HASH,
    );

    // Same answer for "no such login id" and "wrong password": login ids cannot be probed.
    if (account === null || !passwordMatches) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect login ID or password.');
    }
    if (!account.isActive) {
      throw new AppError(
        403,
        'ACCOUNT_DISABLED',
        'This account has been deactivated. Please contact the administrator.',
      );
    }
    if (request.role !== undefined && request.role !== account.role) {
      throw new AppError(
        403,
        'WRONG_PORTAL',
        `This is a ${PORTAL_NAMES[account.role].toLowerCase()} account. Please sign in on the ${PORTAL_NAMES[account.role]} portal.`,
      );
    }

    await withTransaction(this.pool, (client) => this.repository.recordLogin(client, account.id), {
      actor: { userId: account.id, role: account.role },
    });

    const user = await this.me(account.id);
    const { token, expiresAt } = this.tokens.issue({ userId: account.id, role: account.role });
    return { token, expiresAt: expiresAt.toISOString(), user };
  }

  async me(userId: number): Promise<AuthUser> {
    const user = await this.repository.findAuthUser(userId);
    if (user === null) {
      throw new UnauthenticatedError('Your account no longer exists.');
    }
    return user;
  }
}
