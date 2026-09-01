import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('WeChat identity is exchanged server-side and globally unique for active users', () => {
  const service=readFileSync(new URL('../src/modules/auth/auth.service.ts',import.meta.url),'utf8');
  const controller=readFileSync(new URL('../src/modules/auth/auth.controller.ts',import.meta.url),'utf8');
  const migration=readFileSync(new URL('../migrations/013_wechat_identity.sql',import.meta.url),'utf8');
  assert.match(service,/api\.weixin\.qq\.com\/sns\/jscode2session/);
  assert.match(service,/WECHAT_APP_SECRET/);
  assert.match(service,/must_change_password/);
  assert.match(service,/当前微信已经绑定其他组织账户/);
  assert.match(controller,/auth\/wechat\/login/);
  assert.match(controller,/auth\/wechat\/bind/);
  assert.match(migration,/UNIQUE INDEX/);
  assert.match(migration,/deleted_at IS NULL/);
});
