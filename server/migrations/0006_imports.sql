-- Up Migration
CREATE TABLE imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by uuid NOT NULL REFERENCES hr_users (id),
  file_name text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'validating', 'awaiting_confirmation', 'applying', 'completed', 'cancelled', 'expired', 'failed'
  )),
  -- Applied to every change the import makes.
  change_type text NOT NULL,
  effective_date date NOT NULL,
  note text NOT NULL,
  -- The uploaded CSV; cleared when the import ends (D-031).
  file bytea,
  row_count int NOT NULL,
  counts jsonb,
  preview_expires_at timestamptz,
  error text,
  created_at timestamptz NOT NULL,
  finished_at timestamptz
);

-- At most one import may be in progress, across all HR users (D-021).
CREATE UNIQUE INDEX one_active_import ON imports ((true))
  WHERE status IN ('validating', 'awaiting_confirmation', 'applying');

CREATE TABLE import_rows (
  import_id uuid NOT NULL REFERENCES imports (id),
  row_number int NOT NULL,
  employee_code text,
  -- Original values, for the rejected-rows CSV; cleared when the import ends (D-031).
  raw jsonb,
  preview_outcome text CHECK (preview_outcome IN ('create', 'update', 'unchanged', 'rejected')),
  outcome text CHECK (outcome IN ('created', 'updated', 'unchanged', 'rejected')),
  errors jsonb,
  applied_at timestamptz,
  PRIMARY KEY (import_id, row_number)
);

ALTER TABLE employee_changes
  ADD CONSTRAINT employee_changes_import_fk FOREIGN KEY (import_id) REFERENCES imports (id);

-- Down Migration
ALTER TABLE employee_changes DROP CONSTRAINT employee_changes_import_fk;
DROP TABLE import_rows;
DROP TABLE imports;
