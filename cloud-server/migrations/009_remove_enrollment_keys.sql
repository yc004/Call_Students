UPDATE users
SET status = 'active', auth_version = auth_version + 1, updated_at = now()
WHERE server_role = 'teacher' AND status <> 'active' AND deleted_at IS NULL;

-- Enrollment-key routes and runtime services were removed in v2.1. The legacy
-- table is intentionally left untouched so deployment does not destroy
-- historical data without a separately approved retention operation.
