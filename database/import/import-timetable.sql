-- =============================================================================
-- Bulk timetable import from CSV (classes and/or faculty office hours).
--
--   psql "$DATABASE_URL" -f import-timetable.sql
--   psql "$DATABASE_URL" -v classes=my-classes.csv -v office=my-office-hours.csv -f import-timetable.sql
--   psql "$DATABASE_URL" -v office=none -f import-timetable.sql        (classes only)
--   psql "$DATABASE_URL" -v classes=none -f import-timetable.sql       (office hours only)
--   add  -v replace=off  to keep existing rows (default: the file replaces the timetable of every
--   batch / faculty member it mentions).
--
-- How it works: CSV -> TEMP staging tables of plain text -> every problem is collected (not just the
-- first) with its CSV line number -> if there is any, nothing is written -> otherwise one transaction
-- creates missing batches, replaces/inserts rows set-wise, and prints a summary. The final
-- WITHOUT OVERLAPS constraints remain the safety net.
-- =============================================================================
\set ON_ERROR_STOP on
\if :{?classes} \else \set classes classes.csv \endif
\if :{?office}  \else \set office office_hours.csv \endif
\if :{?replace} \else \set replace on \endif

BEGIN;

CREATE TEMP TABLE stg_classes (
  line int GENERATED ALWAYS AS IDENTITY,
  department_code text, academic_year text, year_of_study text, batch_name text,
  course_code text, course_title text, session_type text, day_of_week text,
  start_time text, end_time text, room text, faculty_login_id text
) ON COMMIT DROP;
CREATE TEMP TABLE stg_office (
  line int GENERATED ALWAYS AS IDENTITY,
  faculty_login_id text, day_of_week text, start_time text, end_time text
) ON COMMIT DROP;
CREATE TEMP TABLE import_errors (source text, line int, problem text) ON COMMIT DROP;

\if :{?classes} \else \endif
SELECT :'classes' <> 'none' AS do_classes, :'office' <> 'none' AS do_office \gset

\if :do_classes
  \set cmd '\\copy stg_classes (department_code,academic_year,year_of_study,batch_name,course_code,course_title,session_type,day_of_week,start_time,end_time,room,faculty_login_id) FROM ' :'classes' ' WITH (FORMAT csv, HEADER true)'
  :cmd
\endif
\if :do_office
  \set cmd '\\copy stg_office (faculty_login_id,day_of_week,start_time,end_time) FROM ' :'office' ' WITH (FORMAT csv, HEADER true)'
  :cmd
\endif

-- Normalise: trim every value, empty string -> NULL.
UPDATE stg_classes SET
  department_code = upper(nullif(btrim(department_code),'')), academic_year = nullif(btrim(academic_year),''),
  year_of_study = nullif(btrim(year_of_study),''), batch_name = nullif(btrim(batch_name),''),
  course_code = nullif(btrim(course_code),''), course_title = nullif(btrim(course_title),''),
  session_type = upper(coalesce(nullif(btrim(session_type),''),'LECTURE')),
  day_of_week = nullif(btrim(day_of_week),''), start_time = nullif(btrim(start_time),''),
  end_time = nullif(btrim(end_time),''), room = nullif(btrim(room),''),
  faculty_login_id = upper(nullif(btrim(faculty_login_id),''));
UPDATE stg_office SET
  faculty_login_id = upper(nullif(btrim(faculty_login_id),'')), day_of_week = nullif(btrim(day_of_week),''),
  start_time = nullif(btrim(start_time),''), end_time = nullif(btrim(end_time),'');

-- ---- Validation: shape (line numbers count the header as line 1, so data starts at 2) ----
INSERT INTO import_errors
SELECT 'classes', line + 1, p FROM stg_classes,
LATERAL (VALUES
  (CASE WHEN department_code IS NULL OR NOT EXISTS (SELECT 1 FROM departments d WHERE d.code = department_code)
        THEN 'unknown department_code "' || coalesce(department_code,'') || '"' END),
  (CASE WHEN academic_year IS NULL OR academic_year !~ '^\d{4}-\d{4}$' THEN 'academic_year must look like 2026-2027' END),
  (CASE WHEN year_of_study IS NULL OR year_of_study !~ '^[1-5]$' THEN 'year_of_study must be 1-5' END),
  (CASE WHEN batch_name IS NULL THEN 'batch_name is required' END),
  (CASE WHEN course_code IS NULL OR course_title IS NULL THEN 'course_code and course_title are required' END),
  (CASE WHEN session_type NOT IN ('LECTURE','LAB','TUTORIAL') THEN 'session_type must be LECTURE, LAB or TUTORIAL' END),
  (CASE WHEN day_of_week IS NULL OR day_of_week !~ '^[1-7]$' THEN 'day_of_week must be 1 (Monday) to 7 (Sunday)' END),
  (CASE WHEN start_time IS NULL OR start_time !~ '^([01]\d|2[0-3]):[0-5]\d$'
          OR end_time IS NULL OR end_time !~ '^([01]\d|2[0-3]):[0-5]\d$' THEN 'start_time and end_time must be HH:MM' END),
  (CASE WHEN faculty_login_id IS NOT NULL AND NOT EXISTS
             (SELECT 1 FROM users u WHERE u.login_id = faculty_login_id AND u.role = 'FACULTY')
        THEN 'unknown faculty "' || faculty_login_id || '"' END)
) AS v(p) WHERE p IS NOT NULL;

INSERT INTO import_errors
SELECT 'office_hours', line + 1, p FROM stg_office,
LATERAL (VALUES
  (CASE WHEN faculty_login_id IS NULL OR NOT EXISTS
             (SELECT 1 FROM users u WHERE u.login_id = faculty_login_id AND u.role = 'FACULTY')
        THEN 'unknown faculty "' || coalesce(faculty_login_id,'') || '"' END),
  (CASE WHEN day_of_week IS NULL OR day_of_week !~ '^[1-7]$' THEN 'day_of_week must be 1 (Monday) to 7 (Sunday)' END),
  (CASE WHEN start_time IS NULL OR start_time !~ '^([01]\d|2[0-3]):[0-5]\d$'
          OR end_time IS NULL OR end_time !~ '^([01]\d|2[0-3]):[0-5]\d$' THEN 'start_time and end_time must be HH:MM' END),
  (CASE WHEN start_time ~ '^\d\d:\d\d$' AND (right(start_time,2)::int % 5 <> 0 OR right(end_time,2)::int % 5 <> 0)
        THEN 'office hours must start and end on a 5-minute mark' END)
) AS v(p) WHERE p IS NOT NULL;

-- ---- Validation: logic, only on rows that are well-formed ----
CREATE TEMP TABLE ok_classes ON COMMIT DROP AS
SELECT * FROM stg_classes c WHERE NOT EXISTS (SELECT 1 FROM import_errors e WHERE e.source='classes' AND e.line=c.line+1);
CREATE TEMP TABLE ok_office ON COMMIT DROP AS
SELECT * FROM stg_office c WHERE NOT EXISTS (SELECT 1 FROM import_errors e WHERE e.source='office_hours' AND e.line=c.line+1);

INSERT INTO import_errors
SELECT 'classes', line + 1, 'end_time must be after start_time' FROM ok_classes WHERE end_time::time <= start_time::time;
INSERT INTO import_errors
SELECT 'office_hours', line + 1, 'end_time must be after start_time' FROM ok_office WHERE end_time::time <= start_time::time;

-- The same batch has two overlapping classes in the file.
INSERT INTO import_errors
SELECT 'classes', a.line + 1,
       'overlaps line ' || b.line + 1 || ' (same batch, same day)'
  FROM ok_classes a JOIN ok_classes b
    ON a.line < b.line AND (a.department_code,a.academic_year,a.year_of_study,a.batch_name,a.day_of_week)
     = (b.department_code,b.academic_year,b.year_of_study,b.batch_name,b.day_of_week)
   AND a.start_time::time < b.end_time::time AND b.start_time::time < a.end_time::time;
-- The same teacher is in two classes at once.
INSERT INTO import_errors
SELECT 'classes', a.line + 1,
       'teacher ' || a.faculty_login_id || ' also teaches line ' || b.line + 1 || ' at the same time'
  FROM ok_classes a JOIN ok_classes b
    ON a.line < b.line AND a.faculty_login_id = b.faculty_login_id AND a.day_of_week = b.day_of_week
   AND a.start_time::time < b.end_time::time AND b.start_time::time < a.end_time::time;
-- ... or already teaches another batch at that time (batches this file replaces do not count).
INSERT INTO import_errors
SELECT 'classes', a.line + 1,
       'teacher ' || a.faculty_login_id || ' already teaches ' || bs.course_code || ' to another batch then'
  FROM ok_classes a
  JOIN users u ON u.login_id = a.faculty_login_id
  JOIN batch_schedule bs ON bs.faculty_id = u.id AND bs.day_of_week = a.day_of_week::int
   AND bs.start_time < a.end_time::time AND a.start_time::time < bs.end_time
 WHERE :'replace' = 'off' OR bs.batch_id NOT IN (
         SELECT bt.id FROM ok_classes r JOIN departments d ON d.code = r.department_code
           JOIN batches bt ON (bt.department_id, bt.academic_year, bt.year_of_study, bt.name)
                            = (d.id, r.academic_year, r.year_of_study::smallint, r.batch_name));
-- Office hours overlapping each other.
INSERT INTO import_errors
SELECT 'office_hours', a.line + 1, 'overlaps line ' || b.line + 1 || ' (same faculty, same day)'
  FROM ok_office a JOIN ok_office b
    ON a.line < b.line AND a.faculty_login_id = b.faculty_login_id AND a.day_of_week = b.day_of_week
   AND a.start_time::time < b.end_time::time AND b.start_time::time < a.end_time::time;

-- ---- Report problems and stop, or write ----
SELECT count(*) AS problems, count(*) > 0 AS has_problems FROM import_errors \gset
\if :has_problems
  \echo
  \echo 'IMPORT REJECTED - nothing was written. Fix these lines (header is line 1):'
  SELECT source, line, problem FROM import_errors ORDER BY source, line, problem;
  SELECT format('DO $x$ BEGIN RAISE EXCEPTION %L; END $x$', 'Import rejected: ' || :problems || ' problem(s).') \gexec
\endif

-- Create batches that do not exist yet.
WITH new_batches AS (
  INSERT INTO batches (department_id, name, year_of_study, academic_year)
  SELECT DISTINCT d.id, c.batch_name, c.year_of_study::smallint, c.academic_year
    FROM ok_classes c JOIN departments d ON d.code = c.department_code
  ON CONFLICT (department_id, academic_year, year_of_study, name) DO NOTHING
  RETURNING 1)
SELECT count(*) AS batches_created FROM new_batches \gset

CREATE TEMP TABLE target_batches ON COMMIT DROP AS
SELECT DISTINCT bt.id AS batch_id, c.department_code, c.academic_year, c.year_of_study, c.batch_name
  FROM ok_classes c JOIN departments d ON d.code = c.department_code
  JOIN batches bt ON (bt.department_id, bt.academic_year, bt.year_of_study, bt.name)
                   = (d.id, c.academic_year, c.year_of_study::smallint, c.batch_name);

-- Replace mode: remove the old timetable of every batch / teacher mentioned in the files.
WITH gone AS (DELETE FROM batch_schedule WHERE :'replace' = 'on'
                AND batch_id IN (SELECT batch_id FROM target_batches) RETURNING 1)
SELECT count(*) AS classes_removed FROM gone \gset
WITH gone AS (DELETE FROM faculty_availability WHERE :'replace' = 'on'
                AND faculty_id IN (SELECT u.id FROM users u WHERE u.login_id IN (SELECT faculty_login_id FROM ok_office))
              RETURNING 1)
SELECT count(*) AS hours_removed FROM gone \gset

WITH added AS (
  INSERT INTO batch_schedule (batch_id, faculty_id, course_code, course_title, session_type,
                              day_of_week, start_time, end_time, room)
  SELECT t.batch_id, u.id, c.course_code, c.course_title, c.session_type,
         c.day_of_week::smallint, c.start_time::time, c.end_time::time, c.room
    FROM ok_classes c
    JOIN target_batches t USING (department_code, academic_year, year_of_study, batch_name)
    LEFT JOIN users u ON u.login_id = c.faculty_login_id
  RETURNING 1)
SELECT count(*) AS classes_added FROM added \gset
WITH added AS (
  INSERT INTO faculty_availability (faculty_id, day_of_week, start_time, end_time)
  SELECT u.id, o.day_of_week::smallint, o.start_time::time, o.end_time::time
    FROM ok_office o JOIN users u ON u.login_id = o.faculty_login_id
  RETURNING 1)
SELECT count(*) AS hours_added FROM added \gset

COMMIT;

\echo
\echo 'IMPORT OK'
SELECT :batches_created AS batches_created, :classes_removed AS classes_removed, :classes_added AS classes_added,
       :hours_removed AS office_hours_removed, :hours_added AS office_hours_added;
