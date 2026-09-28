import type { Queryable } from '../../db/types';

export interface DatabaseServerInfo {
  /** e.g. 180004 for PostgreSQL 18.4 — numeric, so version checks are simple comparisons. */
  versionNum: number;
  /** Human-readable version, e.g. "18.4". */
  version: string;
  /** Name of the connected database. */
  name: string;
}

export class HealthRepository {
  constructor(private readonly db: Queryable) {}

  /** Round-trips to PostgreSQL and reports which server we are connected to. */
  async getServerInfo(): Promise<DatabaseServerInfo> {
    const result = await this.db.query<{ version_num: number; version: string; name: string }>(
      `SELECT current_setting('server_version_num')::int AS version_num,
              current_setting('server_version')          AS version,
              current_database()                         AS name`,
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('PostgreSQL returned no row for the server-info query.');
    }
    return { versionNum: row.version_num, version: row.version, name: row.name };
  }
}
