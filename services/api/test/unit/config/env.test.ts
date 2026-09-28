import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfigError, loadConfig, loadEnvFileIfPresent, parseDuration } from '../../../src/config/env';

const VALID_URL = 'postgres://afb:afb@localhost:5433/advanced_faculty_booking';
const SECRET = 'a-perfectly-good-secret-of-32-chars!!';
const minimal = { DATABASE_URL: VALID_URL, JWT_SECRET: SECRET };

describe('loadConfig', () => {
  it('applies defaults when only DATABASE_URL is provided', () => {
    const config = loadConfig(minimal);

    expect(config).toEqual({
      env: 'development',
      host: '0.0.0.0',
      port: 4000,
      database: { url: VALID_URL, poolMax: 10 },
      corsOrigins: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'],
      logLevel: 'debug',
      bcryptCost: 12,
      auth: { jwtSecret: SECRET, tokenTtlSeconds: 28_800, loginRateLimit: { max: 10, windowMs: 900_000 } },
      trustProxy: false,
      appointmentSweepIntervalMs: 60_000,
    });
  });

  it('reads and coerces every variable', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '8080',
      DATABASE_URL: 'postgresql://user:pw@db:5432/app',
      DATABASE_POOL_MAX: '25',
      CORS_ORIGINS: ' https://a.example , ,https://b.example ',
      LOG_LEVEL: 'warn',
      BCRYPT_COST: '10',
      JWT_SECRET: SECRET,
      JWT_EXPIRES_IN: '30m',
      LOGIN_RATE_LIMIT_MAX: '5',
      LOGIN_RATE_LIMIT_WINDOW: '1h',
      TRUST_PROXY: 'true',
      APPOINTMENT_SWEEP_INTERVAL: '30s',
    });

    expect(config).toEqual({
      env: 'production',
      host: '127.0.0.1',
      port: 8080,
      database: { url: 'postgresql://user:pw@db:5432/app', poolMax: 25 },
      corsOrigins: ['https://a.example', 'https://b.example'],
      logLevel: 'warn',
      bcryptCost: 10,
      auth: { jwtSecret: SECRET, tokenTtlSeconds: 1800, loginRateLimit: { max: 5, windowMs: 3_600_000 } },
      trustProxy: true,
      appointmentSweepIntervalMs: 30_000,
    });
  });

  it.each([
    ['development', 'debug'],
    ['test', 'silent'],
    ['production', 'info'],
  ] as const)('defaults the log level for %s to %s', (nodeEnv, level) => {
    expect(loadConfig({ ...minimal, NODE_ENV: nodeEnv }).logLevel).toBe(level);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadConfig({ JWT_SECRET: SECRET })).toThrow(ConfigError);
  });

  it('rejects a non-PostgreSQL DATABASE_URL with a clear message', () => {
    expect(() => loadConfig({ ...minimal, DATABASE_URL: 'mysql://root@localhost/db' })).toThrow(
      /DATABASE_URL: must be a postgres:\/\/ or postgresql:\/\/ URL/,
    );
  });

  it('reports every invalid variable at once', () => {
    let caught: unknown;
    try {
      loadConfig({ JWT_SECRET: SECRET, DATABASE_URL: 'not a url', PORT: '70000', NODE_ENV: 'staging' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    const error = caught as ConfigError;
    expect(error.name).toBe('ConfigError');
    expect(error.issues).toHaveLength(3);
    expect(error.message).toMatch(/^Invalid environment configuration:/);
    expect(error.message).toMatch(/PORT:/);
    expect(error.message).toMatch(/NODE_ENV:/);
  });
});

describe('authentication settings', () => {
  it('requires a JWT secret of at least 32 characters', () => {
    expect(() => loadConfig({ DATABASE_URL: VALID_URL })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ DATABASE_URL: VALID_URL, JWT_SECRET: 'short' })).toThrow(
      /at least 32 characters/,
    );
  });

  it('refuses the example secret in production but allows it locally', () => {
    const example = {
      DATABASE_URL: VALID_URL,
      JWT_SECRET: 'change-me-local-development-secret-at-least-32-chars',
    };
    expect(loadConfig(example).auth.jwtSecret).toBe(example.JWT_SECRET);
    expect(() => loadConfig({ ...example, NODE_ENV: 'production' })).toThrow(
      /must not be used in production/,
    );
  });

  it('rejects malformed durations with a helpful message', () => {
    expect(() => loadConfig({ ...minimal, JWT_EXPIRES_IN: '8 hours' })).toThrow(
      /JWT_EXPIRES_IN: Invalid duration "8 hours"/,
    );
  });

  it.each([
    ['45s', 45],
    ['30m', 1800],
    ['8h', 28_800],
    ['2d', 172_800],
    [' 5m ', 300],
  ])('parses duration %s as %i seconds', (value, seconds) => {
    expect(parseDuration(value)).toBe(seconds);
  });

  it.each([
    ['1', true],
    ['0', false],
    ['false', false],
  ])('reads TRUST_PROXY=%s as %p', (value, expected) => {
    expect(loadConfig({ ...minimal, TRUST_PROXY: value }).trustProxy).toBe(expected);
  });
});

describe('loadEnvFileIfPresent', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'afb-env-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns false and loads nothing when the file does not exist', () => {
    const loader = jest.fn();

    expect(loadEnvFileIfPresent(path.join(dir, '.env'), loader)).toBe(false);
    expect(loader).not.toHaveBeenCalled();
  });

  it('loads the file when it exists', () => {
    const file = path.join(dir, '.env');
    writeFileSync(file, 'AFB_TEST_VARIABLE=from-file\n');
    const loader = jest.fn();

    expect(loadEnvFileIfPresent(file, loader)).toBe(true);
    expect(loader).toHaveBeenCalledWith(file);
  });

  it("uses Node's built-in loader by default, without overriding variables already set", () => {
    // Jest sandboxes process.env, so exercise the real default loader in a child Node process.
    const file = path.join(dir, '.env');
    writeFileSync(file, 'AFB_TEST_FRESH=from-file\nAFB_TEST_PRESET=from-file\n');
    const script = [
      "const { loadEnvFileIfPresent } = require('./src/config/env');",
      `const loaded = loadEnvFileIfPresent(${JSON.stringify(file)});`,
      'console.log(JSON.stringify({ loaded, fresh: process.env.AFB_TEST_FRESH, preset: process.env.AFB_TEST_PRESET }));',
    ].join('\n');

    const child = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], {
      cwd: path.resolve(__dirname, '../../..'),
      env: { ...process.env, AFB_TEST_PRESET: 'from-environment' },
      encoding: 'utf8',
    });

    expect(child.stderr).toBe('');
    expect(JSON.parse(child.stdout)).toEqual({
      loaded: true,
      fresh: 'from-file',
      preset: 'from-environment',
    });
  });
});
