import { types } from 'pg';

/** PostgreSQL type OIDs (from pg_type). */
const INT8_OID = 20;
const DATE_OID = 1082;

/**
 * bigint (int8) → number. node-postgres returns int8 as a string by default because it can exceed
 * Number.MAX_SAFE_INTEGER. Our ids and counts never do, so we convert — and fail loudly instead of
 * silently losing precision if one ever did.
 */
export function parseBigInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`bigint value ${value} exceeds the safe integer range`);
  }
  return parsed;
}

/**
 * date → 'YYYY-MM-DD' string, unchanged. The default parser builds a JavaScript Date at local
 * midnight, which shifts the calendar day when later serialised as UTC (a real bug in the previous
 * implementation). A calendar date has no time zone, so it stays a string.
 */
export function parseDate(value: string): string {
  return value;
}

let installed = false;

/** Registers the parsers once per process (node-postgres type parsers are global). */
export function installTypeParsers(): void {
  if (installed) {
    return;
  }
  types.setTypeParser(INT8_OID, parseBigInt);
  types.setTypeParser(DATE_OID, parseDate);
  installed = true;
}
