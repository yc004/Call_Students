-- Enterprise v2 foundation. Legacy tables are upgraded in place so existing
-- organization, classroom and teaching data remain available to the new API.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS slug VARCHAR(80),
  ADD COLUMN IF NOT EXISTS plan VARCHAR(30) NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

UPDATE organizations SET slug='org-' || left(replace(id::text,'-',''),12) WHERE slug IS NULL;
ALTER TABLE organizations ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_unique_slug ON organizations(lower(slug));

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS campuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  code VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','archived')),
  address TEXT,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (organization_id,code)
);

ALTER TABLE classrooms
  ADD COLUMN IF NOT EXISTS campus_id UUID REFERENCES campuses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS permissions (
  key VARCHAR(100) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(50) NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(60) NOT NULL,
  name VARCHAR(80) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  data_scope VARCHAR(20) NOT NULL DEFAULT 'organization' CHECK (data_scope IN ('organization','campus','classroom','self')),
  is_system BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id,code)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key VARCHAR(100) NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY(role_id,permission_key)
);

CREATE TABLE IF NOT EXISTS user_role_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  scope_type VARCHAR(20) NOT NULL DEFAULT 'organization' CHECK (scope_type IN ('organization','campus','classroom')),
  scope_id UUID,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  UNIQUE(user_id,role_id,scope_type,scope_id)
);

CREATE TABLE IF NOT EXISTS login_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  login_name VARCHAR(80),
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('success','failure','blocked')),
  reason VARCHAR(80),
  ip_address INET,
  user_agent TEXT,
  request_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('info','warning','critical')),
  event_type VARCHAR(100) NOT NULL,
  target_type VARCHAR(50),
  target_id TEXT,
  request_id VARCHAR(100),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  aggregate_type VARCHAR(60) NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','published','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS background_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  job_type VARCHAR(100) NOT NULL,
  idempotency_key VARCHAR(160),
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  last_error TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(20) NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS user_agent TEXT;

INSERT INTO permissions(key,name,category,description) VALUES
 ('organization.read','查看组织','organization','查看组织资料与设置'),
 ('organization.manage','管理组织','organization','修改组织资料与设置'),
 ('campus.read','查看校区','campus','查看授权范围内的校区'),
 ('campus.manage','管理校区','campus','创建、修改和归档校区'),
 ('user.read','查看用户','identity','查看授权范围内的用户'),
 ('user.manage','管理用户','identity','创建、修改、停用和恢复用户'),
 ('role.read','查看角色','authorization','查看角色与权限'),
 ('role.manage','管理角色','authorization','创建角色、配置权限和授权'),
 ('classroom.read','查看教室','classroom','查看授权范围内的教室'),
 ('classroom.manage','管理教室','classroom','创建、修改和归档教室'),
 ('device.read','查看设备','device','查看设备、版本和在线状态'),
 ('device.manage','管理设备','device','吊销设备和会话'),
 ('content.read','查看教学内容','teaching','查看授权范围内的教学内容'),
 ('content.manage','管理教学内容','teaching','管理授权范围内的教学内容'),
 ('audit.read','查看审计','security','检索审计与安全事件'),
 ('audit.export','导出审计','security','导出审计记录'),
 ('operations.read','查看运维状态','operations','查看健康、迁移和任务状态'),
 ('operations.manage','管理后台任务','operations','重试或取消后台任务')
ON CONFLICT(key) DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,description=EXCLUDED.description;

INSERT INTO roles(organization_id,code,name,description,data_scope,is_system)
SELECT o.id,v.code,v.name,v.description,v.data_scope,true FROM organizations o CROSS JOIN (VALUES
 ('organization_owner','组织所有者','组织全部管理权限','organization'),
 ('organization_admin','组织管理员','组织日常管理权限','organization'),
 ('campus_admin','校区管理员','指定校区管理权限','campus'),
 ('security_auditor','安全审计员','只读审计和安全检查','organization')
) v(code,name,description,data_scope)
ON CONFLICT(organization_id,code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r CROSS JOIN permissions p WHERE r.code='organization_owner'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key=ANY(ARRAY[
 'organization.read','organization.manage','campus.read','campus.manage','user.read','user.manage',
 'role.read','classroom.read','classroom.manage','device.read','device.manage','content.read','content.manage',
 'audit.read','operations.read'
]) WHERE r.code='organization_admin' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key=ANY(ARRAY[
 'campus.read','campus.manage','user.read','user.manage','classroom.read','classroom.manage',
 'device.read','device.manage','content.read','content.manage'
]) WHERE r.code='campus_admin' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key=ANY(ARRAY[
 'organization.read','campus.read','user.read','role.read','classroom.read','device.read','content.read',
 'audit.read','audit.export','operations.read'
]) WHERE r.code='security_auditor' ON CONFLICT DO NOTHING;

INSERT INTO user_role_bindings(organization_id,user_id,role_id,scope_type,scope_id,created_by)
SELECT u.organization_id,u.id,r.id,'organization',u.organization_id,u.id
FROM users u JOIN roles r ON r.organization_id=u.organization_id AND r.code='organization_owner'
WHERE u.server_role='admin' ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_campuses_org_status ON campuses(organization_id,status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_classrooms_org_campus ON classrooms(organization_id,campus_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_role_bindings_user ON user_role_bindings(user_id,organization_id);
CREATE INDEX IF NOT EXISTS idx_login_events_org_created ON login_events(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_org_created ON security_events(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(status,available_at) WHERE status IN ('pending','failed');
CREATE UNIQUE INDEX IF NOT EXISTS background_jobs_idempotency ON background_jobs(organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_background_jobs_status ON background_jobs(status,available_at);
