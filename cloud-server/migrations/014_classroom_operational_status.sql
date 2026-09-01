ALTER TABLE classroom_devices
ADD COLUMN IF NOT EXISTS operational_status_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE classroom_devices
ADD COLUMN IF NOT EXISTS operational_status_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS classroom_devices_operational_status_lookup
ON classroom_devices (classroom_id, operational_status_updated_at DESC)
WHERE revoked_at IS NULL;
