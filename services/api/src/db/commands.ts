import type { Pool } from 'pg';
import type { AppConfig } from '../config/env';
import type { Logger } from '../lib/logger';
import { Migrator } from './migrator';
import { resetDatabase } from './reset';
import { loadSeedFile, seedDatabase } from './seeder';

export const DB_COMMANDS = ['migrate', 'status', 'seed', 'setup', 'reset', 'fresh'] as const;
export type DbCommand = (typeof DB_COMMANDS)[number];

export interface DbCommandContext {
  pool: Pool;
  logger: Logger;
  config: Pick<AppConfig, 'env' | 'bcryptCost'>;
  migrationsDir: string;
  seedFile: string;
  /** Schema that `reset` drops and recreates. Always `public` except in isolated tests. */
  schema?: string;
}

export class DbCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbCommandError';
  }
}

export function isDbCommand(value: string | undefined): value is DbCommand {
  return (DB_COMMANDS as readonly (string | undefined)[]).includes(value);
}

/**
 * migrate  apply pending migrations
 * status   list migrations and whether each is applied
 * seed     load the initial data into an empty database
 * setup    migrate + seed (first-time setup; safe to repeat)
 * reset    drop everything (refused in production)
 * fresh    reset + migrate + seed (refused in production)
 */
export async function runDbCommand(command: DbCommand, context: DbCommandContext): Promise<void> {
  const { pool, logger, config } = context;
  const migrator = new Migrator(pool, context.migrationsDir, logger);

  const seed = async (): Promise<void> => {
    const result = await seedDatabase(pool, await loadSeedFile(context.seedFile), config.bcryptCost);
    if (result.seeded) {
      logger.info(result.counts, 'Seed data loaded');
    } else {
      logger.info('Database already has users; seed skipped');
    }
  };

  const reset = async (): Promise<void> => {
    if (config.env === 'production') {
      throw new DbCommandError('Refusing to reset a production database.');
    }
    await resetDatabase(pool, context.schema);
    logger.warn('Database reset: all tables, types and functions dropped');
  };

  switch (command) {
    case 'migrate':
      await migrator.migrate();
      return;
    case 'status':
      for (const migration of await migrator.status()) {
        logger.info(
          { applied: migration.applied, at: migration.appliedAt?.toISOString() ?? '-' },
          `${migration.version}_${migration.name}`,
        );
      }
      return;
    case 'seed':
      await seed();
      return;
    case 'setup':
      await migrator.migrate();
      await seed();
      return;
    case 'reset':
      await reset();
      return;
    case 'fresh':
      await reset();
      await migrator.migrate();
      await seed();
      return;
  }
}
