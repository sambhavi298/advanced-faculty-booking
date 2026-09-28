-- =============================================================================
-- 0004 · Appointments and notifications
-- =============================================================================

CREATE TABLE appointments (
  -- uuidv7() (new in PostgreSQL 18): time-ordered UUIDs. Ids are not guessable/enumerable
  -- like 1, 2, 3…, yet new rows still append to the right edge of the primary-key B-tree.
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  student_id     bigint NOT NULL REFERENCES students (user_id) ON DELETE RESTRICT,
  faculty_id     bigint NOT NULL REFERENCES faculty (user_id) ON DELETE RESTRICT,
  slot           tstzrange NOT NULL,
  purpose        text NOT NULL,
  status         appointment_status NOT NULL DEFAULT 'PENDING',
  decision_note  text,
  decided_at     timestamptz,
  cancelled_at   timestamptz,
  cancelled_by   bigint REFERENCES users (id) ON DELETE SET NULL,
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- Shape of the time slot: finite, half-open [start, end), 10–60 minutes.
  CONSTRAINT appointments_slot_valid CHECK (
        NOT isempty(slot)
    AND NOT lower_inf(slot)
    AND NOT upper_inf(slot)
    AND lower_inc(slot)
    AND NOT upper_inc(slot)
  ),
  CONSTRAINT appointments_slot_length CHECK (upper(slot) - lower(slot) BETWEEN interval '10 minutes' AND interval '60 minutes'),
  CONSTRAINT appointments_purpose_length CHECK (char_length(btrim(purpose)) BETWEEN 10 AND 500),
  CONSTRAINT appointments_decision_note_length CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),

  -- Cross-column consistency between the status and its timestamps.
  CONSTRAINT appointments_pending_has_no_outcome CHECK (
    status <> 'PENDING' OR (decided_at IS NULL AND cancelled_at IS NULL AND completed_at IS NULL)
  ),
  CONSTRAINT appointments_decision_recorded CHECK (
    status NOT IN ('APPROVED', 'REJECTED', 'COMPLETED') OR decided_at IS NOT NULL
  ),
  CONSTRAINT appointments_cancellation_recorded CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CONSTRAINT appointments_completion_recorded CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),

  -- THE double-booking guarantee. No two active (pending or approved) appointments of the
  -- same faculty member may overlap in time. Enforced by a GiST index inside PostgreSQL,
  -- so it holds even when two students submit the same slot at the same instant: the second
  -- transaction waits for the first and then fails with SQLSTATE 23P01.
  CONSTRAINT appointments_no_double_booking
    EXCLUDE USING gist (faculty_id WITH =, slot WITH &&)
    WHERE (status IN ('PENDING', 'APPROVED')),

  -- A student cannot hold two overlapping active appointments (with different faculty).
  CONSTRAINT appointments_student_no_overlap
    EXCLUDE USING gist (student_id WITH =, slot WITH &&)
    WHERE (status IN ('PENDING', 'APPROVED'))
);

COMMENT ON TABLE appointments IS 'Appointment requests and their lifecycle: PENDING → APPROVED/REJECTED/CANCELLED; APPROVED → COMPLETED/CANCELLED.';
COMMENT ON COLUMN appointments.slot IS 'Absolute half-open time range [start, end) of the meeting.';
COMMENT ON COLUMN appointments.decision_note IS 'Reason given on rejection or cancellation, or a note on approval.';

-- Student "My Appointments": newest first.
CREATE INDEX appointments_student_recent_idx ON appointments (student_id, created_at DESC);

-- Faculty pending queue, today's schedule and history: filter by faculty + status, order by start time.
CREATE INDEX appointments_faculty_status_start_idx ON appointments (faculty_id, status, lower(slot));

-- -----------------------------------------------------------------------------
CREATE TABLE notifications (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id         bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  appointment_id  uuid REFERENCES appointments (id) ON DELETE CASCADE,
  kind            notification_kind NOT NULL,
  title           text NOT NULL,
  body            text NOT NULL,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE notifications IS 'In-app notifications, written by triggers on appointments (see 0006).';

CREATE INDEX notifications_user_recent_idx ON notifications (user_id, created_at DESC);

-- Partial index: only unread rows are indexed, so the unread badge stays cheap as history grows.
CREATE INDEX notifications_user_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
