/**
 * Database command line (excluded from coverage — it only wires tested pieces together).
 *
 *   npm run db:migrate | db:status | db:seed | db:setup | db:reset | db:fresh
 */
import path from 'node:path';
import { loadConfig, loadEnvFileIfPresent } from '../config/env';
import { createCliLogger } from './cli-logger';
import { DB_COMMANDS, isDbCommand, runDbCommand } from './commands';
import { migrationsDir, seedFile } from './paths';
import { createPool } from './pool';

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!isDbCommand(command)) {
    throw new Error(`Usage: db <${DB_COMMANDS.join('|')}>`);
  }
  loadEnvFileIfPresent(path.resolve(process.cwd(), '.env'));
  const config = loadConfig();
  const logger = createCliLogger();
  const pool = createPool(config.database, logger);
  try {
    await runDbCommand(command, {
      pool,
      logger,
      config,
      migrationsDir: migrationsDir(),
      seedFile: seedFile(),
    });
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? `ERROR ${err.message}` : err);
  process.exit(1);
});
