// @ts-check
/**
 * Two Jest projects:
 *  - unit:        pure logic, no network, no database (fast, run on every save)
 *  - integration: real HTTP (Supertest) against a real PostgreSQL 18 database
 *
 * Type-checking is done separately by `npm run typecheck`; ts-jest only transpiles
 * (isolatedModules), which keeps the test run fast.
 */

/** @type {import('jest').Config} */
const shared = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
};

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    { ...shared, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.test.ts'] },
    {
      ...shared,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
      // Rebuilds the test database (reset → migrate → seed) once per run.
      globalSetup: '<rootDir>/test/integration/global-setup.ts',
    },
  ],
  coverageProvider: 'v8',
  // server.ts and db/cli.ts are thin process entry points; type-only modules emit no executable code.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/server.ts',
    '!src/db/cli.ts',
    '!src/**/types.ts',
    '!src/**/*.types.ts',
  ],
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageThreshold: {
    global: { statements: 100, functions: 100, lines: 100, branches: 95 },
  },
};
