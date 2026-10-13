-- Up Migration
-- Background job queue (D-017, D-030): claimed with FOR UPDATE SKIP LOCKED, leased, retried.
CREATE TABLE jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  run_after timestamptz NOT NULL,
  locked_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX jobs_due_idx ON jobs (status, run_after);

-- Down Migration
DROP TABLE jobs;
