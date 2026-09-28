import { Router } from 'express';
import { authorize } from '../../middleware/authenticate';
import type { AppointmentController } from './appointment.controller';

/** Mounted behind authenticate; each route names the roles allowed to call it. */
export function createAppointmentRouter(controller: AppointmentController): Router {
  const router = Router();
  router.post('/appointments', authorize('STUDENT'), controller.create);
  router.get('/appointments/me', authorize('STUDENT', 'FACULTY'), controller.listMine);
  router.patch('/appointments/:id/cancel', authorize('STUDENT'), controller.cancel);
  router.patch('/appointments/:id/approve', authorize('FACULTY'), controller.approve);
  router.patch('/appointments/:id/reject', authorize('FACULTY'), controller.reject);
  router.get('/faculty/pending', authorize('FACULTY'), controller.pending);
  return router;
}
