import type { z } from 'zod';
import { ValidationError } from '../errors/app-error';

export interface FieldIssue {
  field: string;
  message: string;
}

/**
 * Parses untrusted input with a zod schema. On failure throws a 400 VALIDATION_ERROR whose details
 * list every problem by field, so forms can show each message next to the right input.
 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues: FieldIssue[] = result.error.issues.map((issue) => ({
      field: issue.path.map(String).join('.'),
      message: issue.message,
    }));
    throw new ValidationError(issues[0]?.message ?? 'The request is invalid.', { issues });
  }
  return result.data;
}
