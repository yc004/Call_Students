ALTER TABLE classroom_devices
ADD COLUMN IF NOT EXISTS lan_addresses_json JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS classroom_devices_online_lookup
ON classroom_devices (classroom_id, last_seen_at DESC)
WHERE revoked_at IS NULL;
