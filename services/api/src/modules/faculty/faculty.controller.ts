import type { Request, Response } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { parseInput } from '../../middleware/validate';
import {
  CreateExceptionSchema,
  DateRangeQuerySchema,
  ExceptionIdSchema,
  FacultyIdSchema,
  FacultyListQuerySchema,
  ReplaceAvailabilitySchema,
} from './faculty.schemas';
import type { FacultyService } from './faculty.service';

export class FacultyController {
  constructor(private readonly service: FacultyService) {}

  /** GET /api/faculty?search=&department= */
  list = async (req: Request, res: Response): Promise<void> => {
    const filter = parseInput(FacultyListQuerySchema, req.query);
    res.json(await this.service.list(requireAuth(req), filter));
  };

  /** GET /api/faculty/:id/availability?from=&to= */
  availability = async (req: Request, res: Response): Promise<void> => {
    const { id } = parseInput(FacultyIdSchema, req.params);
    const range = parseInput(DateRangeQuerySchema, req.query);
    res.json(await this.service.availability(requireAuth(req), id, range));
  };

  /** GET /api/faculty/availability (faculty: own settings) */
  mine = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.mine(requireAuth(req)));
  };

  /** PUT /api/faculty/availability */
  replace = async (req: Request, res: Response): Promise<void> => {
    const { windows } = parseInput(ReplaceAvailabilitySchema, req.body);
    res.json(await this.service.replace(requireAuth(req), windows));
  };

  /** POST /api/faculty/availability/exceptions */
  addException = async (req: Request, res: Response): Promise<void> => {
    const input = parseInput(CreateExceptionSchema, req.body);
    res.status(201).json(await this.service.addException(requireAuth(req), input));
  };

  /** DELETE /api/faculty/availability/exceptions/:exceptionId */
  removeException = async (req: Request, res: Response): Promise<void> => {
    const { exceptionId } = parseInput(ExceptionIdSchema, req.params);
    await this.service.removeException(requireAuth(req), exceptionId);
    res.status(204).end();
  };
}
