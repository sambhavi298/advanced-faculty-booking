import type { AuthContext } from '../lib/tokens';

/**
 * `req.auth` is set by the authenticate middleware from a verified JWT and is the only source of
 * the caller's identity anywhere in the API.
 */
declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}
