-- Up Migration
-- Audit of every export (who, what, which filters, how many rows); file storage for emailed
-- exports is added with that feature.
CREATE TABLE exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL REFERENCES hr_users (id),
  format text NOT NULL CHECK (format IN ('csv', 'xlsx', 'pdf')),
  delivery text NOT NULL CHECK (delivery IN ('direct', 'email')),
  filters jsonb NOT NULL,
  row_count int NOT NULL,
  created_at timestamptz NOT NULL
);

-- Down Migration
DROP TABLE exports;
