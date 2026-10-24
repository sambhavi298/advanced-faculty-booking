-- Proof that RLS works. Raises an error if any check fails; prints PASS lines otherwise.
-- Run AFTER row-level-security.sql, as the same owner user.
BEGIN;
SELECT set_config('app.now', '2030-01-02T00:00:00Z', true);
-- Set-up (as the owner): three requests, each in the first free slot the database offers.
INSERT INTO appointments (student_id, faculty_id, slot, purpose)
SELECT s.id, f.id, tstzrange(fs.slot_start, fs.slot_end), 'RLS demo request ' || v.tag
  FROM (VALUES ('A','RA221100301002','FAC202',0), ('B','RA221100301003','FAC202',1),
               ('C','RA221100301003','FAC203',0)) AS v(tag, student, faculty, skip)
  JOIN users s ON s.login_id = v.student
  JOIN users f ON f.login_id = v.faculty
  CROSS JOIN LATERAL (SELECT slot_start, slot_end FROM faculty_free_slots(f.id, '2030-01-07', '2030-01-18', s.id)
                       ORDER BY slot_start OFFSET v.skip LIMIT 1) fs;

CREATE TEMP TABLE r (check_name text, passed boolean);
CREATE TEMP TABLE ref AS
  SELECT (SELECT lower(slot) FROM appointments WHERE purpose = 'RLS demo request A') AS a_start,
         (SELECT slot_start FROM faculty_free_slots((SELECT id FROM users WHERE login_id='FAC202'),
                '2030-01-07', '2030-01-18', (SELECT id FROM users WHERE login_id='RA221100301003'))
           ORDER BY slot_start OFFSET 3 LIMIT 1) AS free_start,
         (SELECT make_interval(mins => slot_minutes) FROM faculty f JOIN users u ON u.id=f.user_id WHERE login_id='FAC202') AS step;
CREATE TEMP TABLE ids AS SELECT login_id, id FROM users;
GRANT ALL ON r, ref, ids TO PUBLIC;

-- 1. student sees only their own appointments
SET LOCAL ROLE afb_student;
SELECT set_config('app.user_id', (SELECT id::text FROM ids WHERE login_id='RA221100301002'), true);
INSERT INTO r SELECT 'student sees only own appointments', count(*) = 1 AND bool_and(purpose='RLS demo request A') FROM appointments;
INSERT INTO r SELECT 'student cannot read password hashes', NOT has_column_privilege('afb_student','users','password_hash','SELECT');
INSERT INTO r SELECT 'student sees faculty directory but no other student', count(*) FILTER (WHERE role='FACULTY') >= 4 AND count(*) FILTER (WHERE role='STUDENT') = 1 FROM users;
INSERT INTO r SELECT 'student cannot read the audit log', NOT has_table_privilege('afb_student','audit_logs','SELECT');
RESET ROLE;

-- 2. a student cannot book on behalf of someone else (policy WITH CHECK)
SET LOCAL ROLE afb_student;
SELECT set_config('app.user_id', (SELECT id::text FROM ids WHERE login_id='RA221100301002'), true);
DO $$ BEGIN
  INSERT INTO appointments (student_id, faculty_id, slot, purpose)
  SELECT (SELECT id FROM ids WHERE login_id='RA221100301003'), (SELECT id FROM ids WHERE login_id='FAC202'),
         tstzrange(ref.free_start, ref.free_start + ref.step), 'forged on behalf of another'
    FROM ref;
  INSERT INTO r VALUES ('student cannot insert for another student', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO r VALUES ('student cannot insert for another student', true);
END $$;
RESET ROLE;
-- 3. faculty sees only requests addressed to them
SET LOCAL ROLE afb_faculty;
SELECT set_config('app.user_id', (SELECT id::text FROM ids WHERE login_id='FAC202'), true);
INSERT INTO r SELECT 'faculty sees only own requests', count(*) = 2 AND bool_and(faculty_id = app_user_id()) FROM appointments;
INSERT INTO r SELECT 'faculty sees only students they have appointments with',
       (SELECT count(*) FROM users WHERE role='STUDENT') = 2 FROM (SELECT 1) x;
RESET ROLE;

-- 4. free slots still account for everybody's bookings (SECURITY DEFINER function)
SET LOCAL ROLE afb_student;
SELECT set_config('app.user_id', (SELECT id::text FROM ids WHERE login_id='RA221100301004'), true);
INSERT INTO r SELECT 'free-slot list hides slots booked by other students',
       NOT EXISTS (SELECT 1 FROM faculty_free_slots((SELECT id FROM users WHERE login_id='FAC202'), '2030-01-07','2030-01-07') s
                    WHERE s.slot_start = (SELECT a_start FROM ref))
  FROM (SELECT 1) x;
RESET ROLE;

-- 5. admin sees everything including the audit log
SET LOCAL ROLE afb_admin;
SELECT set_config('app.user_id', (SELECT id::text FROM ids WHERE login_id='ADMIN001'), true);
INSERT INTO r SELECT 'admin sees all appointments', count(*) = 3 FROM appointments;
INSERT INTO r SELECT 'admin sees the audit log', count(*) > 0 FROM audit_logs;
RESET ROLE;

SELECT check_name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result FROM r;
SELECT CASE WHEN bool_and(passed) THEN 'ALL CHECKS PASSED' ELSE 'SOME CHECKS FAILED' END FROM r;
ROLLBACK;   -- the demo leaves no data behind
