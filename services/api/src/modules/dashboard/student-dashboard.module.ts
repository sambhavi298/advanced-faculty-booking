import type { StudentDashboard } from '@afb/types';
import { Router, type Request, type Response } from 'express';
import { authorize, requireAuth } from '../../middleware/authenticate';
import type { StudentDashboardRepository } from './student-dashboard.repository';

export class StudentDashboardService {
  constructor(private readonly repository: StudentDashboardRepository) {}

  /** Everything on the student's home screen, read in parallel from the database. */
  async load(studentId: number): Promise<StudentDashboard> {
    const [student, counts, upcoming, recent] = await Promise.all([
      this.repository.profile(studentId),
      this.repository.counts(studentId),
      this.repository.upcoming(studentId),
      this.repository.recent(studentId, 5),
    ]);
    return { student, counts, upcoming, recent };
  }
}

export class StudentDashboardController {
  constructor(private readonly service: StudentDashboardService) {}

  /** GET /api/student/dashboard */
  show = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.load(requireAuth(req).userId));
  };
}

export function createStudentDashboardRouter(controller: StudentDashboardController): Router {
  const router = Router();
  router.get('/student/dashboard', authorize('STUDENT'), controller.show);
  return router;
}
