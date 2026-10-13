-- Up Migration
-- Every attempt to download an emailed export is recorded (D-018), allowed or not.
ALTER TABLE exports ADD COLUMN deleted_at timestamptz;

CREATE TABLE export_downloads (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  export_id uuid NOT NULL REFERENCES exports (id),
  user_id uuid NOT NULL REFERENCES hr_users (id),
  outcome text NOT NULL CHECK (outcome IN ('downloaded', 'forbidden', 'expired')),
  at timestamptz NOT NULL
);

CREATE INDEX export_downloads_export_idx ON export_downloads (export_id);

CREATE TRIGGER export_downloads_append_only BEFORE UPDATE OR DELETE ON export_downloads
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- Down Migration
DROP TABLE export_downloads;
ALTER TABLE exports DROP COLUMN deleted_at;
