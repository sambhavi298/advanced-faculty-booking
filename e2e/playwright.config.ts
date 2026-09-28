import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive real browsers against the real stack, started here on their own ports so they
 * never touch a running development setup:
 *
 *   API       http://localhost:4100  (test database, rebuilt from migrations + seed before the run)
 *   Student   http://localhost:5273
 *   Faculty   http://localhost:5274
 *   Admin     http://localhost:5275
 *
 * Prerequisites: PostgreSQL running (`npm run db:up`), services/api/.env present, and a browser
 * (`npx playwright install chromium` once). Run with `npm run test:e2e` from the repository root.
 */
export const API_PORT = 4100;
export const PORTS = { student: 5273, faculty: 5274, admin: 5275 } as const;

const database =
  process.env.E2E_DATABASE_URL ?? 'postgres://afb:afb@127.0.0.1:5433/advanced_faculty_booking_test';
// Lets a machine with its own Chromium build (e.g. a CI image) use it instead of Playwright's download.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: './tests',
  // The specs share one database and one clock, so they run one at a time, in file order.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1366, height: 900 },
    launchOptions: executablePath === undefined ? {} : { executablePath },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      // Rebuild the test database, then serve the API against it.
      command: 'npm run db:fresh && npx tsx src/server.ts',
      cwd: '../services/api',
      port: API_PORT,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        DATABASE_URL: database,
        LOG_LEVEL: 'warn',
        LOGIN_RATE_LIMIT_MAX: '1000',
        BCRYPT_COST: '4',
      },
    },
    ...Object.entries(PORTS).map(([portal, port]) => ({
      command: `npx vite --port ${String(port)} --strictPort`,
      cwd: `../apps/${portal}`,
      port,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { API_URL: `http://localhost:${String(API_PORT)}` },
    })),
  ],
});
