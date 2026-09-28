import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AppConfig } from './config/env';
import type { Pool } from 'pg';
import type { Logger } from './lib/logger';
import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
import { createRequestLogger } from './middleware/request-logger';
import { createApiRouter } from './routes';

export interface AppDependencies {
  config: Pick<AppConfig, 'corsOrigins' | 'auth' | 'trustProxy'>;
  logger: Logger;
  db: Pool;
}

/** Maximum accepted JSON body. Our largest request (a weekly availability set) is a few KB. */
const JSON_BODY_LIMIT = '100kb';

/**
 * Builds the Express application without starting a server, so tests can drive it with Supertest.
 *
 * Middleware order matters:
 *   request logger (assigns request id) → security headers → CORS → JSON body → routes → 404 → error handler
 */
export function createApp({ config, logger, db }: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  // Behind a reverse proxy, take the client address from X-Forwarded-For (used by rate limiting).
  app.set('trust proxy', config.trustProxy);

  app.use(createRequestLogger(logger));
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use('/api', createApiRouter({ config, db, logger }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
