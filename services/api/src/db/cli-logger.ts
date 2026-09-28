import { Writable } from 'node:stream';
import { createLogger, type Logger } from '../lib/logger';

/**
 * A logger for the database command line: the same pino logger the API uses, rendered as plain
 * readable lines ("Applied migration  migration=0001_foundation.sql ms=42") instead of JSON.
 * No pino-pretty and no shell pipe, so the command's exit code is preserved on every OS.
 */
export function formatLogLine(line: string): string {
  const {
    level,
    msg,
    time: _time,
    service: _service,
    pid: _pid,
    hostname: _hostname,
    ...fields
  } = JSON.parse(line) as Record<string, unknown>;
  const prefix =
    typeof level === 'number' && level >= 50
      ? 'ERROR '
      : typeof level === 'number' && level >= 40
        ? 'WARN  '
        : '';
  const extras = Object.entries(fields)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
  return `${prefix}${String(msg)}${extras === '' ? '' : `  ${extras}`}\n`;
}

export function createCliLogger(output: NodeJS.WritableStream = process.stdout): Logger {
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      output.write(formatLogLine(chunk.toString()));
      callback();
    },
  });
  return createLogger({ logLevel: 'info' }, destination);
}
