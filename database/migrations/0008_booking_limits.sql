-- =============================================================================
-- 0008: fair-use limit on appointment requests
--
-- Problem: a faculty member serves 500+ students. Nothing stops one student from
-- reserving every free slot of a week and starving everybody else.
-- Rule: a student may hold at most weekly_request_limit() active (PENDING or APPROVED)
-- appointments that fall in the same calendar week (Monday-Sunday, campus time).
-- Rejected, cancelled and completed appointments do not count, so a student who is
-- turned down, or who cancels, can request again at once.
--
-- Why a trigger and not application code: the rule must hold for every way of inserting a row.
-- Why an advisory lock: "count the rows, then insert" is a check-then-act race - two simultaneous
-- requests from the same student would both count 4 and both be accepted, reaching 6. Unlike
-- double booking there is no constraint that can express "at most N rows", so the trigger takes a
-- transaction-level advisory lock on the student first; the second request waits, then counts again.
-- (Different students never wait for each other.)
-- =============================================================================
CREATE FUNCTION weekly_request_limit()
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$ SELECT 5 $$;

COMMENT ON FUNCTION weekly_request_limit() IS
  'Maximum active (pending or approved) appointments one student may hold in one calendar week.';

CREATE FUNCTION appointments_enforce_weekly_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tz          constant text := campus_timezone();
  v_week_start  timestamptz;
  v_active      integer;
  v_limit       constant integer := weekly_request_limit();
BEGIN
  -- Only new live requests are limited; history loaded for reports is not.
  IF NEW.status NOT IN ('PENDING', 'APPROVED') OR lower(NEW.slot) <= app_now() THEN
    RETURN NEW;
  END IF;

  v_week_start := date_trunc('week', lower(NEW.slot) AT TIME ZONE v_tz) AT TIME ZONE v_tz;

  PERFORM pg_advisory_xact_lock(hashtextextended('weekly-request-limit:' || NEW.student_id, 0));

  SELECT count(*) INTO v_active
    FROM appointments a
   WHERE a.student_id = NEW.student_id
     AND a.status IN ('PENDING', 'APPROVED')
     AND a.slot && tstzrange(v_week_start,
                             ((v_week_start AT TIME ZONE v_tz) + interval '7 days') AT TIME ZONE v_tz, '[)');

  IF v_active >= v_limit THEN
    RAISE EXCEPTION 'You already have % active appointments in that week. Wait for a decision or cancel one before requesting another.', v_limit
      USING ERRCODE = 'AB009';
  END IF;
  RETURN NEW;
END
$$;

-- Fires after appointments_validate_insert (triggers run in name order), so invalid slots are
-- reported with their own, more specific, message first.
CREATE TRIGGER appointments_weekly_limit
  BEFORE INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_enforce_weekly_limit();
