import { PassThrough } from 'node:stream';
import { createCliLogger, formatLogLine } from '../../../src/db/cli-logger';

describe('CLI logger', () => {
  it('prints the message followed by key=value fields', () => {
    const line = JSON.stringify({
      level: 30,
      time: 1,
      pid: 2,
      hostname: 'h',
      service: 'afb-api',
      msg: 'Applied migration',
      migration: '0001_foundation.sql',
      ms: 12,
    });
    expect(formatLogLine(line)).toBe('Applied migration  migration=0001_foundation.sql ms=12\n');
  });

  it('prefixes warnings and errors, and serialises non-string values', () => {
    expect(formatLogLine(JSON.stringify({ level: 40, msg: 'Careful' }))).toBe('WARN  Careful\n');
    expect(formatLogLine(JSON.stringify({ level: 50, msg: 'Broken', counts: { a: 1 } }))).toBe(
      'ERROR Broken  counts={"a":1}\n',
    );
  });

  it('writes formatted lines to the given stream', () => {
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

    createCliLogger(output).info({ ok: true }, 'Done');

    expect(chunks.join('')).toBe('Done  ok=true\n');
  });

  it('defaults to stdout', () => {
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    createCliLogger().info('Hello');
    expect(write).toHaveBeenCalledWith('Hello\n');
    write.mockRestore();
  });
});
