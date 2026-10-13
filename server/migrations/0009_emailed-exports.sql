-- Up Migration
-- Emailed PDF exports (D-016, D-018): the file is built by a background job and kept until it
-- expires. Direct downloads stay 'completed'.
ALTER TABLE exports
  ADD COLUMN status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'queued', 'ready', 'failed')),
  ADD COLUMN file bytea,
  ADD COLUMN file_name text,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN email_sent_at timestamptz,
  ADD COLUMN error text;

-- Down Migration
ALTER TABLE exports
  DROP COLUMN status,
  DROP COLUMN file,
  DROP COLUMN file_name,
  DROP COLUMN expires_at,
  DROP COLUMN email_sent_at,
  DROP COLUMN error;
