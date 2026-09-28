import type { NotificationList } from '@afb/types';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate';
import { parseInput } from '../../middleware/validate';
import type { NotificationRepository } from './notification.repository';

const ListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

/** Notifications are per user and need no business rules beyond ownership, so the controller talks to the repository directly. */
export class NotificationController {
  constructor(private readonly repository: NotificationRepository) {}

  /** GET /api/notifications */
  list = async (req: Request, res: Response): Promise<void> => {
    const { limit } = parseInput(ListQuerySchema, req.query);
    const body: NotificationList = await this.repository.list(requireAuth(req).userId, limit);
    res.json(body);
  };

  /** POST /api/notifications/read — marks every notification of the caller as read. */
  markAllRead = async (req: Request, res: Response): Promise<void> => {
    const marked = await this.repository.markAllRead(requireAuth(req).userId);
    res.json({ marked, unread: 0 });
  };
}

/** Any signed-in role. Mounted behind authenticate. */
export function createNotificationRouter(controller: NotificationController): Router {
  const router = Router();
  router.get('/notifications', controller.list);
  router.post('/notifications/read', controller.markAllRead);
  return router;
}
