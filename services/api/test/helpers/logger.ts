import { Writable } from 'node:stream';
import { createLogger, type Logger } from '../../src/lib/logger';

/** A logger that discards everything — for tests that do not assert on log output. */
export function silentLogger(): Logger {
  return createLogger({ logLevel: 'silent' });
}

/** A logger that captures every line as parsed JSON, for tests that assert on what was logged. */
export function capturingLogger(): { logger: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });
  return { logger: createLogger({ logLevel: 'trace' }, destination), lines };
}
