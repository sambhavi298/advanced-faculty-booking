# Entity–Relationship Diagram

The diagram reflects the schema created by `database/migrations/0001`–`0007`. Column-level constraints,
indexes and the reasoning behind them are in [`DATABASE_DESIGN.md`](DATABASE_DESIGN.md).

```mermaid
erDiagram
  departments ||--o{ batches : "has"
  departments ||--o{ faculty : "employs"
  users ||--o| students : "is (role = STUDENT)"
  users ||--o| faculty : "is (role = FACULTY)"
  batches ||--o{ students : "contains"
  batches ||--o{ batch_schedule : "attends"
  faculty ||--o{ batch_schedule : "teaches"
  faculty ||--o{ faculty_availability : "offers"
  faculty ||--o{ faculty_schedule_exceptions : "is unavailable during"
  students ||--o{ appointments : "requests"
  faculty ||--o{ appointments : "receives"
  users ||--o{ appointments : "cancelled_by"
  users ||--o{ notifications : "receives"
  appointments ||--o{ notifications : "about"

  departments {
    integer id PK
    text code UK "e.g. CSE"
    text name UK
  }
  batches {
    integer id PK
    integer department_id FK
    text name "Batch 1"
    smallint year_of_study "1-5"
    text academic_year "2026-2027"
  }
  users {
    bigint id PK
    text login_id UK "RA… / FAC… / ADMIN…"
    text full_name
    user_role role "STUDENT | FACULTY | ADMIN"
    text password_hash "bcrypt only (CHECK)"
    boolean is_active
    timestamptz last_login_at
  }
  students {
    bigint user_id PK "FK (user_id, role) → users"
    user_role role "always STUDENT"
    integer batch_id FK
  }
  faculty {
    bigint user_id PK "FK (user_id, role) → users"
    user_role role "always FACULTY"
    integer department_id FK
    text designation
    text office_location "staff room"
    smallint slot_minutes "10-60"
  }
  batch_schedule {
    bigint id PK
    integer batch_id FK
    bigint faculty_id FK "nullable: who teaches"
    text course_code
    text course_title
    smallint day_of_week "ISO 1-7"
    time start_time
    time end_time
    timerange during "STORED generated"
  }
  faculty_availability {
    bigint id PK
    bigint faculty_id FK
    smallint day_of_week "ISO 1-7"
    time start_time
    time end_time
    timerange during "STORED generated"
    integer duration_minutes "VIRTUAL generated (PG 18)"
  }
  faculty_schedule_exceptions {
    bigint id PK
    bigint faculty_id FK
    exception_kind kind "LEAVE | MEETING | BLOCKED"
    tstzrange period "[start, end)"
    text reason
  }
  appointments {
    uuid id PK "uuidv7()"
    bigint student_id FK
    bigint faculty_id FK
    tstzrange slot "[start, end)"
    text purpose
    appointment_status status
    text decision_note
    timestamptz decided_at
    timestamptz cancelled_at
    bigint cancelled_by FK
    timestamptz completed_at
  }
  notifications {
    uuid id PK "uuidv7()"
    bigint user_id FK
    uuid appointment_id FK
    notification_kind kind
    text title
    text body
    timestamptz read_at
  }
  audit_logs {
    bigint id PK
    timestamptz occurred_at "BRIN indexed"
    xid8 transaction_id
    bigint actor_user_id "no FK: history outlives users"
    user_role actor_role
    text table_name
    text record_id
    text action "INSERT | UPDATE | DELETE"
    jsonb old_data
    jsonb new_data
    text_array changed_fields
  }
```

`audit_logs` has no relationship lines on purpose: it records changes to every other table generically
(by table name and record id) and must keep its history even after the rows it describes are deleted.

## Relationship notes

| Relationship                       | Cardinality      | Enforced by                                                                                                                                                                                                    |
| ---------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| user → student / faculty           | 1 : 0..1         | Composite FK `(user_id, role) → users (id, role)` plus `CHECK (role = 'STUDENT')` (or `'FACULTY'`). A student row can only attach to a STUDENT user; a user's role cannot change while the subtype row exists. |
| department → batches, faculty      | 1 : N            | FK `ON DELETE RESTRICT` — a department in use cannot be deleted.                                                                                                                                               |
| batch → students, batch_schedule   | 1 : N            | FK; deleting a batch removes its timetable (`CASCADE`) but is blocked while students belong to it (`RESTRICT`).                                                                                                |
| faculty → batch_schedule           | 1 : N (optional) | Nullable FK `ON DELETE SET NULL` — a class survives if its teacher's account is removed.                                                                                                                       |
| faculty → availability, exceptions | 1 : N            | FK `ON DELETE CASCADE`.                                                                                                                                                                                        |
| student / faculty → appointments   | 1 : N            | FK `ON DELETE RESTRICT` — appointment history is never silently deleted.                                                                                                                                       |
| appointment → notifications        | 1 : N            | FK `ON DELETE CASCADE`.                                                                                                                                                                                        |

## Entities that are not tables

| Object                   | Kind              | Purpose                                                                                                  |
| ------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------- |
| `appointment_details`    | view              | Appointments joined with student, batch, faculty and department — the shape every list endpoint returns. |
| `faculty_monthly_report` | materialized view | Monthly statistics per faculty member with window-function rankings (admin Reports).                     |
| `schema_migrations`      | table (tooling)   | Which migration files have been applied, with checksums.                                                 |
