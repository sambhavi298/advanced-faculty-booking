import type { IncomingMessage } from 'node:http';
import { levelForStatus, requestIdOf, resolveRequestId } from '../../../src/middleware/request-logger';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('keeps a safe caller-supplied id', () => {
    expect(resolveRequestId('demo-race.42_A')).toBe('demo-race.42_A');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['unsafe characters', 'abc\ninjected: log line'],
    ['too long', 'a'.repeat(129)],
    ['repeated header', ['one', 'two']],
  ])('generates a UUID when the supplied id is %s', (_label, incoming) => {
    expect(resolveRequestId(incoming)).toMatch(UUID);
  });
});

describe('levelForStatus', () => {
  it.each([
    [200, undefined, 'info'],
    [304, undefined, 'info'],
    [400, undefined, 'warn'],
    [499, undefined, 'warn'],
    [500, undefined, 'error'],
    [503, undefined, 'error'],
    [200, new Error('aborted'), 'error'],
  ])('status %i (error: %p) logs at %s', (status, err, level) => {
    expect(levelForStatus(status, err)).toBe(level);
  });
});

describe('requestIdOf', () => {
  it('returns string ids unchanged', () => {
    expect(requestIdOf({ id: 'abc' } as IncomingMessage)).toBe('abc');
  });

  it('serialises non-string ids', () => {
    expect(requestIdOf({ id: 7 } as IncomingMessage)).toBe('7');
  });
});
