import { Pool } from 'pg';
import { migrationsDir, seedFile } from '../../src/db/paths';
import { Migrator } from '../../src/db/migrator';
import { resetDatabase } from '../../src/db/reset';
import { loadSeedFile, seedDatabase } from '../../src/db/seeder';
import { installTypeParsers } from '../../src/db/type-parsers';
import { TEST_DATABASE_URL } from '../helpers/database';
import { silentLogger } from '../helpers/logger';

/**
 * Runs once before the integration project: rebuilds the test database from scratch
 * (drop → every migration → seed), so each run starts from exactly the documented state.
 * bcrypt cost 4 keeps seeding fast; the hashes are otherwise identical in format.
 */
export default async function globalSetup(): Promise<void> {
  installTypeParsers();
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
  try {
    await resetDatabase(pool);
    await new Migrator(pool, migrationsDir(), silentLogger()).migrate();
    await seedDatabase(pool, await loadSeedFile(seedFile()), 4);
  } finally {
    await pool.end();
  }
}
