-- Existing deployments created before local snapshot mirroring used UUID-only
-- identifiers. Desktop clients already own stable string IDs, so preserve them
-- verbatim to keep WebSocket commands and cloud snapshots interoperable.
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_assignment_id_fkey;
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_student_id_fkey;

ALTER TABLE students ALTER COLUMN id DROP DEFAULT;
ALTER TABLE students ALTER COLUMN id TYPE TEXT USING id::text;
ALTER TABLE students ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

ALTER TABLE assignments ALTER COLUMN id DROP DEFAULT;
ALTER TABLE assignments ALTER COLUMN id TYPE TEXT USING id::text;
ALTER TABLE assignments ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

ALTER TABLE submissions ALTER COLUMN assignment_id TYPE TEXT USING assignment_id::text;
ALTER TABLE submissions ALTER COLUMN student_id TYPE TEXT USING student_id::text;
ALTER TABLE submissions ADD CONSTRAINT submissions_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE;
ALTER TABLE submissions ADD CONSTRAINT submissions_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
