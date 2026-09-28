-- =============================================================================
-- 0005 · Audit logging
-- =============================================================================
-- Every INSERT / UPDATE / DELETE on the business tables is recorded by a trigger in the
-- SAME transaction as the change: an audit row exists if and only if the change committed,
-- and no application code path (or manual SQL session) can skip it.
--
-- Who did it: the API runs every write transaction with
--   SELECT set_config('app.user_id', '<id>', true), set_config('app.user_role', '<role>', true)
-- (transaction-local settings). The trigger reads them. Changes made outside the API
-- (migrations, seed, psql) are recorded with a NULL actor, i.e. "system".

CREATE TABLE audit_logs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  transaction_id  xid8 NOT NULL DEFAULT pg_current_xact_id(),
  -- Deliberately no foreign key: audit history must survive the deletion of the user it names.
  actor_user_id   bigint,
  actor_role      user_role,
  table_name      text NOT NULL,
  record_id       text NOT NULL,
  action          text NOT NULL,
  old_data        jsonb,
  new_data        jsonb,
  changed_fields  text[],
  CONSTRAINT audit_logs_action_valid CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  CONSTRAINT audit_logs_payload_matches_action CHECK (
       (action = 'INSERT' AND old_data IS NULL     AND new_data IS NOT NULL)
    OR (action = 'UPDATE' AND old_data IS NOT NULL AND new_data IS NOT NULL)
    OR (action = 'DELETE' AND old_data IS NOT NULL AND new_data IS NULL)
  )
);

COMMENT ON TABLE audit_logs IS 'Append-only change history of business tables, written by audit_row_change().';

-- Audit rows arrive in time order, so occurred_at is physically correlated with row order.
-- A BRIN index stores one min/max summary per block range: a few KB even for millions of rows,
-- versus a B-tree the size of the column.
CREATE INDEX audit_logs_occurred_at_brin ON audit_logs USING brin (occurred_at);

-- "History of this appointment / this user".
CREATE INDEX audit_logs_record_idx ON audit_logs (table_name, record_id);

-- "What did this person do" — partial: system rows (NULL actor) are not indexed.
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, occurred_at DESC) WHERE actor_user_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Generic row-audit trigger. TG_ARGV[0] names the table's primary-key column.
-- -----------------------------------------------------------------------------
CREATE FUNCTION audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_old      jsonb;
  v_new      jsonb;
  v_changed  text[];
  v_actor    text := nullif(current_setting('app.user_id', true), '');
  v_role     text := nullif(current_setting('app.user_role', true), '');
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old := to_jsonb(OLD);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new := to_jsonb(NEW);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(n.key ORDER BY n.key)
      INTO v_changed
      FROM jsonb_each(v_new) AS n
     WHERE n.value IS DISTINCT FROM v_old -> n.key
       AND n.key <> 'updated_at';

    -- An UPDATE that changed nothing but updated_at is not worth an audit row.
    IF v_changed IS NULL THEN
      RETURN NULL;
    END IF;
  END IF;

  -- Password hashes never enter the audit trail; a change is still recorded by name.
  v_old := v_old - 'password_hash';
  v_new := v_new - 'password_hash';

  INSERT INTO audit_logs (actor_user_id, actor_role, table_name, record_id, action, old_data, new_data, changed_fields)
  VALUES (
    v_actor::bigint,
    v_role::user_role,
    TG_TABLE_NAME,
    coalesce(v_new, v_old) ->> TG_ARGV[0],
    TG_OP,
    v_old,
    v_new,
    v_changed
  );
  RETURN NULL;
END
$$;

CREATE TRIGGER audit_departments AFTER INSERT OR UPDATE OR DELETE ON departments
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id');
CREATE TRIGGER audit_batches AFTER INSERT OR UPDATE OR DELETE ON batches
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id');
CREATE TRIGGER audit_users AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id');
CREATE TRIGGER audit_students AFTER INSERT OR UPDATE OR DELETE ON students
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('user_id');
CREATE TRIGGER audit_faculty AFTER INSERT OR UPDATE OR DELETE ON faculty
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('user_id');
CREATE TRIGGER audit_batch_schedule AFTER INSERT OR UPDATE OR DELETE ON batch_schedule
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id');
CREATE TRIGGER audit_faculty_availability AFTER INSERT OR UPDATE OR DELETE ON faculty_availability
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id');
CREATE TRIGGER audit_faculty_schedule_exceptions AFTER INSERT OR UPDATE OR DELETE ON faculty_schedule_exceptions
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id');
CREATE TRIGGER audit_appointments AFTER INSERT OR UPDATE OR DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION audit_row_change('id');

-- -----------------------------------------------------------------------------
-- Append-only: audit rows can be inserted, never changed or removed.
-- -----------------------------------------------------------------------------
CREATE FUNCTION audit_logs_reject_modification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_modification();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_modification();
