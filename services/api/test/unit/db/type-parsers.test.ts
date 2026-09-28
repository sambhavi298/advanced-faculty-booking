import { types } from 'pg';
import { installTypeParsers, parseBigInt, parseDate } from '../../../src/db/type-parsers';

describe('type parsers', () => {
  it('parses bigint strings into numbers', () => {
    expect(parseBigInt('42')).toBe(42);
    expect(parseBigInt('-7')).toBe(-7);
  });

  it('refuses bigint values that would lose precision', () => {
    expect(() => parseBigInt('9007199254740993')).toThrow(RangeError);
  });

  it('keeps DATE values as calendar strings', () => {
    expect(parseDate('2030-01-07')).toBe('2030-01-07');
  });

  it('installs both parsers exactly once', () => {
    const spy = jest.spyOn(types, 'setTypeParser');
    installTypeParsers();
    installTypeParsers();
    expect(spy).toHaveBeenCalledTimes(2);
    const parserFor = (oid: number) => types.getTypeParser(oid) as (value: string) => unknown;
    expect(parserFor(20)('5')).toBe(5);
    expect(parserFor(1082)('2030-01-07')).toBe('2030-01-07');
    spy.mockRestore();
  });
});
