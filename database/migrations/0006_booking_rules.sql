-- =============================================================================
-- 0006 · Booking rules: free-slot computation, request validation, lifecycle,
--        notifications, automatic release on exceptions, elapsed processing
-- =============================================================================
--
-- Application-defined SQLSTATEs (class "AB" is unused by PostgreSQL). The API maps each
-- to a precise HTTP error; the message text is written for end users.
--   AB001  slot is not in the future                 AB005  illegal status transition
--   AB002  slot is not one of the faculty's slots    AB006  appointment details are immutable
--   AB003  faculty member unavailable at that time   AB007  slot is beyond the booking horizon
--   AB004  student has a class at that time          AB008  exception period already over

-- -----------------------------------------------------------------------------
-- faculty_free_slots: the single definition of "bookable".
--
-- Expands weekly availability into concrete slots for each date in [p_from, p_to], then
-- removes every slot that is in the past, beyond the booking horizon, inside an exception,
-- during the faculty member's own teaching, or already held by an active appointment.
-- With p_student_id it also removes the student's class hours and the student's other
-- active appointments, so a student is only ever offered times they can actually attend.
-- -----------------------------------------------------------------------------
CREATE FUNCTION faculty_free_slots(
  p_faculty_id  bigint,
  p_from        date,
  p_to          date,
  p_student_id  bigint DEFAULT NULL
)
RETURNS TABLE (slot_start timestamptz, slot_end timestamptz)
LANGUAGE sql STABLE
AS $$
  WITH active_faculty AS (
    SELECT f.user_id, make_interval(mins => f.slot_minutes) AS step
      FROM faculty f
      JOIN users u ON u.id = f.user_id
     WHERE f.user_id = p_faculty_id
       AND u.is_active
  ),
  days AS (
    -- Local calendar days, clipped to [today, today + horizon].
    SELECT d::date AS day, EXTRACT(ISODOW FROM d)::smallint AS dow
      FROM generate_series(
             greatest(p_from, (app_now() AT TIME ZONE campus_timezone())::date),
             least(p_to, ((app_now() + booking_horizon()) AT TIME ZONE campus_timezone())::date),
             interval '1 day'
           ) AS d
  ),
  candidates AS (
    -- One row per slot: each availability window cut into slot_minutes pieces.
    SELECT campus_timestamp(dy.day, g.t::time)           AS slot_start,
           campus_timestamp(dy.day, g.t::time) + af.step AS slot_end,
           dy.dow,
           timerange(g.t::time, (g.t + af.step)::time, '[)') AS local_window
      FROM active_faculty af
      JOIN faculty_availability a ON a.faculty_id = af.user_id
      JOIN days dy ON dy.dow = a.day_of_week
     CROSS JOIN LATERAL generate_series(dy.day + a.start_time, dy.day + a.end_time - af.step, af.step) AS g(t)
  )
  SELECT c.slot_start, c.slot_end
    FROM candidates c
   WHERE c.slot_start > app_now()
     AND c.slot_start <= app_now() + booking_horizon()
     AND NOT EXISTS (
           SELECT 1 FROM faculty_schedule_exceptions e
            WHERE e.faculty_id = p_faculty_id
              AND e.period && tstzrange(c.slot_start, c.slot_end, '[)'))
     AND NOT EXISTS (
           SELECT 1 FROM batch_schedule bs
            WHERE bs.faculty_id = p_faculty_id
              AND bs.day_of_week = c.dow
              AND bs.during && c.local_window)
     AND NOT EXISTS (
           SELECT 1 FROM appointments ap
            WHERE ap.faculty_id = p_faculty_id
              AND ap.status IN ('PENDING', 'APPROVED')
              AND ap.slot && tstzrange(c.slot_start, c.slot_end, '[)'))
     AND (p_student_id IS NULL OR (
               NOT EXISTS (
                 SELECT 1 FROM batch_schedule bs
                   JOIN students s ON s.batch_id = bs.batch_id
                  WHERE s.user_id = p_student_id
                    AND bs.day_of_week = c.dow
                    AND bs.during && c.local_window)
           AND NOT EXISTS (
                 SELECT 1 FROM appointments ap
                  WHERE ap.student_id = p_student_id
                    AND ap.status IN ('PENDING', 'APPROVED')
                    AND ap.slot && tstzrange(c.slot_start, c.slot_end, '[)'))))
   ORDER BY c.slot_start
$$;

COMMENT ON FUNCTION faculty_free_slots(bigint, date, date, bigint) IS
  'Bookable slots for a faculty member between two local dates, optionally personalised for a student.';

-- -----------------------------------------------------------------------------
-- check_appointment_request: explains precisely WHY a requested slot is not bookable.
-- Runs in the BEFORE INSERT trigger, so no insert path can bypass it. Overlap with
-- other appointments is deliberately NOT checked here: the exclusion constraints are
-- the single authority for that, and they are the only check that is race-free.
-- -----------------------------------------------------------------------------
CREATE FUNCTION check_appointment_request(p_faculty_id bigint, p_student_id bigint, p_slot tstzrange)
RETURNS void
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_tz            constant text := campus_timezone();
  v_start_local   timestamp := lower(p_slot) AT TIME ZONE v_tz;
  v_end_local     timestamp := upper(p_slot) AT TIME ZONE v_tz;
  v_dow           smallint  := EXTRACT(ISODOW FROM v_start_local);
  v_local_window  timerange;
  v_faculty_name  text;
  v_is_active     boolean;
  v_slot_minutes  smallint;
  v_exception     record;
  v_class         record;
BEGIN
  SELECT u.full_name, u.is_active, f.slot_minutes
    INTO v_faculty_name, v_is_active, v_slot_minutes
    FROM faculty f JOIN users u ON u.id = f.user_id
   WHERE f.user_id = p_faculty_id;
  IF NOT FOUND THEN
    RETURN; -- the foreign key on appointments.faculty_id rejects the row
  END IF;

  IF lower(p_slot) <= app_now() THEN
    RAISE EXCEPTION 'Appointments can only be requested for a future time.'
      USING ERRCODE = 'AB001';
  END IF;

  IF lower(p_slot) > app_now() + booking_horizon() THEN
    RAISE EXCEPTION 'Appointments can be requested at most % in advance.', booking_horizon()
      USING ERRCODE = 'AB007';
  END IF;

  IF NOT v_is_active THEN
    RAISE EXCEPTION '% is not accepting appointments.', v_faculty_name
      USING ERRCODE = 'AB003';
  END IF;

  -- The slot must be exactly one of the faculty member's slots: same local day, the
  -- configured length, inside one availability window and on that window's slot grid.
  IF v_end_local::date <> v_start_local::date
     OR upper(p_slot) - lower(p_slot) <> make_interval(mins => v_slot_minutes) THEN
    RAISE EXCEPTION 'The selected time is not one of %''s appointment slots.', v_faculty_name
      USING ERRCODE = 'AB002';
  END IF;

  v_local_window := timerange(v_start_local::time, v_end_local::time, '[)');

  IF NOT EXISTS (
    SELECT 1 FROM faculty_availability a
     WHERE a.faculty_id = p_faculty_id
       AND a.day_of_week = v_dow
       AND a.during @> v_local_window
       AND EXTRACT(EPOCH FROM (v_start_local::time - a.start_time))::integer % (v_slot_minutes * 60) = 0
  ) THEN
    RAISE EXCEPTION 'The selected time is not one of %''s appointment slots.', v_faculty_name
      USING ERRCODE = 'AB002';
  END IF;

  SELECT e.kind, e.reason INTO v_exception
    FROM faculty_schedule_exceptions e
   WHERE e.faculty_id = p_faculty_id AND e.period && p_slot
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '% is unavailable at this time (%).', v_faculty_name, lower(v_exception.kind::text)
      USING ERRCODE = 'AB003';
  END IF;

  SELECT bs.course_title INTO v_class
    FROM batch_schedule bs
   WHERE bs.faculty_id = p_faculty_id AND bs.day_of_week = v_dow AND bs.during && v_local_window
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '% is teaching % at this time.', v_faculty_name, v_class.course_title
      USING ERRCODE = 'AB003';
  END IF;

  SELECT bs.course_title INTO v_class
    FROM batch_schedule bs
    JOIN students s ON s.batch_id = bs.batch_id
   WHERE s.user_id = p_student_id AND bs.day_of_week = v_dow AND bs.during && v_local_window
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'You have a class (%) at this time.', v_class.course_title
      USING ERRCODE = 'AB004';
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Appointment lifecycle triggers
-- -----------------------------------------------------------------------------
CREATE FUNCTION appointments_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'PENDING' THEN
    RAISE EXCEPTION 'A new appointment must start as a pending request.'
      USING ERRCODE = 'AB005';
  END IF;
  NEW.purpose := btrim(NEW.purpose);
  PERFORM check_appointment_request(NEW.faculty_id, NEW.student_id, NEW.slot);
  RETURN NEW;
END
$$;

CREATE TRIGGER appointments_validate_insert
  BEFORE INSERT ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_before_insert();

--   PENDING  → APPROVED | REJECTED | CANCELLED
--   APPROVED → COMPLETED | CANCELLED
--   REJECTED, CANCELLED, COMPLETED are final.
CREATE FUNCTION appointments_before_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.student_id <> OLD.student_id
     OR NEW.faculty_id <> OLD.faculty_id
     OR NEW.slot <> OLD.slot
     OR NEW.purpose <> OLD.purpose
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'An appointment''s participants, time and purpose cannot be changed. Cancel it and request a new slot.'
      USING ERRCODE = 'AB006';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
         (OLD.status = 'PENDING'  AND NEW.status IN ('APPROVED', 'REJECTED', 'CANCELLED'))
      OR (OLD.status = 'APPROVED' AND NEW.status IN ('COMPLETED', 'CANCELLED'))
    ) THEN
      RAISE EXCEPTION 'This appointment is already %; it cannot be changed to %.',
        lower(OLD.status::text), lower(NEW.status::text)
        USING ERRCODE = 'AB005';
    END IF;

    IF NEW.status = 'APPROVED' AND lower(NEW.slot) <= app_now() THEN
      RAISE EXCEPTION 'This request''s time has already passed, so it can no longer be approved.'
        USING ERRCODE = 'AB005';
    END IF;

    IF NEW.status = 'COMPLETED' AND upper(NEW.slot) > app_now() THEN
      RAISE EXCEPTION 'An appointment can only be completed after it has ended.'
        USING ERRCODE = 'AB005';
    END IF;

    CASE NEW.status
      WHEN 'APPROVED', 'REJECTED' THEN NEW.decided_at := now();
      WHEN 'CANCELLED' THEN NEW.cancelled_at := now();
      WHEN 'COMPLETED' THEN NEW.completed_at := now();
      ELSE NULL;
    END CASE;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER appointments_guard_update
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_before_update();

-- -----------------------------------------------------------------------------
-- Notifications: every lifecycle event tells the other party, in the same transaction.
-- -----------------------------------------------------------------------------
CREATE FUNCTION appointments_notify()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_student  text;
  v_faculty  text;
  v_when     text;
  v_note     text := coalesce(' Note: ' || NEW.decision_note, '');
BEGIN
  SELECT su.full_name, fu.full_name
    INTO v_student, v_faculty
    FROM users su, users fu
   WHERE su.id = NEW.student_id AND fu.id = NEW.faculty_id;

  v_when := to_char(lower(NEW.slot) AT TIME ZONE campus_timezone(), 'Dy DD Mon YYYY, HH12:MI AM');

  IF TG_OP = 'INSERT' THEN
    INSERT INTO notifications (user_id, appointment_id, kind, title, body)
    VALUES (NEW.faculty_id, NEW.id, 'APPOINTMENT_REQUESTED', 'New appointment request',
            format('%s requested %s. Purpose: %s', v_student, v_when, NEW.purpose));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    CASE NEW.status
      WHEN 'APPROVED' THEN
        INSERT INTO notifications (user_id, appointment_id, kind, title, body)
        VALUES (NEW.student_id, NEW.id, 'APPOINTMENT_APPROVED', 'Appointment approved',
                format('%s approved your appointment on %s.%s', v_faculty, v_when, v_note));
      WHEN 'REJECTED' THEN
        INSERT INTO notifications (user_id, appointment_id, kind, title, body)
        VALUES (NEW.student_id, NEW.id, 'APPOINTMENT_REJECTED', 'Appointment request declined',
                format('Your request to meet %s on %s was declined.%s', v_faculty, v_when, v_note));
      WHEN 'CANCELLED' THEN
        IF NEW.cancelled_by = NEW.student_id THEN
          INSERT INTO notifications (user_id, appointment_id, kind, title, body)
          VALUES (NEW.faculty_id, NEW.id, 'APPOINTMENT_CANCELLED', 'Appointment cancelled by student',
                  format('%s cancelled the appointment on %s.', v_student, v_when));
        ELSE
          INSERT INTO notifications (user_id, appointment_id, kind, title, body)
          VALUES (NEW.student_id, NEW.id, 'APPOINTMENT_CANCELLED', 'Appointment cancelled',
                  format('Your appointment with %s on %s was cancelled.%s', v_faculty, v_when, v_note));
        END IF;
      ELSE
        NULL; -- COMPLETED: nothing to tell anyone.
    END CASE;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER appointments_notify
  AFTER INSERT OR UPDATE OF status ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_notify();

-- -----------------------------------------------------------------------------
-- Exceptions release overlapping appointments automatically.
-- When a faculty member records leave or a meeting, any upcoming PENDING request in that
-- period is rejected and any APPROVED appointment is cancelled — in the same transaction,
-- which (through the triggers above) also notifies each student and writes the audit trail.
-- -----------------------------------------------------------------------------
CREATE FUNCTION faculty_exceptions_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF upper(NEW.period) <= app_now() THEN
    RAISE EXCEPTION 'This period has already ended.'
      USING ERRCODE = 'AB008';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER faculty_exceptions_validate_insert
  BEFORE INSERT ON faculty_schedule_exceptions
  FOR EACH ROW EXECUTE FUNCTION faculty_exceptions_before_insert();

CREATE FUNCTION faculty_exceptions_release_appointments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE appointments a
     SET status = CASE a.status WHEN 'PENDING' THEN 'REJECTED'::appointment_status
                                ELSE 'CANCELLED'::appointment_status END,
         decision_note = format('Faculty unavailable (%s)%s', lower(NEW.kind::text), coalesce(': ' || NEW.reason, '')),
         cancelled_by  = CASE a.status WHEN 'APPROVED' THEN NEW.faculty_id END
   WHERE a.faculty_id = NEW.faculty_id
     AND a.status IN ('PENDING', 'APPROVED')
     AND a.slot && NEW.period
     AND lower(a.slot) > app_now();
  RETURN NULL;
END
$$;

CREATE TRIGGER faculty_exceptions_release_appointments
  AFTER INSERT ON faculty_schedule_exceptions
  FOR EACH ROW EXECUTE FUNCTION faculty_exceptions_release_appointments();

-- -----------------------------------------------------------------------------
-- process_elapsed_appointments: moves appointments whose time has passed to their final
-- state. Approved meetings that have ended become COMPLETED; requests the faculty member
-- never answered before their start time are closed as REJECTED with an explanation.
-- Two data-modifying CTEs run as one statement; the API calls this every minute.
-- -----------------------------------------------------------------------------
CREATE FUNCTION process_elapsed_appointments()
RETURNS TABLE (completed integer, expired integer)
LANGUAGE sql
AS $$
  WITH completed_rows AS (
    UPDATE appointments
       SET status = 'COMPLETED'
     WHERE status = 'APPROVED' AND upper(slot) <= app_now()
    RETURNING 1
  ),
  expired_rows AS (
    UPDATE appointments
       SET status = 'REJECTED',
           decision_note = 'Expired: the faculty member did not respond before the requested time.'
     WHERE status = 'PENDING' AND lower(slot) <= app_now()
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM completed_rows)::integer,
         (SELECT count(*) FROM expired_rows)::integer
$$;
