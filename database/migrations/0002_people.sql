-- =============================================================================
-- 0002 · People and academic structure: departments, batches, users, students, faculty
-- =============================================================================

CREATE TABLE departments (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT departments_code_key UNIQUE (code),
  CONSTRAINT departments_name_key UNIQUE (name),
  CONSTRAINT departments_code_format CHECK (code ~ '^[A-Z]{2,10}$'),
  CONSTRAINT departments_name_not_blank CHECK (btrim(name) <> '' AND char_length(name) <= 120)
);

COMMENT ON TABLE departments IS 'Academic departments (e.g. CSE). Faculty belong to one; batches belong to one.';

-- A batch is a cohort that shares one weekly timetable (e.g. CSE, 3rd year, 2026-2027, Batch 1).
CREATE TABLE batches (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  department_id  integer NOT NULL REFERENCES departments (id) ON DELETE RESTRICT,
  name           text NOT NULL,
  year_of_study  smallint NOT NULL,
  academic_year  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT batches_identity_key UNIQUE (department_id, academic_year, year_of_study, name),
  CONSTRAINT batches_name_not_blank CHECK (btrim(name) <> '' AND char_length(name) <= 60),
  CONSTRAINT batches_year_of_study_range CHECK (year_of_study BETWEEN 1 AND 5),
  -- '2026-2027': two consecutive years.
  CONSTRAINT batches_academic_year_format CHECK (
    academic_year ~ '^[0-9]{4}-[0-9]{4}$'
    AND right(academic_year, 4)::integer = left(academic_year, 4)::integer + 1
  )
);

COMMENT ON TABLE batches IS 'Student cohorts sharing one weekly class timetable (batch_schedule).';

-- -----------------------------------------------------------------------------
-- users: one row per person who can log in, whatever their role.
-- login_id is the Registration Number (students), Employee ID (faculty) or Admin ID.
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  login_id       text NOT NULL,
  full_name      text NOT NULL,
  role           user_role NOT NULL,
  password_hash  text NOT NULL,
  is_active      boolean NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_login_id_key UNIQUE (login_id),
  -- Target of the (user_id, role) foreign keys in students/faculty: see below.
  CONSTRAINT users_id_role_key UNIQUE (id, role),
  -- The login id's shape identifies the portal: RA… students, FAC… faculty, ADMIN… admins.
  CONSTRAINT users_login_id_matches_role CHECK (
       (role = 'STUDENT' AND login_id ~ '^RA[0-9]{10,15}$')
    OR (role = 'FACULTY' AND login_id ~ '^FAC[0-9]{1,6}$')
    OR (role = 'ADMIN'   AND login_id ~ '^ADMIN[0-9]{1,6}$')
  ),
  CONSTRAINT users_full_name_not_blank CHECK (btrim(full_name) <> '' AND char_length(full_name) <= 120),
  -- Only a bcrypt hash can ever be stored: a plaintext or otherwise-hashed password is rejected
  -- by the database itself, whatever code path attempted the write.
  CONSTRAINT users_password_is_bcrypt CHECK (
    password_hash ~ '^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$'
  )
);

COMMENT ON TABLE users IS 'Every account that can log in. Role-specific details live in students / faculty.';
COMMENT ON COLUMN users.login_id IS 'Registration Number (STUDENT), Employee ID (FACULTY) or Admin ID (ADMIN). Stored upper-case.';
COMMENT ON COLUMN users.password_hash IS 'bcrypt hash only (enforced by users_password_is_bcrypt).';

-- Trigram index: substring search on names ("rao", "iyer") without a sequential scan.
CREATE INDEX users_full_name_trgm_idx ON users USING gin (full_name gin_trgm_ops);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Role subtypes.
-- The composite foreign key (user_id, role) → users (id, role), together with a CHECK
-- pinning `role`, guarantees at the database level that a students row can only belong
-- to a STUDENT user and a faculty row only to a FACULTY user. Changing a user's role
-- while the subtype row exists is rejected by the same foreign key.
-- -----------------------------------------------------------------------------
CREATE TABLE students (
  user_id     bigint PRIMARY KEY,
  role        user_role NOT NULL DEFAULT 'STUDENT',
  batch_id    integer NOT NULL REFERENCES batches (id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT students_role_is_student CHECK (role = 'STUDENT'),
  CONSTRAINT students_user_fkey FOREIGN KEY (user_id, role) REFERENCES users (id, role) ON DELETE CASCADE
);

COMMENT ON TABLE students IS 'Student details. The Registration Number is users.login_id.';

CREATE INDEX students_batch_id_idx ON students (batch_id);

CREATE TRIGGER students_set_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE faculty (
  user_id          bigint PRIMARY KEY,
  role             user_role NOT NULL DEFAULT 'FACULTY',
  department_id    integer NOT NULL REFERENCES departments (id) ON DELETE RESTRICT,
  designation      text NOT NULL,
  office_location  text NOT NULL,
  slot_minutes     smallint NOT NULL DEFAULT 15,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT faculty_role_is_faculty CHECK (role = 'FACULTY'),
  CONSTRAINT faculty_user_fkey FOREIGN KEY (user_id, role) REFERENCES users (id, role) ON DELETE CASCADE,
  CONSTRAINT faculty_designation_not_blank CHECK (btrim(designation) <> '' AND char_length(designation) <= 80),
  CONSTRAINT faculty_office_location_not_blank CHECK (btrim(office_location) <> '' AND char_length(office_location) <= 120),
  -- Appointment length offered by this faculty member: 10–60 minutes on a 5-minute grid.
  CONSTRAINT faculty_slot_minutes_valid CHECK (slot_minutes BETWEEN 10 AND 60 AND slot_minutes % 5 = 0)
);

COMMENT ON TABLE faculty IS 'Faculty details. The Employee ID is users.login_id.';
COMMENT ON COLUMN faculty.office_location IS 'Staff room where students meet the faculty member once an appointment is approved.';
COMMENT ON COLUMN faculty.slot_minutes IS 'Length of one bookable appointment slot.';

CREATE INDEX faculty_department_id_idx ON faculty (department_id);

CREATE TRIGGER faculty_set_updated_at
  BEFORE UPDATE ON faculty
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER departments_set_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER batches_set_updated_at
  BEFORE UPDATE ON batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
