# Testing

The project has **588 automated tests** at five levels. Every level runs against the real thing it tests: SQL
tests run against PostgreSQL 18, HTTP tests go through the real Express app and a real database, and the
end-to-end tests drive real browsers through all three portals. Nothing that matters is mocked.

| Level                  | Where                                                                  | Tool                             | Tests | What it proves                                                                                 |
| ---------------------- | ---------------------------------------------------------------------- | -------------------------------- | ----: | ---------------------------------------------------------------------------------------------- |
| Unit                   | `services/api/test/unit`                                               | Jest                             |   194 | Config parsing, error mapping, JWT, bcrypt, middleware, services with fake repositories        |
| SQL                    | `services/api/test/integration/sql`, `…/database-error…`               | Jest + node-postgres             |   118 | Constraints, triggers, functions, views, audit, concurrency — straight against PostgreSQL      |
| Database tooling       | `services/api/test/integration/db`                                     | Jest                             |    26 | Migrator (checksums, advisory lock), seeder (bcrypt only), transactions and retries            |
| HTTP                   | `services/api/test/integration/**/*.http.test.ts`, `bootstrap.test.ts` | Jest + Supertest                 |   111 | Every endpoint: auth, roles, validation, status codes, error bodies, race conditions over HTTP |
| Client & UI components | `packages/api-client/test`, `packages/ui/test`, `apps/*/test`          | Vitest + Testing Library + jsdom |   132 | The typed client, shared components, auth flow and every page of the three portals             |
| End to end             | `e2e/tests`                                                            | Playwright (Chromium)            |     7 | Whole journeys across portals, including the simultaneous-booking demo in two real browsers    |

(API: 449 = 194 unit + 255 integration. Front end: api-client 31, ui 42, student 19, faculty 23, admin 17.)

## Running the tests

```bash
npm run check           # format → lint → type-check → all unit/SQL/HTTP/UI tests with coverage → build
npm test                # the same tests without coverage
npm run test:coverage   # with coverage thresholds enforced
npm run test:e2e        # end-to-end (see below)
```

`npm test` and `npm run check` need PostgreSQL running (`npm run db:up`) and `services/api/.env`. The integration
project's global setup **rebuilds the test database** (`advanced_faculty_booking_test`: drop schema → migrate →
seed with bcrypt cost 4) once per run, so every run starts from the same state. The development database is
never touched.

### End-to-end tests

```bash
npx playwright install chromium   # once per machine (downloads the browser)
npm run test:e2e
```

Playwright starts its own copy of the stack on separate ports, so a running development setup is not
disturbed: the API on :4100 (against the rebuilt test database) and the three portals on :5273, :5274 and
:5275. An HTML report is written to `e2e/playwright-report`; on failure, screenshots and a trace are kept in
`e2e/test-results` (`npx playwright show-trace <trace.zip>`).

| Spec                             | Journey                                                                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-sign-in`                     | Each portal accepts its own accounts; wrong password and wrong portal are refused with clear messages; deep links survive login                                                          |
| `02-appointment-lifecycle`       | Student books (with validation) → faculty approves with a note → student sees "Meet at …" and a notification → admin finds it in monitoring and the audit trail names the faculty member |
| `03-double-booking`              | Two browsers submit the same slot at the same moment: exactly one is booked; the other is told the slot was just taken and shown fresh slots                                             |
| `04-leave-releases-appointments` | Faculty records leave over a booked slot → "1 appointment was released" → the student sees it declined with the reason                                                                   |
| `05-account-deactivation`        | Admin deactivates the student → the student's open session ends on the next click → login refused → reactivation restores access; the audit trail names the admin                        |

## Coverage

Coverage thresholds are enforced by `npm run test:coverage` (and therefore by `npm run check`):

| Package               | Statements | Branches | Functions | Lines | Threshold (stmts/branches/funcs/lines) |
| --------------------- | ---------: | -------: | --------: | ----: | -------------------------------------- |
| `services/api`        |       100% |     100% |      100% |  100% | 100 / 95 / 100 / 100                   |
| `packages/api-client` |       100% |     100% |      100% |  100% | 100 / 95 / 100 / 100                   |
| `packages/ui`         |       100% |      95% |      100% |  100% | 100 / 90 / 100 / 100                   |
| `apps/student`        |       100% |      97% |      100% |  100% | 100 / 90 / 100 / 100                   |
| `apps/faculty`        |       100% |     100% |      100% |  100% | 100 / 90 / 100 / 100                   |
| `apps/admin`          |       100% |      98% |      100% |  100% | 100 / 90 / 100 / 100                   |

Excluded from coverage, deliberately: `server.ts` and `db/cli.ts` (thin process entry points, exercised by the
E2E run), type-only files, and each portal's `main.tsx` (one `createRoot().render()` call). The few uncovered
front-end branches are `??` fallbacks for values the API contract guarantees.

## The tests that matter most for an Advanced SQL review

**Double booking, naive versus constraint** — `test/integration/sql/concurrency.sql.test.ts`

1. _A naive "check, then insert" lets every student book the same slot._ In a scratch schema, a table without
   the constraint is used the way a basic DBMS project would: four connections each run
   `SELECT count(*) … WHERE slot && $1`, all find nothing (a barrier makes them all check before anyone
   inserts), and all four `INSERT` — the slot is quadruple-booked. Correct-looking application code is wrong
   under concurrency.
2. _The exclusion constraint admits exactly one of four simultaneous requests._ With
   `EXCLUDE USING gist (faculty_id WITH =, slot WITH &&) WHERE (status IN ('PENDING','APPROVED'))`, the same
   four concurrent transactions produce one row and three `23P01` errors. A barrier releases all four at the
   same instant, so the test really is concurrent.

**The same race over HTTP** — `appointments.http.test.ts › four students, one slot, same instant`: four logged-in
students `POST /api/appointments` for one slot in parallel; exactly one `201`, three `409 SLOT_CONFLICT`.

**Two decisions racing on one request** — `appointments.http.test.ts › two simultaneous decisions…`: approve and
reject arrive together; `SELECT … FOR UPDATE` serialises them, so one wins and the other gets
`409 INVALID_STATUS_TRANSITION`.

**Business rules in the database** — `appointments.sql.test.ts`, `schedules.sql.test.ts`, `free-slots.sql.test.ts`:
each custom SQLSTATE (AB001–AB008) is triggered directly with SQL (slot in the past, not an offered slot,
faculty teaching, student in class, illegal status transition, immutable fields, beyond the booking horizon,
leave that already ended), proving the rules hold even for writes that bypass the API. `WITHOUT OVERLAPS`
temporal keys reject overlapping availability windows and class timetables.

**Audit** — `audit.sql.test.ts`: every insert/update/delete on the nine audited tables writes exactly one audit
row in the same transaction; a rolled-back change leaves no audit row; the actor comes from
`set_config('app.user_id', …)`; password hashes never reach the log; `UPDATE`, `DELETE` and `TRUNCATE` on
`audit_logs` are rejected (append-only). The seed test orders with `COLLATE "C"` so it gives the same result on
`C.UTF-8` and `en_US.UTF-8` databases.

**Reporting** — `reporting.sql.test.ts` and `admin.http.test.ts`: the materialized view's `RANK()`, `LAG()` and
running `SUM()` columns, and `REFRESH MATERIALIZED VIEW CONCURRENTLY` through `POST /api/admin/reports/refresh`.

## Making time deterministic

Scheduling depends on "now". SQL tests pin the business clock with
`SELECT set_config('app.now', '2030-01-07T09:00:00+05:30', true)`; every rule reads `app_now()`, which returns
that value when set and `now()` otherwise. The tests therefore use a fixed Monday whose timetable is known
(see `test/helpers/sql.ts`) and never depend on the day they run. HTTP and E2E tests use the real clock and ask
the API for currently free slots, exactly as the portals do. All times are campus time (Asia/Kolkata); the
front-end formatters are tested to give identical output on every ICU version (browsers, Node on Windows).

## Isolation

- SQL tests run inside a transaction that is always rolled back (`withRollback`), so they cannot affect each
  other. Tests that need real concurrency use separate connections and clean up after themselves.
- HTTP suites delete the appointments and notifications they created in `afterEach`.
- Jest runs the API tests serially (`--runInBand`) because they share one database; Vitest runs the front-end
  tests in parallel (no shared state).
- Collation: the whole API suite has also been run against an `en_US.UTF-8` test database (the Docker default)
  as well as `C.UTF-8`, so text ordering never makes a test machine-dependent.
