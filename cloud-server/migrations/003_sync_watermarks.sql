ALTER TABLE classrooms ADD COLUMN IF NOT EXISTS last_device_sync_at TIMESTAMPTZ;
ALTER TABLE classrooms ADD COLUMN IF NOT EXISTS last_cloud_mutation_at TIMESTAMPTZ;
