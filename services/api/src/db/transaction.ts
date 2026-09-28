import type { UserRole } from '@afb/types';
import type { Pool, PoolClient } from 'pg';
import { isRetryableTransactionError } from '../errors/database-error';

export type IsolationLevel = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

/** The authenticated user a write is attributed to in audit_logs. */
export interface Actor {
  userId: number;
  role: UserRole;
}

export interface TransactionOptions {
  /** Defaults to READ COMMITTED, PostgreSQL's default. */
  isolationLevel?: IsolationLevel;
  /** Recorded by the audit trigger via the transaction-local settings app.user_id / app.user_role. */
  actor?: Actor;
  /** How many times to re-run the whole transaction after a serialization failure or deadlock. */
  maxRetries?: number;
  /** Pause before a retry, in milliseconds (grows linearly with the attempt number). */
  retryDelayMs?: number;
}

const BEGIN_STATEMENTS: Record<IsolationLevel, string> = {
  'READ COMMITTED': 'BEGIN ISOLATION LEVEL READ COMMITTED',
  'REPEATABLE READ': 'BEGIN ISOLATION LEVEL REPEATABLE READ',
  SERIALIZABLE: 'BEGIN ISOLATION LEVEL SERIALIZABLE',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `work` inside one database transaction on a dedicated connection.
 *
 * - COMMIT if `work` resolves, ROLLBACK if it throws; the connection always returns to the pool
 *   (or is discarded if even ROLLBACK failed, because its state is then unknown).
 * - With an `actor`, every audit row written in this transaction names that user.
 * - Serialization failures (40001) and deadlocks (40P01) are safe to retry from the start, so the
 *   whole unit of work is re-run up to `maxRetries` times. Anything else propagates immediately.
 */
export async function withTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const { isolationLevel = 'READ COMMITTED', actor, maxRetries = 2, retryDelayMs = 20 } = options;

  const run = async (attempt: number): Promise<T> => {
    const client = await pool.connect();
    let connectionBroken = false;
    try {
      await client.query(BEGIN_STATEMENTS[isolationLevel]);
      if (actor !== undefined) {
        await client.query(
          "SELECT set_config('app.user_id', $1, true), set_config('app.user_role', $2, true)",
          [String(actor.userId), actor.role],
        );
      }
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        connectionBroken = true;
      }
      if (attempt >= maxRetries || !isRetryableTransactionError(err)) {
        throw err;
      }
    } finally {
      client.release(connectionBroken);
    }
    // Only reached after a retryable failure: back off, then re-run the whole unit of work.
    await sleep(retryDelayMs * (attempt + 1));
    return run(attempt + 1);
  };

  return run(0);
}
