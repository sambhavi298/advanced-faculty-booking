import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';
import { createApp } from './app';
import type { AppConfig } from './config/env';
import { createPool } from './db/pool';
import { startElapsedAppointmentsJob } from './jobs/elapsed-appointments.job';
import type { Logger } from './lib/logger';
import { AppointmentRepository } from './modules/appointments/appointment.repository';

export interface RunningServer {
  server: Server;
  pool: Pool;
  port: number;
  /** Stops accepting connections, waits for in-flight requests, then closes the pool. Idempotent. */
  close(): Promise<void>;
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

/** Wires pool → app → HTTP server and starts listening. */
export async function startServer(
  config: Pick<
    AppConfig,
    'host' | 'port' | 'database' | 'corsOrigins' | 'auth' | 'trustProxy' | 'appointmentSweepIntervalMs'
  >,
  logger: Logger,
): Promise<RunningServer> {
  const pool = createPool(config.database, logger);
  const app = createApp({ config, logger, db: pool });
  const server = createServer(app);

  try {
    await listen(server, config.port, config.host);
  } catch (err) {
    await pool.end();
    throw err;
  }

  const { port } = server.address() as AddressInfo;
  logger.info({ host: config.host, port }, 'API listening');
  const stopSweep = startElapsedAppointmentsJob(
    new AppointmentRepository(pool),
    logger,
    config.appointmentSweepIntervalMs,
  );

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      stopSweep();
      await closeServer(server);
      await pool.end();
      logger.info('API stopped');
    })();
    return closing;
  };

  return { server, pool, port, close };
}

export interface SignalSource {
  once(event: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown;
}

/**
 * Graceful shutdown on SIGINT (Ctrl+C) and SIGTERM (`docker stop`): finish in-flight requests,
 * release database connections, then exit.
 */
export function installShutdownHandlers(
  running: Pick<RunningServer, 'close'>,
  logger: Logger,
  exit: (code: number) => void,
  signals: SignalSource = process,
): void {
  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'Shutting down');
    running.close().then(
      () => {
        exit(0);
      },
      (err: unknown) => {
        logger.error({ err }, 'Error during shutdown');
        exit(1);
      },
    );
  };
  signals.once('SIGINT', shutdown);
  signals.once('SIGTERM', shutdown);
}
