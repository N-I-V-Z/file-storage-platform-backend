CREATE FUNCTION expire_deleted_project_audit() RETURNS trigger AS $$
BEGIN
    UPDATE audit_events
    SET purge_after = COALESCE(purge_after, clock_timestamp() + INTERVAL '90 days')
    WHERE project_id = OLD.id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_audit_retention
AFTER DELETE ON projects
FOR EACH ROW EXECUTE FUNCTION expire_deleted_project_audit();

-- Pre-existing orphan rows have no deletion timestamp. Give them a full
-- retention window from this migration instead of deleting them early.
UPDATE audit_events AS event
SET purge_after = clock_timestamp() + INTERVAL '90 days'
WHERE purge_after IS NULL
  AND NOT EXISTS (SELECT 1 FROM projects WHERE id = event.project_id);
