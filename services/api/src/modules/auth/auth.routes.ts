import { Router, type RequestHandler } from 'express';
import type { AuthController } from './auth.controller';

/** POST /auth/login — public (it is how a token is obtained), rate limited. */
export function createPublicAuthRouter(controller: AuthController, loginRateLimiter: RequestHandler): Router {
  const router = Router();
  router.post('/auth/login', loginRateLimiter, controller.login);
  return router;
}

/** GET /auth/me — any signed-in role. Mounted behind authenticate. */
export function createAuthRouter(controller: AuthController): Router {
  const router = Router();
  router.get('/auth/me', controller.me);
  return router;
}
