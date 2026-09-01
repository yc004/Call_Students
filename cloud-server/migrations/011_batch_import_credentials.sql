CREATE TABLE IF NOT EXISTS classroom_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  classroom_id UUID NOT NULL UNIQUE REFERENCES classrooms(id) ON DELETE CASCADE,
  login_name VARCHAR(80) NOT NULL,
  password_hash TEXT NOT NULL,
  auth_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS classroom_accounts_org_login_lower_unique
ON classroom_accounts (organization_id, lower(login_name));
