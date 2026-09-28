# Database (PostgreSQL 18)

- `migrations/` — ordered, forward-only SQL files (`0001_foundation.sql` … `0007_reporting.sql`). Applied by
  the API's migration runner, each inside its own transaction, recorded with a checksum in
  `schema_migrations`.
- `seeds/seed-data.json` — the initial data: one department, two batches with weekly timetables, faculty
  availability and the four login accounts. The seeder bcrypt-hashes the passwords during seeding; the
  database itself rejects anything that is not a bcrypt hash.

From the repository root: `npm run db:setup` (migrate + seed), `npm run db:status`, `npm run db:fresh`.

Design and rationale: [`docs/DATABASE_DESIGN.md`](../docs/DATABASE_DESIGN.md) ·
diagram: [`docs/ER_DIAGRAM.md`](../docs/ER_DIAGRAM.md).
