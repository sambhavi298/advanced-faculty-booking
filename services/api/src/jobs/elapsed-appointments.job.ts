import type { Logger } from '../lib/logger';

export interface ElapsedAppointmentsSweeper {
  processElapsed(): Promise<{ completed: number; expired: number }>;
}

/**
 * Once a minute (and once at start-up), move appointments whose time has passed to their final state
 * by calling process_elapsed_appointments() in PostgreSQL: ended approved meetings become COMPLETED,
 * unanswered requests whose start time arrived become REJECTED (expired). Failures are logged and
 * retried on the next tick; they never crash the API. Returns a function that stops the job.
 */
export function startElapsedAppointmentsJob(
  sweeper: ElapsedAppointmentsSweeper,
  logger: Logger,
  intervalMs: number,
): () => void {
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) {
      return; // the previous sweep is still in progress
    }
    running = true;
    try {
      const { completed, expired } = await sweeper.processElapsed();
      if (completed + expired > 0) {
        logger.info({ completed, expired }, 'Processed elapsed appointments');
      }
    } catch (err) {
      logger.error({ err }, 'Elapsed-appointment sweep failed');
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
