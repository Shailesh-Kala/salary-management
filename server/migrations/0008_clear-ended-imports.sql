-- Up Migration

-- When an import ends, drop its uploaded file and every row's raw values in the same statement
-- (D-031, D-051). Row number, employee code, outcome and errors stay.
CREATE FUNCTION clear_ended_import() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.file := NULL;
  UPDATE import_rows SET raw = NULL WHERE import_id = NEW.id AND raw IS NOT NULL;
  RETURN NEW;
END $$;

CREATE TRIGGER clear_ended_import
  BEFORE UPDATE ON imports
  FOR EACH ROW
  WHEN (NEW.status IN ('completed', 'cancelled', 'failed', 'expired'))
  EXECUTE FUNCTION clear_ended_import();

-- Down Migration
DROP TRIGGER clear_ended_import ON imports;
DROP FUNCTION clear_ended_import();
