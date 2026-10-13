-- Up Migration
-- Who confirmed the import: the author of every change it applies.
ALTER TABLE imports ADD COLUMN confirmed_by uuid REFERENCES hr_users (id);

-- Down Migration
ALTER TABLE imports DROP COLUMN confirmed_by;
