import type { Request, Response } from 'express';
import type { HealthService } from './health.service';

export class HealthController {
  constructor(private readonly service: HealthService) {}

  live = (_req: Request, res: Response): void => {
    res.json(this.service.liveness());
  };

  ready = async (_req: Request, res: Response): Promise<void> => {
    const readiness = await this.service.readiness();
    res.status(readiness.status === 'ready' ? 200 : 503).json(readiness);
  };
}
