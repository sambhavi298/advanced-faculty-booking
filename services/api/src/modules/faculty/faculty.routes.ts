import { Router } from 'express';
import { authorize } from '../../middleware/authenticate';
import type { FacultyController } from './faculty.controller';

/** Mounted behind authenticate. Fixed paths are declared before the `:id` path. */
export function createFacultyRouter(controller: FacultyController): Router {
  const router = Router();
  router.get('/faculty', authorize('STUDENT', 'FACULTY', 'ADMIN'), controller.list);
  router.get('/faculty/availability', authorize('FACULTY'), controller.mine);
  router.put('/faculty/availability', authorize('FACULTY'), controller.replace);
  router.post('/faculty/availability/exceptions', authorize('FACULTY'), controller.addException);
  router.delete(
    '/faculty/availability/exceptions/:exceptionId',
    authorize('FACULTY'),
    controller.removeException,
  );
  router.get('/faculty/:id/availability', authorize('STUDENT', 'FACULTY', 'ADMIN'), controller.availability);
  return router;
}
