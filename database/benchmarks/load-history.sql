-- =============================================================================
-- Benchmark data: ~2 years of history for EXPLAIN ANALYZE demonstrations.
--
-- Run ONLY against a scratch database that has the migrations and seed applied — never against
-- the database you demo the portals with. See docs/DATABASE_DESIGN.md § "Query performance".
--
-- Adds 20,000 students and 60,000 past appointments (30,000 per faculty member: 70% completed,
-- 20% rejected, 10% cancelled). The booking-rule and notification triggers are switched off for
-- the bulk load (history cannot be "booked" in the past); the audit trigger stays on, so
-- audit_logs grows by 60,000+ rows as well.
-- =============================================================================
BEGIN;

-- 20,000 students, alternating between the two seeded batches.
INSERT INTO users (login_id, full_name, role, password_hash)
SELECT 'RA2211003' || lpad(g::text, 5, '0'),
       (ARRAY['Aarav','Diya','Ishaan','Meera','Kabir','Ananya','Rohan','Sneha'])[1 + g % 8] || ' ' ||
       (ARRAY['Sharma','Iyer','Rao','Mehta','Nair','Das','Khan','Reddy','Menon','Gupta'])[1 + g % 10] || ' ' || g,
       'STUDENT',
       (SELECT password_hash FROM users WHERE login_id = 'RA221100301001')
  FROM generate_series(10001, 30000) AS g;

INSERT INTO students (user_id, batch_id)
SELECT u.id, (SELECT b.id FROM batches b ORDER BY b.id LIMIT 1 OFFSET (u.id % 2))
  FROM users u
 WHERE u.role = 'STUDENT'
   AND NOT EXISTS (SELECT 1 FROM students s WHERE s.user_id = u.id);

ALTER TABLE appointments DISABLE TRIGGER appointments_validate_insert;
ALTER TABLE appointments DISABLE TRIGGER appointments_notify;

-- 30,000 consecutive 15-minute slots per faculty member, 40 a day, ending about 50 days ago.
WITH fac AS (SELECT user_id, row_number() OVER (ORDER BY user_id) AS n FROM faculty),
     stu AS (SELECT array_agg(user_id ORDER BY user_id) AS ids FROM students),
     h AS (
       SELECT fac.user_id AS faculty_id,
              stu.ids[1 + ((g * 7919 + fac.n * 31) % array_length(stu.ids, 1))] AS student_id,
              date_trunc('day', now() - interval '800 days') + interval '2 hours 30 minutes'
                + (g / 40) * interval '1 day' + (g % 40) * interval '15 minutes' AS starts,
              g
         FROM fac, stu, generate_series(0, 29999) AS g
     )
INSERT INTO appointments (student_id, faculty_id, slot, purpose, status, decision_note,
                          decided_at, cancelled_at, cancelled_by, completed_at, created_at)
SELECT student_id,
       faculty_id,
       tstzrange(starts, starts + interval '15 minutes'),
       'Historical request number ' || g,
       CASE WHEN g % 10 < 7 THEN 'COMPLETED' WHEN g % 10 < 9 THEN 'REJECTED' ELSE 'CANCELLED' END::appointment_status,
       CASE WHEN g % 10 IN (7, 8) THEN 'Not available at that time' END,
       CASE WHEN g % 10 < 9 THEN starts - interval '1 day' + (g % 300) * interval '1 minute' END,
       CASE WHEN g % 10 = 9 THEN starts - interval '3 hours' END,
       CASE WHEN g % 10 = 9 THEN student_id END,
       CASE WHEN g % 10 < 7 THEN starts + interval '15 minutes' END,
       starts - interval '2 days'
  FROM h;

ALTER TABLE appointments ENABLE TRIGGER appointments_validate_insert;
ALTER TABLE appointments ENABLE TRIGGER appointments_notify;

COMMIT;

-- Fresh statistics for the planner, and the report view over the new history.
ANALYZE;
SELECT refresh_reports();
