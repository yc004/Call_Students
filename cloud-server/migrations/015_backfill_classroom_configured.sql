UPDATE classrooms c
SET configured = true,
    revision = revision + 1,
    last_cloud_mutation_at = now(),
    updated_at = now()
WHERE c.deleted_at IS NULL
  AND btrim(c.name) <> ''
  AND c.configured = false
  AND EXISTS (
    SELECT 1 FROM students s
    WHERE s.classroom_id = c.id AND s.status = 'active'
  );
