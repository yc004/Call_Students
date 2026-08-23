-- ToB organization branding and administrator-issued teacher credentials.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS short_name VARCHAR(40);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS primary_color VARCHAR(7) NOT NULL DEFAULT '#2563EB';

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

UPDATE organizations SET short_name=LEFT(name, 12) WHERE short_name IS NULL OR BTRIM(short_name)='';
