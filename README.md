# Advanced Faculty Booking

Faculty Appointment Booking System for SRM Institute of Science and Technology — an
**Advanced SQL & Modern Database Features** project. Students book appointments with faculty, faculty
manage availability and approve requests, and an admin monitors the system. PostgreSQL 18 is the core of
the application: it enforces the booking rules, prevents double booking under concurrency, computes free
slots, audits every important change and powers the reports.

## Build status

The project is built in ten phases; each phase ends with a green build, lint, type-check and test run.

| Phase | Scope                                                                                      | Status  |
| ----- | ------------------------------------------------------------------------------------------ | ------- |
| 1     | Architecture & folder creation — monorepo, API skeleton, health checks, error model, tests | ✅ Done |
| 2     | Database & migrations — schema, constraints, functions, triggers, views, seed              | ✅ Done |
| 3     | Authentication — login, JWT, role guards, API client                                       | ✅ Done |
| 4     | Appointment system — booking, approval, cancellation, double-booking prevention            | ✅ Done |
| 5     | Faculty availability — weekly windows, exceptions, free-slot search                        | ✅ Done |
| 6     | Student portal — dashboard, faculty search, slot booking, my appointments, notifications   | ✅ Done |
| 7     | Faculty portal — dashboard & statistics, request decisions, office hours, leave, history   | ✅ Done |
| 8     | Admin portal — live SQL dashboard, people, departments, monitoring, audit trail, reports   | ✅ Done |
| 9     | Testing hardening — Playwright end-to-end journeys, testing guide                          | ✅ Done |
| 10    | Documentation & deployment — one-command Docker Compose, EXPLAIN ANALYZE, project report   | ✅ Done |

## Run everything with one command (Docker)

With Docker Desktop running:

```bash
docker compose up --build
```

Then open the **student portal** at <http://localhost:8081>, the **faculty portal** at <http://localhost:8082>
and the **admin portal** at <http://localhost:8083>. PostgreSQL 18, the API (which migrates and seeds the
database on first start) and the three portals run in five containers. Details and settings:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

The rest of this README is the development setup (hot reload, tests).

## Prerequisites

- **Node.js 22.12 or newer** (LTS) and npm 10+ — check with `node -v`
- **PostgreSQL 18**, either:
  - **Docker Desktop** (recommended): `npm run db:up` starts PostgreSQL 18 on port **5433**, or
  - a local PostgreSQL 18 install — create a `afb` role and the two databases yourself (see below).

## Getting started

```bash
# 1. Install all workspaces
npm install

# 2. Start PostgreSQL 18 (Docker Desktop must be running)
npm run db:up

# 3. Configure the API
#    Windows (PowerShell):  Copy-Item services/api/.env.example services/api/.env
#    macOS / Linux:         cp services/api/.env.example services/api/.env

# 4. Create the schema and load the initial data (safe to run again)
npm run db:setup

# 5. Run everything the CI would run: format check, lint, type-check, tests with coverage, build
npm run check

# 6. Start the API in watch mode (terminal 1)
npm run dev:api

# 7. Start the portals (one terminal each)
npm run dev:student   # http://localhost:5173
npm run dev:faculty   # http://localhost:5174
npm run dev:admin     # http://localhost:5175
```

Open <http://localhost:4000/api/health/ready> — you should see
`{"status":"ready","database":{"reachable":true,"serverVersion":"18.x",…}}` — then open the student portal at
<http://localhost:5173> (sign in as Priya Sharma) the faculty portal at <http://localhost:5174> (sign in as
Prof. K. Rao) and the admin portal at <http://localhost:5175> (sign in as Amy). The portal forwards `/api` to the API, so the browser
only ever talks to one origin.

### Demo accounts (created by the seed)

| Portal  | Name          | Login ID         | Password       |
| ------- | ------------- | ---------------- | -------------- |
| Student | Priya Sharma  | `RA221100301001` | `Password123!` |
| Faculty | Prof. K. Rao  | `FAC200`         | `Password123!` |
| Faculty | Prof. S. Iyer | `FAC201`         | `Password123!` |
| Admin   | Amy           | `ADMIN001`       | `Admin123!`    |

Only bcrypt hashes of these passwords are stored; the database rejects anything else.

### Using a local PostgreSQL 18 instead of Docker

```sql
CREATE ROLE afb LOGIN PASSWORD 'afb';
CREATE DATABASE advanced_faculty_booking OWNER afb;
CREATE DATABASE advanced_faculty_booking_test OWNER afb;
```

Then set `DATABASE_URL` and `TEST_DATABASE_URL` in `services/api/.env` to your server's port
(usually 5432).

## Scripts (run from the repository root)

| Command                                        | What it does                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run dev:api`                              | API on <http://localhost:4000> with reload on save and readable logs       |
| `npm run dev:student`                          | Student portal on <http://localhost:5173> (hot reload, `/api` proxied)     |
| `npm run dev:faculty`                          | Faculty portal on <http://localhost:5174>                                  |
| `npm run dev:admin`                            | Admin portal on <http://localhost:5175>                                    |
| `npm run build`                                | Compile every workspace                                                    |
| `npm run typecheck`                            | TypeScript strict type-check of every workspace                            |
| `npm run lint`                                 | ESLint (type-aware rules) across the repository                            |
| `npm run format` / `format:check`              | Prettier write / verify                                                    |
| `npm test`                                     | All tests (unit + integration against PostgreSQL)                          |
| `npm run test:coverage`                        | Tests with coverage thresholds enforced (100 % statements/functions/lines) |
| `npm run test:e2e`                             | Playwright end-to-end journeys in Chromium (see docs/TESTING.md)           |
| `npm run check`                                | Everything above in CI order — must pass before every commit               |
| `npm run db:up` / `db:down` / `db:logs`        | Start / stop / follow the PostgreSQL 18 container                          |
| `npm run db:setup`                             | Apply pending migrations, then seed an empty database (safe to repeat)     |
| `npm run db:migrate` / `db:seed` / `db:status` | Each step on its own / list applied migrations                             |
| `npm run db:fresh`                             | Drop everything and rebuild from migrations + seed (refused in production) |
| `npm run docker:up` / `docker:down`            | Whole stack in Docker (`docker compose up --build -d` / `down`)            |

## Repository layout

```
advanced_faculty_booking/
├── services/
│   └── api/            REST API — Express 5, TypeScript, node-postgres
├── apps/
│   ├── student/        Student portal   (React 19, Vite, Tailwind CSS 4)
│   ├── faculty/        Faculty portal   (same stack)
│   └── admin/          Admin portal     (same stack)
├── packages/
│   ├── ui/             Shared design system
│   ├── api-client/     Typed Axios client with Bearer-token handling
│   └── types/          Shared API contracts
├── database/
│   ├── migrations/     Ordered SQL migrations
│   ├── seeds/          Initial data (bcrypt-hashed accounts)
│   └── benchmarks/     History generator + EXPLAIN ANALYZE script
├── e2e/                Playwright end-to-end tests (real browsers, all three portals)
├── docs/               Architecture, database design, API, testing, deployment, report
├── docker/             Container build files and PostgreSQL init scripts
└── docker-compose.yml
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — layers, request lifecycle, error model, auth design, where each business rule lives, technology decisions
- [Database design](docs/DATABASE_DESIGN.md) — tables, constraints, double-booking prevention, booking rules, triggers, audit, indexes, `EXPLAIN ANALYZE`, transactions
- [ER diagram](docs/ER_DIAGRAM.md)
- [API documentation](docs/API_DOCUMENTATION.md) — conventions, error codes, every endpoint with examples
- [Sequence diagrams](docs/SEQUENCE_DIAGRAM.md) — login, authenticated requests, simultaneous booking, racing decisions
- [Testing](docs/TESTING.md) — test levels, how to run them, coverage, the concurrency tests, E2E journeys
- [Deployment](docs/DEPLOYMENT.md) — Docker Compose, configuration, operations, production checklist
- [Project report](docs/PROJECT_REPORT.md) — problem, DBMS → Advanced SQL comparison, features, concurrency proof, performance, demo walkthrough
