-- Up Migration
CREATE TRIGGER exchange_rate_changes_append_only BEFORE UPDATE OR DELETE ON exchange_rate_changes
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- Down Migration
DROP TRIGGER exchange_rate_changes_append_only ON exchange_rate_changes;
