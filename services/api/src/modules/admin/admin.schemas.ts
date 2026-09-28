import { z } from 'zod';
import { APPOINTMENT_STATUSES } from '../../domain/enums';

const search = z
  .string()
  .trim()
  .max(60, 'Search for at most 60 characters.')
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const positiveId = (message: string) => z.coerce.number({ error: message }).int(message).positive(message);

export const PeopleQuerySchema = z.object({
  search,
  batchId: positiveId('Unknown batch.').optional(),
});

export const UserIdSchema = z.object({ id: positiveId('That is not a valid user id.') });

export const UserStatusSchema = z.object({
  isActive: z.boolean({ error: 'Send isActive: true or false.' }),
});

export const AppointmentFilterSchema = z
  .object({
    status: z.enum(APPOINTMENT_STATUSES, { error: 'Unknown status.' }).optional(),
    facultyId: positiveId('Unknown faculty member.').optional(),
    search,
    from: z.iso.date('Use a date such as 2026-10-05.').optional(),
    to: z.iso.date('Use a date such as 2026-10-05.').optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((filter) => filter.from === undefined || filter.to === undefined || filter.from <= filter.to, {
    message: '"from" must not be after "to".',
    path: ['to'],
  });

export const AuditFilterSchema = z.object({
  table: z
    .string()
    .regex(/^[a-z_]{1,63}$/, 'Unknown table name.')
    .optional(),
  action: z
    .enum(['INSERT', 'UPDATE', 'DELETE'], { error: 'Action must be INSERT, UPDATE or DELETE.' })
    .optional(),
  actorId: positiveId('Unknown user.').optional(),
  recordId: z.string().trim().min(1).max(64).optional(),
  before: positiveId('Invalid page cursor.').optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const ReportQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month such as 2026-10.')
    .optional(),
});
