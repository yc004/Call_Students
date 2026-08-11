'use strict';

const assert = require('assert');
const {
  publicAccount,
  verifyAccountPassword,
  makeStoredAccount,
  generateLoginKey,
  parseLoginKey,
} = require('../account-auth');

const account = makeStoredAccount({ name: '张老师', password: 'school123', subjects: ['数学'] });
const secondAccount = makeStoredAccount({ name: '李老师', password: 'school123', subjects: [] });
assert.strictEqual(verifyAccountPassword(account, 'school123'), true);
assert.strictEqual(verifyAccountPassword(account, 'wrong-password'), false);
assert.strictEqual(Object.hasOwn(account, 'password'), false);
assert.notStrictEqual(account.passwordHash, secondAccount.passwordHash);
assert.strictEqual(Object.hasOwn(publicAccount(account), 'passwordHash'), false);
assert.strictEqual(verifyAccountPassword({ name: '旧账号', password: 'legacy' }, 'legacy'), true);
assert.match(account.connectionId, /^[a-f0-9-]{36}$/);

const loginKey = generateLoginKey(account);
assert.match(loginKey, /^TEACHER-KEY-1\./);
assert.deepStrictEqual(parseLoginKey(loginKey), account);
assert.throws(() => parseLoginKey('not-a-login-key'), /格式不正确/);
const changedLastChar = loginKey.endsWith('0') ? '1' : '0';
assert.throws(() => parseLoginKey(`${loginKey.slice(0, -1)}${changedLastChar}`), /损坏或不完整/);
assert.throws(() => generateLoginKey({ name: '旧账号', password: 'legacy' }), /安全升级/);

console.log('Account authentication tests passed.');
