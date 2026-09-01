CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  code VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0 AND sort_order <= 9999),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS subjects_unique_name
  ON subjects(organization_id,lower(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subjects_unique_code
  ON subjects(organization_id,lower(code)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS subjects_org_status_sort
  ON subjects(organization_id,status,sort_order,name) WHERE deleted_at IS NULL;

INSERT INTO subjects(organization_id,name,code,sort_order)
SELECT o.id,v.name,v.code,v.sort_order
FROM organizations o CROSS JOIN (VALUES
  ('语文','chinese',10),('数学','mathematics',20),('英语','english',30),
  ('物理','physics',40),('化学','chemistry',50),('生物','biology',60),
  ('政治','politics',70),('历史','history',80),('地理','geography',90),
  ('信息技术','information-technology',100),('体育','physical-education',110),
  ('音乐','music',120),('美术','art',130)
) v(name,code,sort_order)
ON CONFLICT DO NOTHING;

-- Preserve every subject already used by the legacy free-text model by adding
-- it to the organization catalog. Historical records themselves stay intact.
INSERT INTO subjects(organization_id,name,code,sort_order)
SELECT DISTINCT c.organization_id,s.name,'legacy-' || left(md5(s.name),12),900
FROM classroom_members m
JOIN classrooms c ON c.id=m.classroom_id
CROSS JOIN LATERAL jsonb_array_elements_text(m.subjects_json) AS s(name)
WHERE length(trim(s.name)) BETWEEN 1 AND 80
ON CONFLICT DO NOTHING;

INSERT INTO subjects(organization_id,name,code,sort_order)
SELECT DISTINCT c.organization_id,trim(a.subject),'legacy-' || left(md5(trim(a.subject)),12),900
FROM assignments a JOIN classrooms c ON c.id=a.classroom_id
WHERE length(trim(a.subject)) BETWEEN 1 AND 80
ON CONFLICT DO NOTHING;
