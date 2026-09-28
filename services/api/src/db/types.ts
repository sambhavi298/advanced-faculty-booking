import type { QueryResult, QueryResultRow } from 'pg';

/**
 * The one capability every repository needs: run a parameterised query.
 *
 * Both `pg.Pool` and a checked-out `pg.PoolClient` satisfy this, so the same repository
 * method works standalone (pool) or inside a caller-controlled transaction (client).
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}
