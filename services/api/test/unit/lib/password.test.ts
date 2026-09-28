import { DEFAULT_BCRYPT_COST, hashPassword, verifyPassword } from '../../../src/lib/password';

describe('password hashing', () => {
  it('produces a bcrypt hash that verifies only the original password', async () => {
    const hash = await hashPassword('Password123!', 4);

    expect(hash).toMatch(/^\$2b\$04\$[./A-Za-z0-9]{53}$/);
    await expect(verifyPassword('Password123!', hash)).resolves.toBe(true);
    await expect(verifyPassword('password123!', hash)).resolves.toBe(false);
  });

  it('uses a different salt every time', async () => {
    const [a, b] = await Promise.all([hashPassword('same', 4), hashPassword('same', 4)]);
    expect(a).not.toBe(b);
  });

  it('defaults to cost 12', async () => {
    expect(DEFAULT_BCRYPT_COST).toBe(12);
    await expect(hashPassword('x')).resolves.toMatch(/^\$2b\$12\$/);
  });
});
