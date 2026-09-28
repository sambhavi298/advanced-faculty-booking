import { Router } from 'express';
import type { Pool } from 'pg';
import type { AppConfig } from './config/env';
import type { Logger } from './lib/logger';
import { TokenService } from './lib/tokens';
import { createAuthenticate } from './middleware/authenticate';
import { createLoginRateLimiter } from './middleware/login-rate-limit';
import { AppointmentController } from './modules/appointments/appointment.controller';
import { AppointmentRepository } from './modules/appointments/appointment.repository';
import { createAppointmentRouter } from './modules/appointments/appointment.routes';
import { AppointmentService } from './modules/appointments/appointment.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthRepository } from './modules/auth/auth.repository';
import { createAuthRouter, createPublicAuthRouter } from './modules/auth/auth.routes';
import { AuthService } from './modules/auth/auth.service';
import { FacultyController } from './modules/faculty/faculty.controller';
import { FacultyRepository } from './modules/faculty/faculty.repository';
import { createFacultyRouter } from './modules/faculty/faculty.routes';
import { FacultyService } from './modules/faculty/faculty.service';
import { HealthController } from './modules/health/health.controller';
import { HealthRepository } from './modules/health/health.repository';
import { createHealthRouter } from './modules/health/health.routes';
import { HealthService } from './modules/health/health.service';

export interface RouteDependencies {
  config: Pick<AppConfig, 'auth'>;
  db: Pool;
  logger: Logger;
}

/**
 * Composition root for the `/api` surface: builds each module's Repository → Service → Controller
 * chain and mounts its router.
 *
 * Security is default-deny: only the routers mounted ABOVE `authenticate` are public (health probes
 * and login). Every router mounted below it — including every module added in later phases —
 * requires a valid token, without anyone having to remember to add the middleware.
 */
export function createApiRouter({ config, db, logger }: RouteDependencies): Router {
  const api = Router();

  const tokens = new TokenService(config.auth.jwtSecret, config.auth.tokenTtlSeconds);
  const authRepository = new AuthRepository(db);
  const auth = new AuthController(new AuthService(authRepository, db, tokens));
  const health = new HealthController(new HealthService(new HealthRepository(db), logger));
  const appointments = new AppointmentController(new AppointmentService(new AppointmentRepository(db), db));
  const faculty = new FacultyController(new FacultyService(new FacultyRepository(db), db));

  // ---- Public -------------------------------------------------------------------------------
  api.use(createHealthRouter(health));
  api.use(createPublicAuthRouter(auth, createLoginRateLimiter(config.auth.loginRateLimit)));

  // ---- Everything below requires a valid JWT -------------------------------------------------
  api.use(createAuthenticate(tokens, authRepository));
  api.use(createAuthRouter(auth));
  api.use(createAppointmentRouter(appointments));
  api.use(createFacultyRouter(faculty));

  return api;
}
