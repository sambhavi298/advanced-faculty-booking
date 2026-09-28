import { z } from 'zod';
import { ValidationError } from '../../../src/errors/app-error';
import { parseInput } from '../../../src/middleware/validate';

const Schema = z.object({
  name: z.string().min(2, 'Name is too short.'),
  age: z.number().int('Age must be a whole number.'),
  nested: z.object({ code: z.string('Code is required.') }),
});

describe('parseInput', () => {
  it('returns the parsed value', () => {
    expect(parseInput(Schema, { name: 'Priya', age: 20, nested: { code: 'X' } })).toEqual({
      name: 'Priya',
      age: 20,
      nested: { code: 'X' },
    });
  });

  it('throws a ValidationError listing every issue by field', () => {
    let caught: unknown;
    try {
      parseInput(Schema, { name: 'P', age: 1.5, nested: {} });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const error = caught as ValidationError;
    expect(error.message).toBe('Name is too short.');
    expect(error.details).toEqual({
      issues: [
        { field: 'name', message: 'Name is too short.' },
        { field: 'age', message: 'Age must be a whole number.' },
        { field: 'nested.code', message: 'Code is required.' },
      ],
    });
  });

  it('falls back to a generic message if a schema fails without describing why', () => {
    const silentFailure = {
      safeParse: () => ({ success: false, error: { issues: [] } }),
    } as unknown as z.ZodType;
    expect(() => parseInput(silentFailure, 1)).toThrow('The request is invalid.');
  });
});
