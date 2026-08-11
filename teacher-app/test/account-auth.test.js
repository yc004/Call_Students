'use strict';

const assert = require('assert');
const { publicAccount, verifyAccountPassword, makeStoredAccount } = require('../account-auth');

const account = makeStoredAccount({ name: '张老师', password: 'school123', subjects: ['数学'] });
const secondAccount = makeStoredAccount({ name: '李老师', password: 'school123', subjects: [] });
assert.strictEqual(verifyAccountPassword(account, 'school123'), true);
assert.strictEqual(verifyAccountPassword(account, 'wrong-password'), false);
assert.strictEqual(Object.hasOwn(account, 'password'), false);
assert.notStrictEqual(account.passwordHash, secondAccount.passwordHash);
assert.strictEqual(Object.hasOwn(publicAccount(account), 'passwordHash'), false);
assert.strictEqual(verifyAccountPassword({ name: '旧账号', password: 'legacy' }, 'legacy'), true);
assert.match(account.connectionId, /^[a-f0-9-]{36}$/);

console.log('Account authentication tests passed.');
