import jwt from 'jsonwebtoken';
import { TOKEN_AUDIENCE, TOKEN_ISSUER, TokenService } from '../../../src/lib/tokens';

const SECRET = 'unit-test-secret-that-is-long-enough-123';
const T0 = new Date('2030-01-07T09:00:00Z');

function sign(payload: string | object, options: jwt.SignOptions = {}, secret = SECRET): string {
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
    ...options,
  });
}

describe('TokenService', () => {
  it('issues a token that verifies back to the same user and role', () => {
    const tokens = new TokenService(SECRET, 3600, () => T0);
    const { token, expiresAt } = tokens.issue({ userId: 42, role: 'FACULTY' });

    expect(expiresAt.toISOString()).toBe('2030-01-07T10:00:00.000Z');
    expect(tokens.verify(token)).toEqual({ userId: 42, role: 'FACULTY' });

    const decoded = jwt.decode(token, { complete: true })!;
    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.payload).toMatchObject({
      sub: '42',
      role: 'FACULTY',
      iss: TOKEN_ISSUER,
      aud: TOKEN_AUDIENCE,
    });
  });

  it('uses the real clock by default', () => {
    const tokens = new TokenService(SECRET, 60);
    const { token, expiresAt } = tokens.issue({ userId: 1, role: 'ADMIN' });
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(tokens.verify(token).role).toBe('ADMIN');
  });

  it('rejects an expired token with a "session expired" message', () => {
    const issued = new TokenService(SECRET, 60, () => T0).issue({ userId: 1, role: 'STUDENT' });
    const later = new TokenService(SECRET, 60, () => new Date(T0.getTime() + 61_000));

    expect(() => later.verify(issued.token)).toThrow('Your session has expired. Please log in again.');
  });

  it.each([
    [
      'signed with another secret',
      () => sign({ sub: '1', role: 'ADMIN' }, {}, 'another-secret-that-is-long-enough-12345'),
    ],
    ['from another issuer', () => sign({ sub: '1', role: 'ADMIN' }, { issuer: 'someone-else' })],
    ['for another audience', () => sign({ sub: '1', role: 'ADMIN' }, { audience: 'other-app' })],
    ['not a JWT at all', () => 'not.a.jwt'],
    [
      'unsigned (alg: none)',
      () =>
        jwt.sign({ sub: '1', role: 'ADMIN', iss: TOKEN_ISSUER, aud: TOKEN_AUDIENCE }, '', {
          algorithm: 'none',
        }),
    ],
    ['missing the role claim', () => sign({ sub: '1' })],
    ['carrying an unknown role', () => sign({ sub: '1', role: 'SUPERUSER' })],
    ['with a non-numeric subject', () => sign({ sub: 'priya', role: 'STUDENT' })],
    ['with a string payload', () => jwt.sign('just-a-string', SECRET, { algorithm: 'HS256' })],
  ])('rejects a token %s', (_label, makeToken) => {
    const tokens = new TokenService(SECRET, 3600);
    expect(() => tokens.verify(makeToken())).toThrow('Your session is not valid. Please log in again.');
  });
});
