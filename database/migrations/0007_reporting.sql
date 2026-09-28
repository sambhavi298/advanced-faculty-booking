-- =============================================================================
-- 0007 · Read models: appointment details view and the reporting materialized view
-- =============================================================================

-- One row per appointment with everything a list screen shows, so the API never
-- repeats this six-table join (and never gets it subtly different in two places).
CREATE VIEW appointment_details AS
SELECT a.id,
       a.status,
       lower(a.slot)        AS starts_at,
       upper(a.slot)        AS ends_at,
       a.purpose,
       a.decision_note,
       a.created_at,
       a.decided_at,
       a.cancelled_at,
       a.cancelled_by,
       a.completed_at,
       a.student_id,
       su.full_name         AS student_name,
       su.login_id          AS registration_number,
       b.id                 AS batch_id,
       b.name               AS batch_name,
       a.faculty_id,
       fu.full_name         AS faculty_name,
       fu.login_id          AS employee_id,
       f.designation        AS faculty_designation,
       f.office_location    AS faculty_office,
       d.id                 AS department_id,
       d.code               AS department_code,
       d.name               AS department_name
  FROM appointments a
  JOIN users su      ON su.id = a.student_id
  JOIN students s    ON s.user_id = a.student_id
  JOIN batches b     ON b.id = s.batch_id
  JOIN users fu      ON fu.id = a.faculty_id
  JOIN faculty f     ON f.user_id = a.faculty_id
  JOIN departments d ON d.id = f.department_id;

COMMENT ON VIEW appointment_details IS 'Appointments joined with student, batch, faculty and department — the shape every list endpoint returns.';

-- -----------------------------------------------------------------------------
-- faculty_monthly_report (materialized view)
--
-- Monthly statistics per faculty member for the admin Reports page. Aggregating the whole
-- appointments history on every page view would grow with the history; a materialized view
-- stores the result and is refreshed on demand (refresh_reports()), CONCURRENTLY so readers
-- are never blocked. Window functions add the comparative columns:
--   demand_rank_in_department   RANK() within department and month
--   change_from_previous_month  LAG() over the faculty member's months
--   cumulative_requests         running SUM() over the faculty member's months
-- -----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW faculty_monthly_report AS
WITH monthly AS (
  SELECT a.faculty_id,
         date_trunc('month', lower(a.slot) AT TIME ZONE campus_timezone())::date AS month,
         count(*)::integer                                          AS total_requests,
         count(*) FILTER (WHERE a.status = 'PENDING')::integer      AS pending,
         count(*) FILTER (WHERE a.status = 'APPROVED')::integer     AS approved,
         count(*) FILTER (WHERE a.status = 'COMPLETED')::integer    AS completed,
         count(*) FILTER (WHERE a.status = 'REJECTED')::integer     AS rejected,
         count(*) FILTER (WHERE a.status = 'CANCELLED')::integer    AS cancelled,
         round(avg(EXTRACT(EPOCH FROM (a.decided_at - a.created_at)) / 60)
               FILTER (WHERE a.decided_at IS NOT NULL), 1)::float8  AS avg_response_minutes
    FROM appointments a
   GROUP BY a.faculty_id, 2
)
SELECT m.faculty_id,
       u.full_name AS faculty_name,
       f.department_id,
       d.code      AS department_code,
       m.month,
       m.total_requests,
       m.pending,
       m.approved,
       m.completed,
       m.rejected,
       m.cancelled,
       m.avg_response_minutes,
       round(100.0 * (m.approved + m.completed)
             / nullif(m.approved + m.completed + m.rejected, 0), 1)::float8 AS approval_rate_pct,
       rank() OVER (PARTITION BY f.department_id, m.month ORDER BY m.total_requests DESC)::integer
                                                                            AS demand_rank_in_department,
       (m.total_requests - lag(m.total_requests) OVER (PARTITION BY m.faculty_id ORDER BY m.month))::integer
                                                                            AS change_from_previous_month,
       (sum(m.total_requests) OVER (PARTITION BY m.faculty_id ORDER BY m.month
                                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))::integer
                                                                            AS cumulative_requests,
       now() AS refreshed_at
  FROM monthly m
  JOIN faculty f     ON f.user_id = m.faculty_id
  JOIN users u       ON u.id = m.faculty_id
  JOIN departments d ON d.id = f.department_id
WITH DATA;

-- REFRESH ... CONCURRENTLY requires a unique index covering every row.
CREATE UNIQUE INDEX faculty_monthly_report_key ON faculty_monthly_report (faculty_id, month);

COMMENT ON MATERIALIZED VIEW faculty_monthly_report IS 'Monthly appointment statistics per faculty member. Refresh with SELECT refresh_reports().';

CREATE FUNCTION refresh_reports()
RETURNS timestamptz
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY faculty_monthly_report;
  RETURN now();
END
$$;
