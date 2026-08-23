ALTER TABLE enrollment_keys
  ADD COLUMN IF NOT EXISTS target_user_id UUID REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE classroom_members
  ADD COLUMN IF NOT EXISTS sync_source VARCHAR(20) NOT NULL DEFAULT 'cloud';

ALTER TABLE enrollment_keys DROP CONSTRAINT IF EXISTS enrollment_key_scope_valid;

-- Membership keys represented a classroom action, not a client identity. They
-- are intentionally retired. Existing classroom memberships remain untouched.
UPDATE enrollment_keys
SET revoked_at = COALESCE(revoked_at, now())
WHERE key_type = 'membership';

-- Old unassigned teacher keys cannot safely identify one unique cloud user.
-- Revoking the key does not affect accounts or devices created from it.
UPDATE enrollment_keys
SET revoked_at = COALESCE(revoked_at, now())
WHERE key_type = 'teacher' AND target_user_id IS NULL;

-- Preserve one local identity owner if an early deployment created duplicates,
-- then enforce organization-wide uniqueness for future account binding.
WITH duplicate_links AS (
  SELECT id, row_number() OVER (
    PARTITION BY organization_id, legacy_connection_id ORDER BY created_at, id
  ) AS duplicate_number
  FROM users
  WHERE legacy_connection_id IS NOT NULL
)
UPDATE users
SET legacy_connection_id = NULL,
    updated_at = now()
WHERE id IN (SELECT id FROM duplicate_links WHERE duplicate_number > 1);

CREATE UNIQUE INDEX IF NOT EXISTS users_unique_local_identity
ON users (organization_id, legacy_connection_id)
WHERE legacy_connection_id IS NOT NULL;

ALTER TABLE enrollment_keys ADD CONSTRAINT enrollment_key_scope_valid CHECK (
  (key_type = 'teacher' AND target_user_id IS NOT NULL AND target_classroom_id IS NULL AND role IS NULL)
  OR (key_type = 'classroom' AND target_classroom_id IS NOT NULL AND target_user_id IS NULL)
  OR (key_type IN ('teacher', 'membership') AND revoked_at IS NOT NULL)
);
