import { existsSync } from 'node:fs';
import { z } from 'zod';

/**
 * Runtime configuration, validated once at startup.
 *
 * Why validate here instead of reading `process.env` ad hoc: a missing or malformed variable
 * (e.g. a typo in DATABASE_URL) should stop the process immediately with a precise message,
 * not surface later as a confusing connection error on the first request.
 */

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type NodeEnv = 'development' | 'test' | 'production';

const commaSeparatedList = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
);

/** '8h', '30m', '1d', '3600s' → seconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (match === null) {
    throw new Error(`Invalid duration "${value}": use a number followed by s, m, h or d (e.g. 8h)`);
  }
  const unitSeconds = { s: 1, m: 60, h: 3600, d: 86_400 } as const;
  return Number(match[1]) * unitSeconds[match[2] as keyof typeof unitSeconds];
}

const duration = z.string().transform((value, ctx) => {
  try {
    return parseDuration(value);
  } catch (err) {
    ctx.addIssue({ code: 'custom', message: (err as Error).message });
    return z.NEVER;
  }
});

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((value) => value === 'true' || value === '1');

/** The placeholder shipped in .env.example — acceptable locally, refused in production. */
export const EXAMPLE_JWT_SECRET_MARKER = 'change-me';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// or postgresql:// URL' }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  CORS_ORIGINS: commaSeparatedList.default([
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
  ]),
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters (use a long random value)'),
  JWT_EXPIRES_IN: duration.default(8 * 3600),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(10),
  LOGIN_RATE_LIMIT_WINDOW: duration.default(15 * 60),
  TRUST_PROXY: booleanFlag,
  APPOINTMENT_SWEEP_INTERVAL: duration.default(60),
});

export interface DatabaseConfig {
  url: string;
  poolMax: number;
}

export interface AppConfig {
  env: NodeEnv;
  host: string;
  port: number;
  database: DatabaseConfig;
  corsOrigins: string[];
  logLevel: LogLevel;
  /** bcrypt cost factor for newly hashed passwords (seed data, future password changes). */
  bcryptCost: number;
  auth: AuthConfig;
  /** Honour X-Forwarded-For (only when the API sits behind a reverse proxy, e.g. in Docker). */
  trustProxy: boolean;
  /** How often elapsed appointments are completed / expired (process_elapsed_appointments()). */
  appointmentSweepIntervalMs: number;
}

export interface AuthConfig {
  jwtSecret: string;
  tokenTtlSeconds: number;
  /** Failed-or-not login attempts allowed per client and login id within the window. */
  loginRateLimit: { max: number; windowMs: number };
}

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

const DEFAULT_LOG_LEVEL: Record<NodeEnv, LogLevel> = {
  development: 'debug',
  test: 'silent',
  production: 'info',
};

/** Parses and validates configuration from an environment object (defaults to `process.env`). */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`),
    );
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.JWT_SECRET.includes(EXAMPLE_JWT_SECRET_MARKER)) {
    throw new ConfigError([
      'JWT_SECRET: the example secret from .env.example must not be used in production',
    ]);
  }
  return {
    env: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    database: { url: env.DATABASE_URL, poolMax: env.DATABASE_POOL_MAX },
    corsOrigins: env.CORS_ORIGINS,
    logLevel: env.LOG_LEVEL ?? DEFAULT_LOG_LEVEL[env.NODE_ENV],
    bcryptCost: env.BCRYPT_COST,
    auth: {
      jwtSecret: env.JWT_SECRET,
      tokenTtlSeconds: env.JWT_EXPIRES_IN,
      loginRateLimit: { max: env.LOGIN_RATE_LIMIT_MAX, windowMs: env.LOGIN_RATE_LIMIT_WINDOW * 1000 },
    },
    trustProxy: env.TRUST_PROXY,
    appointmentSweepIntervalMs: env.APPOINTMENT_SWEEP_INTERVAL * 1000,
  };
}

/**
 * Loads a `.env` file into `process.env` when it exists (Node's built-in loader — no dotenv dependency).
 * Variables already present in the real environment win, so Docker/CI settings are never overridden.
 * Returns whether a file was loaded.
 */
export function loadEnvFileIfPresent(
  filePath: string,
  loader: (path: string) => void = process.loadEnvFile.bind(process),
): boolean {
  if (!existsSync(filePath)) {
    return false;
  }
  loader(filePath);
  return true;
}
