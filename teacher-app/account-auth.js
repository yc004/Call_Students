'use strict';

const crypto = require('crypto');

function publicAccount(account) {
  if (!account) return null;
  return {
    name: account.name,
    subjects: account.subjects || [],
    connectionId: account.connectionId,
  };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyAccountPassword(account, password) {
  if (!account) return false;
  if (typeof account.password === 'string') return account.password === password;
  if (!account.passwordHash || !account.passwordSalt) return false;
  const actual = Buffer.from(hashPassword(password, account.passwordSalt), 'hex');
  const expected = Buffer.from(account.passwordHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function makeStoredAccount(input, existingConnectionId) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    name: input.name.trim(),
    subjects: input.subjects || [],
    connectionId: existingConnectionId || crypto.randomUUID(),
    passwordSalt: salt,
    passwordHash: hashPassword(input.password, salt),
  };
}

module.exports = { publicAccount, verifyAccountPassword, makeStoredAccount };
