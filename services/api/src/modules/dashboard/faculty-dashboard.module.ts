import type { FacultyDashboard } from '@afb/types';
import { Router, type Request, type Response } from 'express';
import { authorize, requireAuth } from '../../middleware/authenticate';
import type { AppointmentRepository } from '../appointments/appointment.repository';
import type { FacultyDashboardRepository } from './faculty-dashboard.repository';

const LIST_LIMIT = 5;
const CHART_WEEKS = 8;

export class FacultyDashboardService {
  constructor(
    private readonly repository: FacultyDashboardRepository,
    private readonly appointments: AppointmentRepository,
  ) {}

  /** Everything on the faculty home screen; the independent queries run in parallel on the pool. */
  async load(facultyId: number): Promise<FacultyDashboard> {
    const [faculty, counts, today, pending, upcoming, response, weekly, recent] = await Promise.all([
      this.repository.profile(facultyId),
      this.repository.counts(facultyId),
      this.repository.today(facultyId),
      this.appointments.pendingForFaculty(facultyId),
      this.repository.upcoming(facultyId, LIST_LIMIT),
      this.repository.responseStats(facultyId),
      this.repository.weekly(facultyId, CHART_WEEKS),
      this.repository.recent(facultyId, LIST_LIMIT),
    ]);
    return {
      faculty,
      counts,
      today,
      pending: pending.slice(0, LIST_LIMIT),
      upcoming,
      stats: { ...response, weekly },
      recent,
    };
  }
}

export class FacultyDashboardController {
  constructor(private readonly service: FacultyDashboardService) {}

  /** GET /api/faculty/dashboard */
  show = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.load(requireAuth(req).userId));
  };
}

/** GET /faculty/dashboard — faculty only. */
export function createFacultyDashboardRouter(controller: FacultyDashboardController): Router {
  const router = Router();
  router.get('/faculty/dashboard', authorize('FACULTY'), controller.show);
  return router;
}
