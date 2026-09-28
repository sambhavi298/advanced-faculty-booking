-- =============================================================================
-- EXPLAIN ANALYZE of the queries the application depends on.
-- Run after load-history.sql, on the same scratch database. Each statement is annotated with
-- the plan it should produce; docs/DATABASE_DESIGN.md § "Query performance" shows real output.
-- =============================================================================

-- 1. Is Prof. K. Rao free? The double-booking predicate over the next two weeks.
--    Expected: an Index Scan on one of the two PARTIAL GiST indexes behind the exclusion constraints
--    (appointments_no_double_booking / appointments_student_no_overlap). They contain only PENDING and
--    APPROVED rows, so the 60,000 finished appointments are never read, however long the history grows.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
  FROM appointments
 WHERE faculty_id = (SELECT id FROM users WHERE login_id = 'FAC200')
   AND status IN ('PENDING', 'APPROVED')
   AND slot && tstzrange(now(), now() + interval '14 days');

-- 2. Free slots for a student (what the booking page calls), 14 days.
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
  FROM faculty_free_slots((SELECT id FROM users WHERE login_id = 'FAC200'),
                          current_date, current_date + 14,
                          (SELECT id FROM users WHERE login_id = 'RA221100301001'));

-- 3. A faculty member's completed appointments, latest first (History tab).
--    Expected: Index Scan Backward on appointments_faculty_status_start_idx (faculty_id, status, lower(slot)):
--    equality on the first two columns, and the ORDER BY … DESC is served by reading the third column
--    backwards — no sort, and it stops after 20 rows.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, lower(slot) AS starts_at
  FROM appointments
 WHERE faculty_id = (SELECT id FROM users WHERE login_id = 'FAC200')
   AND status = 'COMPLETED'
 ORDER BY lower(slot) DESC
 LIMIT 20;

-- 4. A student's latest requests. Expected: Index Scan on appointments_student_recent_idx.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, created_at
  FROM appointments
 WHERE student_id = (SELECT id FROM users WHERE login_id = 'RA221100310042')
 ORDER BY created_at DESC
 LIMIT 5;

-- 5. Name search with a leading wildcard. A B-tree cannot help with '%…%'; the trigram GIN index can.
--    Expected: Bitmap Index Scan on users_full_name_trgm_idx for both — 5a finds 1 of 20,004 users,
--    5b finds 2,000; the planner weighs each estimate (for a pattern matching most rows it would choose a
--    sequential scan instead — cost-based optimisation).
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, full_name FROM users WHERE full_name ILIKE '%Gupta 29419%';

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, full_name FROM users WHERE full_name ILIKE '%nair%';

-- 6a. Audit log, deep page with OFFSET: reads and throws away 90,000 rows.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM audit_logs ORDER BY id DESC LIMIT 26 OFFSET 90000;

-- 6b. The same page with keyset pagination (what GET /api/admin/audit does): starts at the cursor.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM audit_logs WHERE id < 10000 ORDER BY id DESC LIMIT 26;

-- 7a. Monthly statistics computed live from 60,000 appointments…
EXPLAIN (ANALYZE, BUFFERS)
WITH monthly AS (
  SELECT faculty_id,
         date_trunc('month', lower(slot) AT TIME ZONE campus_timezone())::date AS month,
         count(*) AS total_requests,
         count(*) FILTER (WHERE status = 'COMPLETED') AS completed
    FROM appointments
   GROUP BY 1, 2
)
SELECT *,
       rank() OVER (PARTITION BY month ORDER BY total_requests DESC) AS demand_rank,
       total_requests - lag(total_requests) OVER (PARTITION BY faculty_id ORDER BY month) AS change
  FROM monthly;

-- 7b. …versus reading the materialized view that stores the result (Reports page).
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM faculty_monthly_report ORDER BY month DESC, department_code, demand_rank_in_department;
