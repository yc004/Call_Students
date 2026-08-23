-- Mini-program account/password and WeChat identity support for teacher accounts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- login_name is already unique per organization, but make teacher logins
-- explicitly safe when they start using account/password logins.
CREATE UNIQUE INDEX IF NOT EXISTS users_unique_teacher_login
ON users (organization_id, login_name)
WHERE login_name IS NOT NULL AND server_role = 'teacher';
