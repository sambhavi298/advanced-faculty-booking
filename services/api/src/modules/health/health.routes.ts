import { Router } from 'express';
import type { HealthController } from './health.controller';

/**
 * Public, unauthenticated probes (the only unauthenticated routes besides login):
 *   GET /health        liveness  — used by Docker's HEALTHCHECK
 *   GET /health/ready  readiness — also verifies PostgreSQL is reachable and >= 18
 */
export function createHealthRouter(controller: HealthController): Router {
  const router = Router();
  router.get('/health', controller.live);
  router.get('/health/ready', controller.ready);
  return router;
}
