import type { Request, Response } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { parseInput } from '../../middleware/validate';
import { LoginSchema } from './auth.schemas';
import type { AuthService } from './auth.service';

export class AuthController {
  constructor(private readonly service: AuthService) {}

  /** POST /api/auth/login */
  login = async (req: Request, res: Response): Promise<void> => {
    const input = parseInput(LoginSchema, req.body);
    res.json(await this.service.login(input));
  };

  /** GET /api/auth/me */
  me = async (req: Request, res: Response): Promise<void> => {
    res.json(await this.service.me(requireAuth(req).userId));
  };
}
