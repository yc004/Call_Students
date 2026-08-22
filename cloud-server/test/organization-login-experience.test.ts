import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('organization mode uses administrator-issued credentials and mandatory first-login setup', () => {
  const migration = readFileSync(new URL('../migrations/007_organization_login_experience.sql', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
  const loginPage = readFileSync(new URL('../../mini-program/src/pages/login/index.wxml', import.meta.url), 'utf8');
  const adminPage = readFileSync(new URL('../admin-web/index.html', import.meta.url), 'utf8');
  const adminScript = readFileSync(new URL('../admin-web/app.js', import.meta.url), 'utf8');
  const tabBar = readFileSync(new URL('../../mini-program/src/custom-tab-bar/index.wxml', import.meta.url), 'utf8');
  const tabBarScript = readFileSync(new URL('../../mini-program/src/custom-tab-bar/index.js', import.meta.url), 'utf8');

  assert.match(migration, /must_change_password BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /primary_color/);
  assert.match(server, /defaultPassword:z\.string\(\)\.min\(8\)/);
  assert.match(server, /app\.patch\('\/api\/v1\/teacher\/profile'/);
  assert.match(server, /CURRENT_PASSWORD_INVALID/);
  assert.match(server, /currentPassword:z\.string\(\)\.min\(1\)/);
  assert.match(server, /organization:await organizationFor/);
  assert.match(server, /REGISTRATION_DISABLED/);
  assert.match(server, /WECHAT_LOGIN_DISABLED/);
  assert.equal((server.match(/addContentTypeParser\(\['image\/png'/g) || []).length, 1, 'avatar content parser must only be registered once');
  assert.doesNotMatch(loginPage, /身份密钥|微信一键登录|注册云服务/);
  assert.match(loginPage, /个人免费使用/);
  assert.match(loginPage, /组织团队使用/);
  assert.match(adminPage, /brandLogo/);
  assert.match(adminScript, /applyOrganizationBranding/);
  assert.match(tabBar, /iconFilter/);
  assert.match(tabBarScript, /hueOf/);
});
