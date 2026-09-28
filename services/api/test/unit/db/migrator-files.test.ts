import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseError } from 'pg';
import {
  checksumOf,
  describeFailure,
  lineAt,
  MigrationError,
  readMigrationFiles,
} from '../../../src/db/migrator';

describe('migration files', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'afb-migrations-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads .sql files in version order and ignores everything else', async () => {
    writeFileSync(path.join(dir, '0002_second.sql'), 'SELECT 2;');
    writeFileSync(path.join(dir, '0001_first.sql'), 'SELECT 1;');
    writeFileSync(path.join(dir, 'README.md'), '# notes');

    const files = await readMigrationFiles(dir);

    expect(files.map((file) => [file.version, file.name, file.fileName])).toEqual([
      ['0001', 'first', '0001_first.sql'],
      ['0002', 'second', '0002_second.sql'],
    ]);
    expect(files[0]!.sql).toBe('SELECT 1;');
    expect(files[0]!.checksum).toBe(checksumOf('SELECT 1;'));
  });

  it.each(['1_first.sql', '0001-first.sql', '0001_First.sql'])(
    'rejects the badly named file %s',
    async (name) => {
      writeFileSync(path.join(dir, name), 'SELECT 1;');
      await expect(readMigrationFiles(dir)).rejects.toThrow(MigrationError);
    },
  );

  it('rejects two files with the same version', async () => {
    writeFileSync(path.join(dir, '0001_a.sql'), 'SELECT 1;');
    writeFileSync(path.join(dir, '0001_b.sql'), 'SELECT 1;');
    await expect(readMigrationFiles(dir)).rejects.toThrow('Duplicate migration version 0001 (0001_b.sql)');
  });

  it('checksums ignore Windows line endings', () => {
    expect(checksumOf('SELECT 1;\r\nSELECT 2;\r\n')).toBe(checksumOf('SELECT 1;\nSELECT 2;\n'));
    expect(checksumOf('SELECT 1;')).not.toBe(checksumOf('SELECT 2;'));
  });

  it('converts a character position into a line number', () => {
    const sql = 'CREATE TABLE a ();\nCREATE TABLE b ();\nBROKEN;';
    expect(lineAt(sql, 1)).toBe(1);
    expect(lineAt(sql, sql.indexOf('BROKEN') + 1)).toBe(3);
    expect(lineAt(sql, 0)).toBe(1);
  });

  it('describes failures with the file name, line (when known) and message', () => {
    const file = { fileName: '0009_x.sql', sql: 'SELECT 1;\nSELEC 2;' };
    const withPosition = Object.assign(new DatabaseError('syntax error at or near "SELEC"', 0, 'error'), {
      position: '11',
    });

    expect(describeFailure(file, withPosition)).toBe(
      'Migration 0009_x.sql failed (line 2): syntax error at or near "SELEC"',
    );
    expect(describeFailure(file, new DatabaseError('deadlock', 0, 'error'))).toBe(
      'Migration 0009_x.sql failed: deadlock',
    );
    expect(describeFailure(file, new Error('Connection terminated'))).toBe(
      'Migration 0009_x.sql failed: Connection terminated',
    );
    expect(describeFailure(file, 'odd')).toBe('Migration 0009_x.sql failed: odd');
  });
});
