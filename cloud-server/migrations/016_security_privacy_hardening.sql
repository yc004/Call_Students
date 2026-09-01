-- Remove recognition-derived operational data that earlier versions stored in
-- the cloud despite the local-only biometric boundary.
UPDATE classroom_devices
SET operational_status_json='{}'::jsonb,
    operational_status_updated_at=NULL
WHERE operational_status_json<>'{}'::jsonb;

-- Login is case-insensitive, so uniqueness must use the same normalization.
CREATE UNIQUE INDEX IF NOT EXISTS users_unique_normalized_login
ON users (organization_id, lower(login_name))
WHERE login_name IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS classroom_accounts_unique_normalized_login
ON classroom_accounts (organization_id, lower(login_name));

-- A campus-scoped administrator cannot safely create or globally mutate users
-- because users do not currently have an owning campus.
DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id=r.id AND r.code='campus_admin' AND rp.permission_key IN('user.read','user.manage');

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS family_id UUID,
  ADD COLUMN IF NOT EXISTS replaced_by UUID REFERENCES refresh_tokens(id) ON DELETE SET NULL;

UPDATE refresh_tokens SET family_id=id WHERE family_id IS NULL;
ALTER TABLE refresh_tokens ALTER COLUMN family_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS refresh_tokens_family ON refresh_tokens(family_id);

ALTER TABLE classroom_devices ADD COLUMN IF NOT EXISTS installation_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS classroom_devices_installation
ON classroom_devices(classroom_id,installation_id)
WHERE installation_id IS NOT NULL;
