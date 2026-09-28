import type { Queryable } from '../../../../src/db/types';
import { AuthRepository, IncompleteAccountError } from '../../../../src/modules/auth/auth.repository';

function db(rows: unknown[]): Queryable & { query: jest.Mock } {
  return { query: jest.fn().mockResolvedValue({ rows }) };
}

const empty = {
  batch_id: null,
  batch_name: null,
  year_of_study: null,
  academic_year: null,
  student_department_code: null,
  student_department_name: null,
  faculty_department_id: null,
  faculty_department_code: null,
  faculty_department_name: null,
  designation: null,
  office_location: null,
  slot_minutes: null,
};

describe('AuthRepository mapping', () => {
  it('returns null for unknown users everywhere', async () => {
    const repository = new AuthRepository(db([]));
    await expect(repository.findCredentials('RA0000000000')).resolves.toBeNull();
    await expect(repository.findSessionUser(1)).resolves.toBeNull();
    await expect(repository.findAuthUser(1)).resolves.toBeNull();
  });

  it('maps credentials and session rows to camelCase', async () => {
    const credentials = new AuthRepository(
      db([{ id: 1, login_id: 'FAC200', role: 'FACULTY', password_hash: 'h', is_active: true }]),
    );
    await expect(credentials.findCredentials('FAC200')).resolves.toEqual({
      id: 1,
      loginId: 'FAC200',
      role: 'FACULTY',
      passwordHash: 'h',
      isActive: true,
    });
    const session = new AuthRepository(db([{ role: 'ADMIN', is_active: false }]));
    await expect(session.findSessionUser(4)).resolves.toEqual({ role: 'ADMIN', isActive: false });
  });

  it('builds the admin shape without a profile', async () => {
    const repository = new AuthRepository(
      db([{ id: 4, login_id: 'ADMIN001', full_name: 'Amy', role: 'ADMIN', ...empty }]),
    );
    await expect(repository.findAuthUser(4)).resolves.toEqual({
      id: 4,
      loginId: 'ADMIN001',
      fullName: 'Amy',
      role: 'ADMIN',
    });
  });

  it.each(['STUDENT', 'FACULTY'] as const)('refuses a %s account without its role record', async (role) => {
    const repository = new AuthRepository(db([{ id: 9, login_id: 'X', full_name: 'X', role, ...empty }]));
    await expect(repository.findAuthUser(9)).rejects.toThrow(IncompleteAccountError);
    await expect(repository.findAuthUser(9)).rejects.toThrow(
      `User 9 has role ${role} but no ${role.toLowerCase()} record`,
    );
  });
});
