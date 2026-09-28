import type { Queryable } from './types';

/**
 * Drops every object in a schema (tables, types, functions, views) and recreates it empty.
 * Development and test use only — `db:reset` refuses to run when NODE_ENV=production.
 */
export async function resetDatabase(db: Queryable, schema = 'public'): Promise<void> {
  const quoted = `"${schema.replace(/"/g, '""')}"`;
  await db.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  await db.query(`CREATE SCHEMA ${quoted}`);
}
