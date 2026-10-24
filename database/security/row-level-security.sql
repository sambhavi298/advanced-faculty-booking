-- =============================================================================
-- ROW-LEVEL SECURITY (optional hardening, step 3)
--
-- Problem it solves: today only the API decides who may see which row. If another tool ever
-- connects to the database (a report, a script, a mistaken query), nothing in the database stops
-- a student reading another student's appointments. With RLS, PostgreSQL itself filters rows by
-- who is asking.
--
-- How it works
--   * Three NOLOGIN roles: afb_student, afb_faculty, afb_admin (privileges, no passwords).
--   * The caller identifies itself with the same transaction settings the audit trigger already
--     uses: app.user_id (and app.user_role).  Example:
--         BEGIN;  SET LOCAL ROLE afb_student;
--         SELECT set_config('app.user_id','3',true);
--         SELECT * FROM appointments;      -- only student 3's rows
--   * The table OWNER (what the API connects as today) is not subject to the policies, so
--     applying this file changes nothing for the running application. It protects every other
--     way into the database, and the API can adopt it later by running each request with
--     SET LOCAL ROLE.
-- Safe to run more than once.
-- =============================================================================
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afb_student') THEN CREATE ROLE afb_student NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afb_faculty') THEN CREATE ROLE afb_faculty NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'afb_admin')   THEN CREATE ROLE afb_admin   NOLOGIN; END IF;
END $$;
-- Let the current (owner) user switch into these roles with SET ROLE.
GRANT afb_student, afb_faculty, afb_admin TO CURRENT_USER;

-- Who is asking? NULL when nobody identified themselves, which matches no row.
CREATE OR REPLACE FUNCTION app_user_id() RETURNS bigint
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '')::bigint $$;

-- Functions that must see EVERY row to do their job run with the owner's rights
-- (a student's free-slot list must count other students' bookings; a booking notifies the faculty).
ALTER FUNCTION faculty_free_slots(bigint, date, date, bigint) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION check_appointment_request(bigint, bigint, tstzrange) SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION appointments_before_insert()             SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION appointments_before_update()             SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION appointments_notify()                    SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION audit_row_change()                       SECURITY DEFINER SET search_path = public, pg_temp;
ALTER FUNCTION faculty_exceptions_release_appointments() SECURITY DEFINER SET search_path = public, pg_temp;
-- Views normally run with the owner's rights and would bypass RLS; make them run as the caller.
ALTER VIEW appointment_details SET (security_invoker = true);

-- ---------------------------------------------------------------- privileges
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM afb_student, afb_faculty, afb_admin;
GRANT USAGE ON SCHEMA public TO afb_student, afb_faculty, afb_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO afb_student, afb_faculty, afb_admin;

-- Reference data everyone may read.
GRANT SELECT ON departments, batches, batch_schedule, faculty, faculty_availability,
                faculty_schedule_exceptions TO afb_student, afb_faculty, afb_admin;
-- Users: everything except the password hash.
GRANT SELECT (id, login_id, full_name, role, is_active, last_login_at, created_at, updated_at)
  ON users TO afb_student, afb_faculty, afb_admin;
GRANT SELECT ON students, appointments, appointment_details, notifications
  TO afb_student, afb_faculty, afb_admin;
GRANT SELECT ON audit_logs, faculty_monthly_report TO afb_admin;
-- Writes, narrowly.
GRANT INSERT (student_id, faculty_id, slot, purpose) ON appointments TO afb_student;
GRANT UPDATE (status, decision_note, cancelled_at, cancelled_by) ON appointments TO afb_student, afb_faculty;
GRANT UPDATE (decided_at, completed_at) ON appointments TO afb_faculty;
GRANT UPDATE (read_at) ON notifications TO afb_student, afb_faculty, afb_admin;
GRANT UPDATE (is_active) ON users TO afb_admin;

-- ---------------------------------------------------------------- policies
ALTER TABLE appointments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE students      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appt_student_select ON appointments;
DROP POLICY IF EXISTS appt_student_insert ON appointments;
DROP POLICY IF EXISTS appt_student_update ON appointments;
DROP POLICY IF EXISTS appt_faculty_select ON appointments;
DROP POLICY IF EXISTS appt_faculty_update ON appointments;
DROP POLICY IF EXISTS appt_admin_select   ON appointments;
CREATE POLICY appt_student_select ON appointments FOR SELECT TO afb_student USING (student_id = app_user_id());
CREATE POLICY appt_student_insert ON appointments FOR INSERT TO afb_student WITH CHECK (student_id = app_user_id());
CREATE POLICY appt_student_update ON appointments FOR UPDATE TO afb_student
  USING (student_id = app_user_id()) WITH CHECK (student_id = app_user_id());
CREATE POLICY appt_faculty_select ON appointments FOR SELECT TO afb_faculty USING (faculty_id = app_user_id());
CREATE POLICY appt_faculty_update ON appointments FOR UPDATE TO afb_faculty
  USING (faculty_id = app_user_id()) WITH CHECK (faculty_id = app_user_id());
CREATE POLICY appt_admin_select   ON appointments FOR SELECT TO afb_admin USING (true);

DROP POLICY IF EXISTS notif_own   ON notifications;
DROP POLICY IF EXISTS audit_admin ON audit_logs;
CREATE POLICY notif_own   ON notifications FOR ALL TO afb_student, afb_faculty, afb_admin
  USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
CREATE POLICY audit_admin ON audit_logs FOR SELECT TO afb_admin USING (true);   -- nobody else gets a policy

DROP POLICY IF EXISTS users_visible   ON users;
DROP POLICY IF EXISTS users_admin_upd ON users;
CREATE POLICY users_visible ON users FOR SELECT TO afb_student, afb_faculty, afb_admin USING (
     id = app_user_id()                                   -- yourself
  OR role = 'FACULTY'                                     -- the faculty directory is public
  OR EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = current_user AND r.rolname = 'afb_admin')
  OR EXISTS (SELECT 1 FROM appointments a                 -- a student you have an appointment with
              WHERE a.faculty_id = app_user_id() AND a.student_id = users.id));
CREATE POLICY users_admin_upd ON users FOR UPDATE TO afb_admin USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS students_visible ON students;
CREATE POLICY students_visible ON students FOR SELECT TO afb_student, afb_faculty, afb_admin USING (
     user_id = app_user_id()
  OR current_user = 'afb_admin'
  OR EXISTS (SELECT 1 FROM appointments a WHERE a.faculty_id = app_user_id() AND a.student_id = students.user_id));

COMMIT;
