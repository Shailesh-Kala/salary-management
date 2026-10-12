-- Up Migration
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code text NOT NULL CHECK (employee_code = upper(employee_code)),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL CHECK (email = lower(email)),
  job_title text NOT NULL,
  department text NOT NULL,
  country_code char(2) NOT NULL REFERENCES countries (code),
  hire_date date NOT NULL,
  base_salary numeric(14, 2) NOT NULL CHECK (base_salary > 0),
  allowances numeric(14, 2) NOT NULL DEFAULT 0 CHECK (allowances >= 0),
  exit_type text CHECK (exit_type IN ('resigned', 'terminated')),
  notice_date date,
  last_working_day date,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employees_employee_code_key UNIQUE (employee_code),
  CONSTRAINT employees_email_key UNIQUE (email),
  -- Exit fields are all set or all empty, and in date order.
  CONSTRAINT employees_exit_fields CHECK (
    (exit_type IS NULL) = (notice_date IS NULL) AND (notice_date IS NULL) = (last_working_day IS NULL)
  ),
  CONSTRAINT employees_exit_dates CHECK (
    notice_date IS NULL OR (hire_date <= notice_date AND notice_date <= last_working_day)
  )
);

CREATE INDEX employees_country_idx ON employees (country_code);
CREATE INDEX employees_department_idx ON employees (department);
CREATE INDEX employees_job_title_idx ON employees (job_title);
CREATE INDEX employees_last_working_day_idx ON employees (last_working_day);
CREATE INDEX employees_name_idx ON employees (last_name, first_name);
CREATE INDEX employees_search_idx ON employees
  USING gin (lower(first_name || ' ' || last_name || ' ' || email || ' ' || employee_code) gin_trgm_ops);

-- Append-only audit and history of salary, title, department, country and lifecycle (D-011).
CREATE TABLE employee_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES employees (id),
  change_type text NOT NULL CHECK (change_type IN (
    'hire', 'annual_review', 'promotion', 'market_adjustment', 'relocation',
    'correction', 'exit', 'exit_withdrawn', 'other'
  )),
  effective_date date NOT NULL,
  note text NOT NULL CHECK (char_length(note) BETWEEN 5 AND 1000),
  source text NOT NULL CHECK (source IN ('ui', 'import', 'seed')),
  changes jsonb NOT NULL,
  -- Values in effect after this change; slips read these, so old slips keep the old currency.
  base_salary numeric(14, 2) NOT NULL,
  allowances numeric(14, 2) NOT NULL,
  currency_code char(3) NOT NULL REFERENCES exchange_rates (currency_code),
  country_code char(2) NOT NULL REFERENCES countries (code),
  job_title text NOT NULL,
  department text NOT NULL,
  changed_by uuid NOT NULL REFERENCES hr_users (id),
  import_id uuid,
  import_row_number int,
  changed_at timestamptz NOT NULL,
  CONSTRAINT employee_changes_import_row_key UNIQUE (import_id, import_row_number)
);

CREATE INDEX employee_changes_timeline_idx ON employee_changes (employee_id, effective_date DESC, id DESC);
CREATE INDEX employee_changes_changed_at_idx ON employee_changes (changed_at);

CREATE FUNCTION reject_modification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER employee_changes_append_only BEFORE UPDATE OR DELETE ON employee_changes
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- Down Migration
DROP TABLE employee_changes;
DROP FUNCTION reject_modification();
DROP TABLE employees;
