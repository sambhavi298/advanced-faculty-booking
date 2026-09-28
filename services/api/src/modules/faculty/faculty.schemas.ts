import { z } from 'zod';
import { EXCEPTION_KINDS } from '../../domain/enums';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** 'HH:MM' → minutes since midnight. */
export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time such as 14:30.');

export const FacultyIdSchema = z.object({
  id: z.coerce
    .number({ error: 'That is not a valid faculty id.' })
    .int()
    .positive('That is not a valid faculty id.'),
});

export const FacultyListQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(60, 'Search for at most 60 characters.')
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  department: z
    .string()
    .regex(/^[A-Za-z]{2,10}$/, 'Unknown department code.')
    .optional(),
});

export const DateRangeQuerySchema = z.object({
  from: z.iso.date('Use a date such as 2026-10-05.').optional(),
  to: z.iso.date('Use a date such as 2026-10-05.').optional(),
});

const WindowSchema = z
  .object({
    dayOfWeek: z
      .number()
      .int()
      .min(1, 'Day must be 1 (Monday) to 7 (Sunday).')
      .max(7, 'Day must be 1 (Monday) to 7 (Sunday).'),
    startTime: time,
    endTime: time,
  })
  .superRefine((window, ctx) => {
    const start = minutesOf(window.startTime);
    const end = minutesOf(window.endTime);
    if (start % 5 !== 0 || end % 5 !== 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Times must be on a 5-minute boundary (e.g. 14:05, 14:10).',
        path: ['startTime'],
      });
    } else if (end <= start) {
      ctx.addIssue({
        code: 'custom',
        message: 'The end time must be after the start time.',
        path: ['endTime'],
      });
    }
    // With 24-hour times on a 5-minute grid the latest possible end is 23:55, which is also the
    // database's faculty_availability_same_day limit, so a window never crosses midnight.
  });

export const ReplaceAvailabilitySchema = z.object({
  windows: z
    .array(WindowSchema, { error: 'Send the list of weekly windows.' })
    .max(50, 'At most 50 weekly windows.')
    .superRefine((windows, ctx) => {
      // Friendly early check; the database's WITHOUT OVERLAPS constraint remains the final guard.
      const sorted = windows
        .map((window, index) => ({
          ...window,
          index,
          start: minutesOf(window.startTime),
          end: minutesOf(window.endTime),
        }))
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.start - b.start);
      for (let i = 1; i < sorted.length; i += 1) {
        const previous = sorted[i - 1] as (typeof sorted)[number];
        const current = sorted[i] as (typeof sorted)[number];
        if (previous.dayOfWeek === current.dayOfWeek && current.start < previous.end) {
          ctx.addIssue({
            code: 'custom',
            message: `Windows on ${DAY_NAMES[current.dayOfWeek - 1] as string} overlap (${previous.startTime}–${previous.endTime} and ${current.startTime}–${current.endTime}).`,
            path: [current.index],
          });
        }
      }
    }),
});

const MAX_EXCEPTION_MS = 31 * 86_400_000;

export const CreateExceptionSchema = z
  .object({
    kind: z.enum(EXCEPTION_KINDS, { error: 'Choose leave, meeting or blocked.' }),
    startsAt: z.iso.datetime({ offset: true, error: 'Choose when it starts.' }),
    endsAt: z.iso.datetime({ offset: true, error: 'Choose when it ends.' }),
    reason: z
      .string()
      .trim()
      .max(300, 'The reason must be at most 300 characters.')
      .optional()
      .transform((value) => (value === '' ? undefined : value)),
  })
  .superRefine((input, ctx) => {
    const span = Date.parse(input.endsAt) - Date.parse(input.startsAt);
    if (span <= 0) {
      ctx.addIssue({ code: 'custom', message: 'The end must be after the start.', path: ['endsAt'] });
    } else if (span > MAX_EXCEPTION_MS) {
      ctx.addIssue({ code: 'custom', message: 'An exception can last at most 31 days.', path: ['endsAt'] });
    }
  });

export const ExceptionIdSchema = z.object({
  exceptionId: z.coerce
    .number({ error: 'That is not a valid exception id.' })
    .int()
    .positive('That is not a valid exception id.'),
});
