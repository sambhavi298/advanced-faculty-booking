import bcrypt from 'bcrypt';

/** bcrypt cost factor for new hashes. 12 ≈ 250 ms per hash on a laptop — slow for attackers, fine for logins. */
export const DEFAULT_BCRYPT_COST = 12;

export function hashPassword(plain: string, cost: number = DEFAULT_BCRYPT_COST): Promise<string> {
  return bcrypt.hash(plain, cost);
}

/** Constant-time comparison of a candidate password with a stored bcrypt hash. */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
