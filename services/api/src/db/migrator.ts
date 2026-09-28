import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseError, type Pool, type PoolClient } from 'pg';
import type { Logger } from '../lib/logger';

/**
 * Forward-only SQL migrations.
 *
 * Files in database/migrations named `NNNN_description.sql` are applied in order. Each file runs
 * in its own transaction together with the insert into `schema_migrations`, so a migration is
 * either fully applied and recorded, or not applied at all. A PostgreSQL advisory lock ensures two
 * processes (e.g. two API containers starting together) never migrate at the same time.
 *
 * Applied files are checksummed: editing a migration after it has run is reported as an error
 * instead of silently leaving databases that ran the old and new versions in different states.
 */

export interface MigrationFile {
  version: string;
  name: string;
  fileName: string;
  sql: string;
  checksum: string;
}

export interface MigrationStatus {
  version: string;
  name: string;
  applied: boolean;
  appliedAt: Date | null;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/** Checksums ignore line-ending style, so a Windows (CRLF) checkout matches a Linux (LF) one. */
export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/** Converts PostgreSQL's 1-based character offset into a 1-based line number. */
export function lineAt(sql: string, position: number): number {
  return sql.slice(0, Math.max(position - 1, 0)).split('\n').length;
}

export async function readMigrationFiles(dir: string): Promise<MigrationFile[]> {
  const entries = (await readdir(dir)).filter((entry) => entry.endsWith('.sql')).sort();
  const files: MigrationFile[] = [];
  const seen = new Set<string>();

  for (const fileName of entries) {
    const match = FILE_PATTERN.exec(fileName);
    if (match === null) {
      throw new MigrationError(`Invalid migration file name "${fileName}": expected NNNN_description.sql`);
    }
    const [, version = '', name = ''] = match;
    if (seen.has(version)) {
      throw new MigrationError(`Duplicate migration version ${version} (${fileName})`);
    }
    seen.add(version);
    const sql = await readFile(path.join(dir, fileName), 'utf8');
    files.push({ version, name, fileName, sql, checksum: checksumOf(sql) });
  }
  return files;
}

interface AppliedRow {
  version: string;
  name: string;
  checksum: string;
  applied_at: Date;
}

const LOCK_SQL = "SELECT pg_advisory_lock(hashtext('advanced_faculty_booking.migrations'))";
const UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtext('advanced_faculty_booking.migrations'))";

export class Migrator {
  constructor(
    private readonly pool: Pool,
    private readonly dir: string,
    private readonly logger: Logger,
  ) {}

  /** Applies every pending migration in order. Returns the migrations applied by this call. */
  async migrate(): Promise<MigrationFile[]> {
    return this.withLock(async (client) => {
      const files = await readMigrationFiles(this.dir);
      const applied = await this.appliedMigrations(client);
      verifyHistory(files, applied);

      const appliedVersions = new Set(applied.map((row) => row.version));
      const pending = files.filter((file) => !appliedVersions.has(file.version));

      for (const file of pending) {
        await this.apply(client, file);
      }
      if (pending.length === 0) {
        this.logger.info('Database schema is up to date');
      }
      return pending;
    });
  }

  /** Lists every migration file with whether (and when) it has been applied. */
  async status(): Promise<MigrationStatus[]> {
    return this.withLock(async (client) => {
      const files = await readMigrationFiles(this.dir);
      const applied = await this.appliedMigrations(client);
      verifyHistory(files, applied);
      const appliedAt = new Map(applied.map((row) => [row.version, row.applied_at]));
      return files.map((file) => ({
        version: file.version,
        name: file.name,
        applied: appliedAt.has(file.version),
        appliedAt: appliedAt.get(file.version) ?? null,
      }));
    });
  }

  private async withLock<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(LOCK_SQL);
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            version       text PRIMARY KEY,
            name          text NOT NULL,
            checksum      text NOT NULL,
            applied_at    timestamptz NOT NULL DEFAULT now(),
            execution_ms  integer NOT NULL
          )`);
        return await work(client);
      } finally {
        await client.query(UNLOCK_SQL);
      }
    } finally {
      client.release();
    }
  }

  private async appliedMigrations(client: PoolClient): Promise<AppliedRow[]> {
    const result = await client.query<AppliedRow>(
      'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version',
    );
    return result.rows;
  }

  private async apply(client: PoolClient, file: MigrationFile): Promise<void> {
    const started = Date.now();
    await client.query('BEGIN');
    try {
      await client.query(file.sql);
      await client.query(
        'INSERT INTO schema_migrations (version, name, checksum, execution_ms) VALUES ($1, $2, $3, $4)',
        [file.version, file.name, file.checksum, Date.now() - started],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new MigrationError(describeFailure(file, err));
    }
    this.logger.info({ migration: file.fileName, ms: Date.now() - started }, 'Applied migration');
  }
}

function verifyHistory(files: MigrationFile[], applied: AppliedRow[]): void {
  const byVersion = new Map(files.map((file) => [file.version, file]));
  for (const row of applied) {
    const file = byVersion.get(row.version);
    if (file === undefined) {
      throw new MigrationError(
        `Migration ${row.version}_${row.name}.sql was applied to this database but no longer exists.`,
      );
    }
    if (file.checksum !== row.checksum) {
      throw new MigrationError(
        `Migration ${file.fileName} was modified after it was applied. Add a new migration instead of editing an applied one.`,
      );
    }
  }
}

export function describeFailure(file: Pick<MigrationFile, 'fileName' | 'sql'>, err: unknown): string {
  if (err instanceof DatabaseError) {
    const where = err.position === undefined ? '' : ` (line ${lineAt(file.sql, Number(err.position))})`;
    return `Migration ${file.fileName} failed${where}: ${err.message}`;
  }
  return `Migration ${file.fileName} failed: ${err instanceof Error ? err.message : String(err)}`;
}
