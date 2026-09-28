import { z } from 'zod';
import { USER_ROLES } from '../../domain/enums';

export const LoginSchema = z.object({
  loginId: z
    .string({ error: 'Enter your login ID.' })
    .trim()
    .min(1, 'Enter your login ID.')
    .max(40, 'That login ID is too long.')
    .transform((value) => value.toUpperCase()),
  password: z
    .string({ error: 'Enter your password.' })
    .min(1, 'Enter your password.')
    .max(200, 'That password is too long.'),
  role: z.enum(USER_ROLES).optional(),
});
