'use strict';

const crypto = require('crypto');
const net = require('net');
const os = require('os');
const connectionCode = require('./connection-code');

const PAIRING_PREFIX = 'CLASSROOM-CALL-PAIR-1';
const PAIRING_PORT = 3457;
const DEFAULT_TTL_MS = 2 * 60 * 1000;
const MAX_PAIRING_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

function isPrivateIpv4(address) {
  const parts = String(address || '').replace(/^::ffff:/, '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function getLanAddresses(networkInterfaces = os.networkInterfaces()) {
  const addresses = [];
  Object.values(networkInterfaces || {}).forEach(entries => {
    (entries || []).forEach(entry => {
      const family = typeof entry.family === 'string' ? entry.family : (entry.family === 4 ? 'IPv4' : '');
      if (family === 'IPv4' && !entry.internal && isPrivateIpv4(entry.address)) addresses.push(entry.address);
    });
  });
  return [...new Set(addresses)].sort((a, b) => {
    const virtual = value => /^(?:10\.(?:0\.2\.2|211\.)|172\.(?:1[6-9]|2\d|3[01])\.)/.test(value) ? 1 : 0;
    return virtual(a) - virtual(b);
  }).slice(0, 6);
}

function createPairingPayload(input) {
  const payload = {
    version: 1,
    hosts: [...new Set((input.hosts || []).filter(isPrivateIpv4))].slice(0, 6),
    port: Number(input.port),
    token: String(input.token || ''),
    expiresAt: Number(input.expiresAt),
    purpose: 'teacher-login',
  };
  if (!payload.hosts.length) throw new Error('没有可用的局域网地址');
  if (!Number.isInteger(payload.port) || payload.port < 1 || payload.port > 65535) throw new Error('临时连接端口无效');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(payload.token)) throw new Error('临时配对码无效');
  if (!Number.isFinite(payload.expiresAt)) throw new Error('临时配对时间无效');
  return `${PAIRING_PREFIX}.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

function parsePairingPayload(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 2 || parts[0] !== PAIRING_PREFIX) throw new Error('小程序配对二维码格式不正确');
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); }
  catch (_error) { throw new Error('小程序配对二维码无法读取'); }
  if (payload.version !== 1 || payload.purpose !== 'teacher-login') throw new Error('小程序登录二维码版本不受支持');
  // Reuse the generator validation and return its normalized data.
  const normalized = JSON.parse(Buffer.from(createPairingPayload(payload).split('.')[1], 'base64url').toString('utf8'));
  return normalized;
}

function safeRooms(rooms) {
  return (Array.isArray(rooms) ? rooms : []).slice(0, 50).map(room => {
    if (room && room.transport === 'cloud' && room.cloudClassroomId) {
      return {
        id:String(room.id || room.cloudClassroomId).slice(0, 80),
        cloudClassroomId:String(room.cloudClassroomId).slice(0, 80),
        name:String(room.name || '云端教室').slice(0, 40),
        transport:'cloud',
        connectionCode:connectionCode.isValid(room.connectionCode) ? connectionCode.format(room.connectionCode) : '',
        subjects:Array.from(new Set((room.subjects || []).map(value => String(value).trim().slice(0, 30)).filter(Boolean))).slice(0, 20),
        role:String(room.role || '').slice(0, 20),
      };
    }
    const code = connectionCode.format(room.connectionCode);
    if (!connectionCode.isValid(code)) return null;
    return {
      id: String(room.id || '').slice(0, 80),
      name: String(room.name || '教室').slice(0, 40),
      connectionCode: code,
      subjects: Array.from(new Set((room.subjects || []).map(value => String(value).trim().slice(0, 30)).filter(Boolean))).slice(0, 20),
    };
  }).filter(Boolean);
}

function safeCloud(cloud) {
  if (!cloud || !/^https?:\/\//i.test(String(cloud.serverUrl || ''))) return null;
  const accessToken = String(cloud.accessToken || '');
  const refreshToken = String(cloud.refreshToken || '');
  if (!accessToken || !refreshToken) return null;
  const organization = cloud.organization && typeof cloud.organization === 'object' ? cloud.organization : {};
  const primaryColor = /^#[0-9A-Fa-f]{6}$/.test(String(organization.primaryColor || '')) ? String(organization.primaryColor).toUpperCase() : '#2563EB';
  return {
    version:1,
    serverUrl:String(cloud.serverUrl).replace(/\/+$/, '').slice(0, 500),
    userId:String(cloud.userId || '').slice(0, 80),
    loginName:String(cloud.loginName || '').slice(0, 80),
    userName:String(cloud.userName || '').slice(0, 40),
    nickname:String(cloud.nickname || '').slice(0, 40),
    avatarUrl:String(cloud.avatarUrl || '').slice(0, 500),
    mustChangePassword:!!cloud.mustChangePassword,
    organization:{ id:String(organization.id || '').slice(0, 80), name:String(organization.name || '组织空间').slice(0, 120), shortName:String(organization.shortName || organization.name || '组织').slice(0, 40), logoUrl:String(organization.logoUrl || '').slice(0, 500), primaryColor },
    accessToken:accessToken.slice(0, 4096),
    accessExpiresAt:String(cloud.accessExpiresAt || '').slice(0, 80),
    refreshToken:refreshToken.slice(0, 512),
    expiresAt:String(cloud.expiresAt || '').slice(0, 80),
  };
}

function safeAccount(account) {
  const name = String(account && account.name || '').trim().slice(0, 40);
  const connectionId = String(account && account.connectionId || '').trim().slice(0, 128);
  if (!name || !/^[a-zA-Z0-9-]{8,128}$/.test(connectionId)) {
    throw new Error('小程序教师账户信息无效');
  }
  const avatarUrl = String(account && account.avatarUrl || '').trim().slice(0, 1000);
  return {
    name,
    connectionId,
    subjects: [],
    ...(avatarUrl && /^https?:\/\//i.test(avatarUrl) ? { avatarUrl } : {}),
  };
}

function safeAvatarPayload(avatar) {
  if (!avatar) return null;
  const contentType = String(avatar.contentType || '').toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) throw new Error('头像图片格式不受支持');
  const base64 = String(avatar.base64 || '');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('头像图片数据无效');
  const data = Buffer.from(base64, 'base64');
  if (!data.length || data.length > MAX_AVATAR_BYTES) throw new Error('头像图片大小不能超过 2MB');
  return { contentType, base64 };
}

function sendJson(socket, body) {
  socket.end(`${JSON.stringify(body)}\n`);
}

function tokensEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function startPairingServer({ ttlMs = DEFAULT_TTL_MS, hosts = getLanAddresses(), canAccept, onComplete }) {
  if (!hosts.length) throw new Error('未检测到局域网地址，请先将电脑连接到与手机相同的 Wi-Fi');

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + ttlMs;
  let used = false;
  let claimed = false;
  let timer = null;

  const server = net.createServer(socket => {
    socket.setNoDelay(true);
    socket.setTimeout(6000, () => socket.destroy());
    if (!isPrivateIpv4(socket.remoteAddress)) {
      sendJson(socket, { ok: false, message: '只允许局域网设备配对' });
      return;
    }
    if (used || claimed || Date.now() > expiresAt) {
      sendJson(socket, { ok: false, message: '二维码已使用或已过期，请在教师端重新生成' });
      return;
    }
    let input = '';
    let receivedSize = 0;
    let processed = false;
    socket.on('data', chunk => {
      if (processed) return;
      receivedSize += chunk.length;
      input += chunk.toString('utf8');
      if (receivedSize > MAX_PAIRING_REQUEST_BYTES) {
        processed = true;
        sendJson(socket, { ok: false, message: '配对请求过大' });
        return;
      }
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      let body;
      try { body = JSON.parse(input.slice(0, newline)); }
      catch (_error) {
        processed = true;
        sendJson(socket, { ok: false, message: '配对请求格式无效' });
        return;
      }
      processed = true;
      if (used || claimed || Date.now() > expiresAt) {
        sendJson(socket, { ok: false, message: '二维码已使用或已过期，请在教师端重新生成' });
        return;
      }
      if (!tokensEqual(body.token, token)) {
        sendJson(socket, { ok: false, message: '临时配对码无效' });
        return;
      }
      if (typeof canAccept === 'function' && !canAccept()) {
        sendJson(socket, { ok: false, message: '教师端已经登录，请先退出当前账户后再扫码' });
        return;
      }
      let loginData;
      try {
        const account = safeAccount(body.account);
        const rooms = safeRooms(body.rooms);
        const cloud = safeCloud(body.cloud);
        const avatar = safeAvatarPayload(body.avatar);
        loginData = { account, rooms, cloud, avatar, usageMode:cloud ? 'tob' : 'toc' };
      } catch (error) {
        sendJson(socket, { ok:false, message:error.message || '小程序登录资料无效' });
        return;
      }
      claimed = true;
      Promise.resolve()
        .then(() => typeof onComplete === 'function' ? onComplete(loginData) : loginData)
        .then(() => {
          used = true;
          sendJson(socket, {
            ok:true,
            imported:{
              name:loginData.account.name,
              roomCount:loginData.rooms.length,
              usageMode:loginData.usageMode,
              hasAvatar:!!(loginData.avatar || loginData.account.avatarUrl || loginData.cloud && loginData.cloud.avatarUrl),
            },
          });
          setTimeout(() => server.close(), 100).unref?.();
        })
        .catch(error => {
          claimed = false;
          sendJson(socket, { ok:false, message:error.message || '教师端保存登录资料失败' });
        });
    });
  });
  server.on('error', error => console.error('mini-program pairing server error:', error.message));

  await new Promise((resolve, reject) => {
    const onError = error => {
      if (error && error.code === 'EADDRINUSE') {
        reject(new Error(`配对端口 ${PAIRING_PORT} 已被占用，请关闭其他教师端实例后重试`));
        return;
      }
      if (error && (error.code === 'EACCES' || error.code === 'EPERM')) {
        reject(new Error(`无法监听配对端口 ${PAIRING_PORT}，请检查系统防火墙或安全软件设置`));
        return;
      }
      reject(error);
    };
    server.once('error', onError);
    server.listen(PAIRING_PORT, '0.0.0.0', () => {
      server.off('error', onError);
      resolve();
    });
  });
  server.unref();
  const port = PAIRING_PORT;
  const payload = createPairingPayload({ hosts, port, token, expiresAt });

  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    return new Promise(resolve => {
      if (!server.listening) { resolve(); return; }
      server.close(() => resolve());
    });
  };
  timer = setTimeout(stop, ttlMs);
  timer.unref?.();
  return { payload, expiresAt, roomCount: 0, stop };
}

module.exports = {
  PAIRING_PREFIX,
  PAIRING_PORT,
  DEFAULT_TTL_MS,
  isPrivateIpv4,
  getLanAddresses,
  createPairingPayload,
  parsePairingPayload,
  safeRooms,
  safeAccount,
  safeAvatarPayload,
  startPairingServer,
};
