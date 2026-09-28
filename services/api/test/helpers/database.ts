import path from 'node:path';
import { Pool } from 'pg';
import { loadEnvFileIfPresent } from '../../src/config/env';
import { installTypeParsers } from '../../src/db/type-parsers';

loadEnvFileIfPresent(path.resolve(__dirname, '../../.env'));

/**
 * Integration tests run against a dedicated database (never the development one).
 * Override with TEST_DATABASE_URL; the default matches the docker-compose `db` service.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://afb:afb@127.0.0.1:5433/advanced_faculty_booking_test';

/** A URL guaranteed to refuse connections (port 1 is never a PostgreSQL server). */
export const UNREACHABLE_DATABASE_URL = 'postgres://afb:afb@127.0.0.1:1/unreachable';

export function createTestPool(url: string = TEST_DATABASE_URL): Pool {
  installTypeParsers();
  return new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 3_000 });
}

/**
 * Runs `work` against a brand-new, empty schema that is dropped afterwards. The pool's
 * search_path is `<schema>, public`: objects are created in the throwaway schema, while the
 * extensions installed in `public` (btree_gist, pg_trgm) stay visible. Lets migration and seed
 * tests start from nothing without touching the shared test data.
 */
export async function withIsolatedSchema<T>(work: (pool: Pool, schema: string) => Promise<T>): Promise<T> {
  const schema = `iso_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = createTestPool();
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({
    connectionString: TEST_DATABASE_URL,
    max: 4,
    options: `-c search_path=${schema},public`,
  });
  try {
    return await work(pool, schema);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}
