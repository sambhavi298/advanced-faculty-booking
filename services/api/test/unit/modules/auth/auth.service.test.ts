import bcrypt from 'bcrypt';
import type { Pool } from 'pg';
import { TokenService } from '../../../../src/lib/tokens';
import type { AuthRepository, Credentials } from '../../../../src/modules/auth/auth.repository';
import { AuthService, TIMING_EQUALISER_HASH } from '../../../../src/modules/auth/auth.service';

const HASH = bcrypt.hashSync('Password123!', 4);
const tokens = new TokenService('service-test-secret-that-is-long-enough', 3600);

const faculty: Credentials = {
  id: 2,
  loginId: 'FAC200',
  role: 'FACULTY',
  passwordHash: HASH,
  isActive: true,
};
const facultyUser = {
  id: 2,
  loginId: 'FAC200',
  fullName: 'Prof. K. Rao',
  role: 'FACULTY' as const,
  faculty: {
    departmentId: 1,
    departmentCode: 'CSE',
    departmentName: 'Computer Science and Engineering',
    designation: 'Associate Professor',
    officeLocation: 'TP 712',
    slotMinutes: 15,
  },
};

function setup(credentials: Credentials | null) {
  const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
  const pool = { connect: jest.fn().mockResolvedValue(client) } as unknown as Pool;
  const repository = {
    findCredentials: jest.fn().mockResolvedValue(credentials),
    recordLogin: jest.fn().mockResolvedValue(undefined),
    findAuthUser: jest.fn().mockResolvedValue(facultyUser),
  };
  return {
    service: new AuthService(repository as unknown as AuthRepository, pool, tokens),
    repository,
    client,
  };
}

describe('AuthService.login', () => {
  it('verifies the password, records the login as the user, and issues a token for their id and role', async () => {
    const { service, repository, client } = setup(faculty);

    const result = await service.login({ loginId: 'FAC200', password: 'Password123!' });

    expect(tokens.verify(result.token)).toEqual({ userId: 2, role: 'FACULTY' });
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
    expect(result.user).toEqual(facultyUser);
    expect(repository.recordLogin).toHaveBeenCalledWith(client, 2);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("set_config('app.user_id'"), [
      '2',
      'FACULTY',
    ]);
  });

  it('accepts a matching portal role', async () => {
    const { service } = setup(faculty);
    await expect(
      service.login({ loginId: 'FAC200', password: 'Password123!', role: 'FACULTY' }),
    ).resolves.toHaveProperty('token');
  });

  it('gives the same answer for a wrong password and an unknown login id', async () => {
    const wrongPassword = setup(faculty).service.login({ loginId: 'FAC200', password: 'nope' });
    const unknownUser = setup(null).service.login({ loginId: 'FAC999', password: 'Password123!' });

    for (const attempt of [wrongPassword, unknownUser]) {
      await expect(attempt).rejects.toMatchObject({
        status: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Incorrect login ID or password.',
      });
    }
  });

  it('still runs a full-cost bcrypt comparison for unknown login ids (no timing leak)', async () => {
    const compare = jest.spyOn(bcrypt, 'compare');
    await setup(null)
      .service.login({ loginId: 'FAC999', password: 'x' })
      .catch(() => undefined);

    expect(compare).toHaveBeenCalledWith('x', TIMING_EQUALISER_HASH);
    expect(bcrypt.getRounds(TIMING_EQUALISER_HASH)).toBe(12);
    compare.mockRestore();
  });

  it('refuses a deactivated account (after checking the password)', async () => {
    const { service } = setup({ ...faculty, isActive: false });
    await expect(service.login({ loginId: 'FAC200', password: 'Password123!' })).rejects.toMatchObject({
      status: 403,
      code: 'ACCOUNT_DISABLED',
    });
  });

  it.each([
    ['STUDENT', 'This is a faculty account. Please sign in on the Faculty portal.'],
    ['ADMIN', 'This is a faculty account. Please sign in on the Faculty portal.'],
  ] as const)('refuses a faculty account on the %s portal', async (portal, message) => {
    const { service, repository } = setup(faculty);
    await expect(
      service.login({ loginId: 'FAC200', password: 'Password123!', role: portal }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'WRONG_PORTAL',
      message,
    });
    expect(repository.recordLogin).not.toHaveBeenCalled();
  });
});

describe('AuthService.me', () => {
  it('returns the user with their profile', async () => {
    await expect(setup(faculty).service.me(2)).resolves.toEqual(facultyUser);
  });

  it('answers 401 when the account no longer exists', async () => {
    const { service, repository } = setup(faculty);
    repository.findAuthUser.mockResolvedValueOnce(null);
    await expect(service.me(2)).rejects.toMatchObject({
      status: 401,
      message: 'Your account no longer exists.',
    });
  });
});
