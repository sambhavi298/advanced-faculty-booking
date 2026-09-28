import path from 'node:path';

/**
 * Location of the repository's `database/` folder (migrations and seeds).
 *
 * Resolved relative to this file so it works from `src/` (tsx, Jest) and `dist/` (compiled)
 * alike — both sit three levels below the repository root. DATABASE_DIR overrides it, e.g. in a
 * container image that copies `database/` somewhere else.
 */
export function databaseDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.DATABASE_DIR ?? path.resolve(__dirname, '../../../../database');
}

export function migrationsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(databaseDir(env), 'migrations');
}

export function seedFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(databaseDir(env), 'seeds', 'seed-data.json');
}
