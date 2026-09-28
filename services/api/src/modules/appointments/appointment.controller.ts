import type { Request, Response } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { parseInput } from '../../middleware/validate';
import {
  AppointmentIdSchema,
  ApproveSchema,
  CreateAppointmentSchema,
  ListMineQuerySchema,
  ReasonSchema,
} from './appointment.schemas';
import type { AppointmentService } from './appointment.service';

export class AppointmentController {
  constructor(private readonly service: AppointmentService) {}

  /** POST /api/appointments (student) */
  create = async (req: Request, res: Response): Promise<void> => {
    const input = parseInput(CreateAppointmentSchema, req.body);
    res.status(201).json(await this.service.request(requireAuth(req), input));
  };

  /** GET /api/appointments/me (student or faculty) */
  listMine = async (req: Request, res: Response): Promise<void> => {
    const { status, limit } = parseInput(ListMineQuerySchema, req.query);
    res.json(await this.service.listMine(requireAuth(req), status, limit));
  };

  /** GET /api/faculty/pending (faculty) */
  pending = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.pending(requireAuth(req)));
  };

  /** PATCH /api/appointments/:id/cancel (student) */
  cancel = async (req: Request, res: Response): Promise<void> => {
    const { id } = parseInput(AppointmentIdSchema, req.params);
    const { reason } = parseInput(ReasonSchema, req.body);
    res.json(await this.service.cancel(requireAuth(req), id, reason));
  };

  /** PATCH /api/appointments/:id/approve (faculty) */
  approve = async (req: Request, res: Response): Promise<void> => {
    const { id } = parseInput(AppointmentIdSchema, req.params);
    const { note } = parseInput(ApproveSchema, req.body);
    res.json(await this.service.approve(requireAuth(req), id, note));
  };

  /** PATCH /api/appointments/:id/reject (faculty) */
  reject = async (req: Request, res: Response): Promise<void> => {
    const { id } = parseInput(AppointmentIdSchema, req.params);
    const { reason } = parseInput(ReasonSchema, req.body);
    res.json(await this.service.reject(requireAuth(req), id, reason));
  };
}
