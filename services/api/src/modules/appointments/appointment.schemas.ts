import { z } from 'zod';
import { APPOINTMENT_STATUSES } from '../../domain/enums';

const optionalText = (field: string) =>
  z
    .string()
    .trim()
    .max(500, `${field} must be at most 500 characters.`)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

export const AppointmentIdSchema = z.object({
  id: z.uuid('That is not a valid appointment id.'),
});

export const CreateAppointmentSchema = z.object({
  facultyId: z.number({ error: 'Choose a faculty member.' }).int().positive('Choose a faculty member.'),
  startsAt: z.iso.datetime({ offset: true, error: 'Choose a time slot.' }),
  purpose: z
    .string({ error: 'Describe the purpose of the meeting.' })
    .trim()
    .min(10, 'Describe the purpose in at least 10 characters.')
    .max(500, 'The purpose must be at most 500 characters.'),
});

export const ApproveSchema = z.object({ note: optionalText('The note') }).default({ note: undefined });

export const ReasonSchema = z.object({ reason: optionalText('The reason') }).default({ reason: undefined });

export const ListMineQuerySchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES, { error: 'Unknown status.' }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
