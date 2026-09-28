import { Pool } from 'pg';
import type { DatabaseConfig } from '../config/env';
import type { Logger } from '../lib/logger';
import { installTypeParsers } from './type-parsers';

/**
 * Creates the application's single PostgreSQL connection pool.
 *
 * - `application_name` makes our sessions identifiable in `pg_stat_activity` (useful when
 *   demonstrating locks and concurrent bookings).
 * - `statement_timeout` stops a runaway query from holding a connection (and its locks) forever.
 * - An idle client can error (e.g. the server restarts); without a listener that would crash the process.
 */
export function createPool(config: DatabaseConfig, logger: Logger): Pool {
  installTypeParsers();
  const pool = new Pool({
    connectionString: config.url,
    max: config.poolMax,
    application_name: 'afb-api',
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
  });
  pool.on('error', (err) => {
    logger.error({ err }, 'Idle PostgreSQL client error');
  });
  return pool;
}
