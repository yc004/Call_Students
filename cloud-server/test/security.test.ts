import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOpaqueToken, hashOpaqueToken, hashPassword, signAccessToken, verifyAccessToken, verifyPassword } from '../src/security.js';
import type { CloudConfig } from '../src/config.js';

const config:CloudConfig = {
  NODE_ENV:'test', HOST:'127.0.0.1', PORT:8080, PUBLIC_URL:'https://cloud.example.test',
  DATABASE_URL:'postgresql://unused', ACCESS_TOKEN_SECRET:'a'.repeat(32), KEY_PEPPER:'b'.repeat(32),
  SETUP_TOKEN:'setup-token-1234567890', ACCESS_TOKEN_TTL_SECONDS:900, REFRESH_TOKEN_TTL_DAYS:30,
  TRUST_PROXY:false, LOG_LEVEL:'silent', WECHAT_APP_ID:undefined, WECHAT_APP_SECRET:undefined,
};

test('password hashes verify without storing plaintext', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
  assert.equal(hash.includes('correct horse'), false);
});

test('opaque connection keys are random and deterministically hashed', () => {
  const first = generateOpaqueToken('ck');
  const second = generateOpaqueToken('ck');
  assert.match(first, /^ck_[A-Za-z0-9_-]+$/);
  assert.notEqual(first, second);
  assert.equal(hashOpaqueToken(first, config.KEY_PEPPER), hashOpaqueToken(first, config.KEY_PEPPER));
});

test('access tokens preserve scoped identity', async () => {
  const subject = { subjectType:'user' as const, subjectId:'user-1', organizationId:'org-1', role:'admin', deviceId:'device-1' };
  const token = await signAccessToken(subject, config);
  assert.deepEqual(await verifyAccessToken(token, config), subject);
});
