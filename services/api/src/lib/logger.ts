import { pino, type DestinationStream, type Logger } from 'pino';
import type { AppConfig } from '../config/env';

export type { Logger } from 'pino';

/**
 * Structured JSON logging (pino). In development `npm run dev` pipes output through
 * pino-pretty for readability; in production the raw JSON goes to stdout for the container runtime.
 *
 * Secrets never reach the log: the Authorization header, cookies and any `password`/`token`
 * field are redacted before serialisation.
 */
export function createLogger(config: Pick<AppConfig, 'logLevel'>, destination?: DestinationStream): Logger {
  return pino(
    {
      level: config.logLevel,
      base: { service: 'afb-api' },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'password',
          '*.password',
          'token',
          '*.token',
          'passwordHash',
          '*.passwordHash',
        ],
        censor: '[REDACTED]',
      },
    },
    destination,
  );
}
