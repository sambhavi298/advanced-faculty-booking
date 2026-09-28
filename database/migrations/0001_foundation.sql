-- =============================================================================
-- 0001 · Foundation: extensions, enumerated types, time helpers
-- =============================================================================
-- Every later migration builds on the objects defined here.

-- btree_gist lets a GiST index combine scalar equality (faculty_id =) with range
-- overlap (slot &&). Exclusion constraints and PostgreSQL 18 temporal
-- `WITHOUT OVERLAPS` constraints on (id, range) pairs need it.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- pg_trgm provides trigram GIN indexes so "search faculty by name" (ILIKE '%rao%')
-- can use an index instead of scanning every user.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Show timestamps in campus time for anyone inspecting the database with psql.
-- No function relies on this setting: every conversion below names the zone explicitly,
-- so results are identical whatever the server or session time zone is.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Kolkata');
END
$$;

-- -----------------------------------------------------------------------------
-- Enumerated types: a closed set of values enforced by the type system itself.
-- -----------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('STUDENT', 'FACULTY', 'ADMIN');

CREATE TYPE appointment_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED');

CREATE TYPE exception_kind AS ENUM ('LEAVE', 'MEETING', 'BLOCKED');

CREATE TYPE notification_kind AS ENUM (
  'APPOINTMENT_REQUESTED',
  'APPOINTMENT_APPROVED',
  'APPOINTMENT_REJECTED',
  'APPOINTMENT_CANCELLED'
);

-- -----------------------------------------------------------------------------
-- timerange: a range type over time-of-day.
-- PostgreSQL ships ranges for numbers, dates and timestamps but not for `time`.
-- Weekly schedules ("Mondays 14:00–16:00") are time-of-day intervals, so we define
-- one. The subtype_diff function lets GiST indexes on it split pages efficiently.
-- -----------------------------------------------------------------------------
CREATE FUNCTION time_subtype_diff(x time, y time)
RETURNS float8
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT EXTRACT(EPOCH FROM (x - y))::float8 $$;

CREATE TYPE timerange AS RANGE (subtype = time, subtype_diff = time_subtype_diff);

COMMENT ON TYPE timerange IS 'Half-open time-of-day interval, e.g. [14:00,16:00). Used for weekly schedules.';

-- -----------------------------------------------------------------------------
-- Time helpers
-- -----------------------------------------------------------------------------
CREATE FUNCTION campus_timezone()
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT 'Asia/Kolkata'::text $$;

COMMENT ON FUNCTION campus_timezone() IS
  'The single place the campus time zone is defined. Weekly schedules are local times in this zone.';

-- Converts a local campus date + time-of-day into an absolute instant.
CREATE FUNCTION campus_timestamp(p_day date, p_time time)
RETURNS timestamptz
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT (p_day + p_time) AT TIME ZONE campus_timezone() $$;

-- The clock every time-dependent business rule reads.
-- In production it is simply now(). Tests pin it with `SET LOCAL app.now = '…'`
-- so rules such as "cannot book in the past" are verified deterministically.
-- The API never sets app.now.
CREATE FUNCTION app_now()
RETURNS timestamptz
LANGUAGE sql STABLE
AS $$ SELECT coalesce(nullif(current_setting('app.now', true), '')::timestamptz, now()) $$;

COMMENT ON FUNCTION app_now() IS
  'Business-rule clock: now(), unless a test pins it with the app.now setting.';

-- How far ahead students may book.
CREATE FUNCTION booking_horizon()
RETURNS interval
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT interval '30 days' $$;

-- Generic trigger function: keep updated_at current on every UPDATE.
CREATE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
