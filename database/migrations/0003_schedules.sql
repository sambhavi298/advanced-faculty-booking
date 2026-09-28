-- =============================================================================
-- 0003 · Schedules: class timetables, weekly faculty availability, exceptions
-- =============================================================================
-- Three sources decide whether a faculty member can meet a student at a given time:
--   batch_schedule               recurring weekly classes (a faculty member's teaching hours
--                                AND a student's class hours — one table serves both)
--   faculty_availability         recurring weekly windows when the faculty member meets students
--   faculty_schedule_exceptions  one-off absolute periods: leave, meetings, blocked time
--
-- Weekly rows store local time-of-day (campus time zone). Exceptions store absolute
-- instants (tstzrange) because they happen once, on specific dates.

CREATE TABLE batch_schedule (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id      integer NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  faculty_id    bigint REFERENCES faculty (user_id) ON DELETE SET NULL,
  course_code   text NOT NULL,
  course_title  text NOT NULL,
  session_type  text NOT NULL DEFAULT 'LECTURE',
  day_of_week   smallint NOT NULL,
  start_time    time NOT NULL,
  end_time      time NOT NULL,
  room          text,
  -- Derived once and stored so it can be indexed and used in the temporal constraint.
  during        timerange GENERATED ALWAYS AS (timerange(start_time, end_time, '[)')) STORED,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT batch_schedule_day_of_week_iso CHECK (day_of_week BETWEEN 1 AND 7),
  CONSTRAINT batch_schedule_time_order CHECK (start_time < end_time),
  CONSTRAINT batch_schedule_session_type_valid CHECK (session_type IN ('LECTURE', 'LAB', 'TUTORIAL')),
  CONSTRAINT batch_schedule_course_not_blank CHECK (btrim(course_code) <> '' AND btrim(course_title) <> ''),
  -- PostgreSQL 18 temporal constraint: one batch cannot have two classes at overlapping
  -- times on the same weekday. Back-to-back classes ([09:00,09:50) and [09:50,10:40)) are fine.
  CONSTRAINT batch_schedule_no_overlap UNIQUE (batch_id, day_of_week, during WITHOUT OVERLAPS)
);

COMMENT ON TABLE batch_schedule IS
  'Weekly class timetable per batch. faculty_id marks who teaches it, so it is also each faculty member''s teaching schedule.';
COMMENT ON COLUMN batch_schedule.day_of_week IS 'ISO weekday: 1 = Monday … 7 = Sunday.';

-- "Is faculty X teaching on weekday D during [t1,t2)?" — asked for every candidate slot.
CREATE INDEX batch_schedule_teaching_idx
  ON batch_schedule USING gist (faculty_id, day_of_week, during)
  WHERE faculty_id IS NOT NULL;

CREATE TRIGGER batch_schedule_set_updated_at
  BEFORE UPDATE ON batch_schedule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
CREATE TABLE faculty_availability (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  faculty_id        bigint NOT NULL REFERENCES faculty (user_id) ON DELETE CASCADE,
  day_of_week       smallint NOT NULL,
  start_time        time NOT NULL,
  end_time          time NOT NULL,
  during            timerange GENERATED ALWAYS AS (timerange(start_time, end_time, '[)')) STORED,
  -- PostgreSQL 18 virtual generated column: computed on read, never stored, never stale.
  duration_minutes  integer GENERATED ALWAYS AS ((EXTRACT(EPOCH FROM (end_time - start_time)) / 60)::integer) VIRTUAL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT faculty_availability_day_of_week_iso CHECK (day_of_week BETWEEN 1 AND 7),
  CONSTRAINT faculty_availability_time_order CHECK (start_time < end_time),
  -- Slots are generated from start_time, so windows sit on a 5-minute grid and end
  -- before midnight (a slot never spans two calendar days).
  CONSTRAINT faculty_availability_five_minute_grid CHECK (
        EXTRACT(SECOND FROM start_time) = 0
    AND EXTRACT(SECOND FROM end_time) = 0
    AND EXTRACT(MINUTE FROM start_time)::integer % 5 = 0
    AND EXTRACT(MINUTE FROM end_time)::integer % 5 = 0
  ),
  CONSTRAINT faculty_availability_same_day CHECK (end_time <= time '23:55'),
  -- PostgreSQL 18 temporal constraint: a faculty member's weekly windows never overlap.
  CONSTRAINT faculty_availability_no_overlap UNIQUE (faculty_id, day_of_week, during WITHOUT OVERLAPS)
);

COMMENT ON TABLE faculty_availability IS 'Recurring weekly windows in which a faculty member meets students (campus local time).';

CREATE TRIGGER faculty_availability_set_updated_at
  BEFORE UPDATE ON faculty_availability
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
CREATE TABLE faculty_schedule_exceptions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  faculty_id  bigint NOT NULL REFERENCES faculty (user_id) ON DELETE CASCADE,
  kind        exception_kind NOT NULL,
  period      tstzrange NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Finite, half-open [start, end) periods of at most 31 days.
  CONSTRAINT faculty_schedule_exceptions_period_valid CHECK (
        NOT isempty(period)
    AND NOT lower_inf(period)
    AND NOT upper_inf(period)
    AND lower_inc(period)
    AND NOT upper_inc(period)
  ),
  CONSTRAINT faculty_schedule_exceptions_max_length CHECK (upper(period) - lower(period) <= interval '31 days'),
  CONSTRAINT faculty_schedule_exceptions_reason_length CHECK (reason IS NULL OR char_length(reason) <= 300)
);

COMMENT ON TABLE faculty_schedule_exceptions IS
  'One-off unavailability (leave, meeting, blocked). Overlapping appointments are released automatically (see 0006).';

-- "Does faculty X have an exception overlapping [t1,t2)?"
CREATE INDEX faculty_schedule_exceptions_lookup_idx
  ON faculty_schedule_exceptions USING gist (faculty_id, period);
