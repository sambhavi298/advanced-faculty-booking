import type { Request, Response } from 'express';
import type { ApiErrorBody } from '@afb/types';
import { requestIdOf } from './request-logger';

/** Any request that matched no route gets a JSON 404 in the standard error envelope (never HTML). */
export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `No route matches ${req.method} ${req.path}.`,
      requestId: requestIdOf(req),
    },
  };
  res.status(404).json(body);
}
