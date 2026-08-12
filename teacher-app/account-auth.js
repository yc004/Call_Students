'use strict';

const crypto = require('crypto');

const LOGIN_KEY_PREFIX = 'TEACHER-KEY-1';
const MINI_PROGRAM_LOGIN_PREFIX = 'CLASSROOM-CALL-MINI-1';

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

function generateLoginKey(account) {
  if (!account || !account.passwordSalt || !account.passwordHash) {
    throw new Error('账户尚未完成安全升级，请先使用密码重新登录');
  }
  const payload = {
    version: 1,
    name: account.name,
    subjects: account.subjects || [],
    connectionId: account.connectionId,
    passwordSalt: account.passwordSalt,
    passwordHash: account.passwordHash,
    createdAt: new Date().toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const checksum = crypto.createHash('sha256').update(encoded).digest('hex').slice(0, 24);
  return `${LOGIN_KEY_PREFIX}.${encoded}.${checksum}`;
}

function parseLoginKey(loginKey) {
  const parts = String(loginKey || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== LOGIN_KEY_PREFIX) {
    throw new Error('登录密钥格式不正确');
  }
  const expectedChecksum = crypto.createHash('sha256').update(parts[1]).digest('hex').slice(0, 24);
  const actualChecksum = parts[2];
  const expectedBuffer = Buffer.from(expectedChecksum, 'utf8');
  const actualBuffer = Buffer.from(actualChecksum, 'utf8');
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new Error('登录密钥已损坏或不完整');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (_error) {
    throw new Error('登录密钥内容无法读取');
  }
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const subjects = Array.isArray(payload.subjects)
    ? payload.subjects.map(item => String(item).trim()).filter(Boolean)
    : [];
  if (payload.version !== 1 || !name || name.length > 20) throw new Error('登录密钥中的账户信息无效');
  if (subjects.length > 20 || subjects.some(item => item.length > 30)) throw new Error('登录密钥中的学科信息无效');
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(String(payload.connectionId || ''))) throw new Error('登录密钥中的身份信息无效');
  if (!/^[a-f0-9]{32}$/i.test(String(payload.passwordSalt || ''))) throw new Error('登录密钥中的安全信息无效');
  if (!/^[a-f0-9]{128}$/i.test(String(payload.passwordHash || ''))) throw new Error('登录密钥中的安全信息无效');

  return {
    name,
    subjects: [...new Set(subjects)],
    connectionId: payload.connectionId,
    passwordSalt: payload.passwordSalt.toLowerCase(),
    passwordHash: payload.passwordHash.toLowerCase(),
  };
}

function generateMiniProgramLoginPayload(account, rooms = []) {
  const safeRooms = (Array.isArray(rooms) ? rooms : []).slice(0, 8).map(room => ({
    id: String(room.id || '').slice(0, 80),
    name: String(room.name || room.ip || '教室').slice(0, 40),
    ip: String(room.ip || '').trim().slice(0, 255),
  })).filter(room => room.ip);
  const payload = {
    version: 1,
    loginKey: generateLoginKey(account),
    rooms: safeRooms,
    createdAt: new Date().toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const checksum = crypto.createHash('sha256').update(encoded).digest('hex').slice(0, 24);
  return `${MINI_PROGRAM_LOGIN_PREFIX}.${encoded}.${checksum}`;
}

function parseMiniProgramLoginPayload(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== MINI_PROGRAM_LOGIN_PREFIX) throw new Error('小程序登录二维码格式不正确');
  const expected = crypto.createHash('sha256').update(parts[1]).digest('hex').slice(0, 24);
  if (expected !== parts[2]) throw new Error('小程序登录二维码已损坏');
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); }
  catch (_error) { throw new Error('小程序登录二维码无法读取'); }
  const account = parseLoginKey(payload.loginKey);
  const rooms = (Array.isArray(payload.rooms) ? payload.rooms : [])
    .map(room => ({ id: String(room.id || ''), name: String(room.name || room.ip || '教室'), ip: String(room.ip || '').trim() }))
    .filter(room => room.ip);
  return { account, rooms };
}

module.exports = {
  publicAccount,
  verifyAccountPassword,
  makeStoredAccount,
  generateLoginKey,
  parseLoginKey,
  generateMiniProgramLoginPayload,
  parseMiniProgramLoginPayload,
};
