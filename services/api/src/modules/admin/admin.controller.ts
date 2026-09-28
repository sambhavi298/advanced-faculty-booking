import type { Request, Response } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { parseInput } from '../../middleware/validate';
import {
  AppointmentFilterSchema,
  AuditFilterSchema,
  PeopleQuerySchema,
  ReportQuerySchema,
  UserIdSchema,
  UserStatusSchema,
} from './admin.schemas';
import type { AdminService } from './admin.service';

export class AdminController {
  constructor(private readonly service: AdminService) {}

  /** GET /api/admin/dashboard */
  dashboard = async (_req: Request, res: Response): Promise<void> => {
    res.json(await this.service.dashboard());
  };

  /** GET /api/admin/students?search=&batchId= */
  students = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.students(parseInput(PeopleQuerySchema, req.query)));
  };

  /** GET /api/admin/faculty?search= */
  faculty = async (req: Request, res: Response): Promise<void> => {
    const { search } = parseInput(PeopleQuerySchema, req.query);
    res.json(await this.service.faculty({ ...(search === undefined ? {} : { search }) }));
  };

  /** GET /api/admin/departments */
  departments = async (_req: Request, res: Response): Promise<void> => {
    res.json(await this.service.departments());
  };

  /** PATCH /api/admin/users/:id/status { isActive } */
  setUserStatus = async (req: Request, res: Response): Promise<void> => {
    const { id } = parseInput(UserIdSchema, req.params);
    const { isActive } = parseInput(UserStatusSchema, req.body);
    res.json(await this.service.setUserStatus(requireAuth(req), id, isActive));
  };

  /** GET /api/admin/appointments?status=&facultyId=&search=&from=&to=&limit=&offset= */
  appointments = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.appointments(parseInput(AppointmentFilterSchema, req.query)));
  };

  /** GET /api/admin/audit?table=&action=&actorId=&recordId=&before=&limit= */
  audit = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.audit(parseInput(AuditFilterSchema, req.query)));
  };

  /** GET /api/admin/reports?month=YYYY-MM */
  reports = async (req: Request, res: Response): Promise<void> => {
    const { month } = parseInput(ReportQuerySchema, req.query);
    res.json(await this.service.reports(month));
  };

  /** POST /api/admin/reports/refresh */
  refreshReports = async (_req: Request, res: Response): Promise<void> => {
    res.json(await this.service.refreshReports());
  };
}
