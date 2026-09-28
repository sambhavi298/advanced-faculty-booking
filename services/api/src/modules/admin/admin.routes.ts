import { Router } from 'express';
import { authorize } from '../../middleware/authenticate';
import type { AdminController } from './admin.controller';

/** Mounted behind authenticate; every admin route requires the ADMIN role. */
export function createAdminRouter(controller: AdminController): Router {
  const router = Router();
  router.use('/admin', authorize('ADMIN'));
  router.get('/admin/dashboard', controller.dashboard);
  router.get('/admin/students', controller.students);
  router.get('/admin/faculty', controller.faculty);
  router.get('/admin/departments', controller.departments);
  router.patch('/admin/users/:id/status', controller.setUserStatus);
  router.get('/admin/appointments', controller.appointments);
  router.get('/admin/audit', controller.audit);
  router.get('/admin/reports', controller.reports);
  router.post('/admin/reports/refresh', controller.refreshReports);
  return router;
}
