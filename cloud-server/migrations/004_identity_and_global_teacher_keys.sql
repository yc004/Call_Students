-- Superseded by 005_entity_identity_keys.sql. Kept immutable in the migration
-- sequence so databases that already applied this version upgrade safely.
ALTER TABLE classroom_devices
  ADD COLUMN IF NOT EXISTS client_type VARCHAR(30) NOT NULL DEFAULT 'classroom-desktop';

-- Teacher account enrollment is organization-wide. Classroom membership is a
-- separate, explicitly auditable action using a membership key.
UPDATE enrollment_keys
SET target_classroom_id = NULL,
    role = NULL,
    subjects_json = '[]'::jsonb
WHERE key_type = 'teacher';

ALTER TABLE enrollment_keys DROP CONSTRAINT IF EXISTS enrollment_key_scope_valid;
ALTER TABLE enrollment_keys ADD CONSTRAINT enrollment_key_scope_valid CHECK (
  (key_type = 'teacher' AND target_classroom_id IS NULL AND role IS NULL)
  OR (key_type = 'classroom' AND target_classroom_id IS NOT NULL)
  OR (key_type = 'membership' AND target_classroom_id IS NOT NULL AND role IN ('teacher', 'homeroom'))
);
