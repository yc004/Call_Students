const PAIRING_PREFIX = 'CLASSROOM-CALL-PAIR-1';
const PENDING_PAIRING_KEY = 'classroom_call_pending_teacher_pairing_v1';
const connectionCode = require('./connection-code');

function authError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function decodeUtf8(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let encoded = '';
  for (let i = 0; i < bytes.length; i += 1) encoded += `%${bytes[i].toString(16).padStart(2, '0')}`;
  return decodeURIComponent(encoded);
}

function decodeBase64Url(value) {
  let base64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return decodeUtf8(wx.base64ToArrayBuffer(base64));
}

function isPrivateIpv4(value) {
  const parts = String(value || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function parsePairingQr(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 2 || parts[0] !== PAIRING_PREFIX) throw authError('PAIR_QR_INVALID', '请扫描教师端新生成的临时配对二维码');
  let payload;
  try { payload = JSON.parse(decodeBase64Url(parts[1])); }
  catch (_error) { throw authError('PAIR_QR_INVALID', '二维码内容无法读取，请重新生成'); }

  const hosts = [...new Set((Array.isArray(payload.hosts) ? payload.hosts : []).map(String).filter(isPrivateIpv4))].slice(0, 6);
  const port = Number(payload.port);
  const token = String(payload.token || '');
  const expiresAt = Number(payload.expiresAt);
  if (payload.version !== 1 || payload.purpose !== 'teacher-login') throw authError('PAIR_QR_INVALID', '请在新版教师端重新生成登录二维码');
  if (!hosts.length || !Number.isInteger(port) || port < 1 || port > 65535) throw authError('PAIR_QR_INVALID', '二维码中的局域网连接信息无效');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw authError('PAIR_QR_INVALID', '二维码中的临时配对码无效');
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) throw authError('PAIR_QR_EXPIRED', '二维码已过期，请在教师端重新生成');
  return { hosts, port, token, expiresAt };
}

function parseDirectPairingLink(value) {
  let text = String(value || '').trim();
  if (!/^https:\/\//i.test(text)) {
    try { text = decodeURIComponent(text); } catch (_error) {}
  }
  if (!/^https:\/\//i.test(text)) return '';
  const question = text.indexOf('?');
  if (question < 0) return '';
  const hash = text.indexOf('#', question);
  const queryText = text.slice(question + 1, hash < 0 ? text.length : hash);
  const query = {};
  queryText.split('&').forEach(pair => {
    const separator = pair.indexOf('=');
    if (separator < 0) return;
    const decode = part => {
      try { return decodeURIComponent(part.replace(/\+/g, ' ')); } catch (_error) { return part; }
    };
    query[decode(pair.slice(0, separator))] = decode(pair.slice(separator + 1));
  });
  if (query.cc_action !== 'teacher-login' || !String(query.cc_pair || '').startsWith(`${PAIRING_PREFIX}.`)) return '';
  return query.cc_pair;
}

function savePendingPairing(value) {
  const payload = String(value || '');
  try { parsePairingQr(payload); }
  catch (_error) { return false; }
  wx.setStorageSync(PENDING_PAIRING_KEY, payload);
  return true;
}

function loadPendingPairing() {
  try {
    const payload = String(wx.getStorageSync(PENDING_PAIRING_KEY) || '');
    parsePairingQr(payload);
    return payload;
  } catch (_error) { return ''; }
}

function clearPendingPairing() {
  try { wx.removeStorageSync(PENDING_PAIRING_KEY); } catch (_error) {}
}

function requestHost(host, pairing, localSession) {
  return new Promise((resolve, reject) => {
    if (typeof wx.createTCPSocket !== 'function') {
      reject(authError('PAIR_UNSUPPORTED', '当前微信版本不支持局域网安全配对，请升级微信后重试'));
      return;
    }
    const socket = wx.createTCPSocket({ type: 'IPv4' });
    let completed = false;
    const receivedBytes = [];
    const timeout = setTimeout(() => finish(new Error('连接教师端超时')), 6000);
    function finish(error, data) {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      try { socket.close(); } catch (_error) {}
      if (error) reject(error); else resolve(data);
    }
    socket.onConnect(() => socket.write(`${JSON.stringify({ token: pairing.token, account: localSession.account, rooms: localSession.rooms || [], cloud:localSession.cloud || null })}\n`));
    socket.onMessage(({ message }) => {
      const bytes = new Uint8Array(message);
      for (let index = 0; index < bytes.length; index += 1) receivedBytes.push(bytes[index]);
      if (receivedBytes.length > 65536) {
        finish(new Error('教师端返回的数据过大'));
        return;
      }
      const newline = receivedBytes.indexOf(10);
      if (newline < 0) return;
      let data;
      try { data = JSON.parse(decodeUtf8(Uint8Array.from(receivedBytes.slice(0, newline)).buffer)); }
      catch (_error) {
        finish(new Error('教师端返回的数据无法读取'));
        return;
      }
      if (!data.ok) {
        const message = data.message || '教师端拒绝了配对';
        finish(/已使用|已过期/.test(message) ? authError('PAIR_QR_EXPIRED', message) : new Error(message));
      }
      else finish(null, data);
    });
    socket.onError(error => finish(new Error(error && error.errMsg || '无法连接教师端')));
    socket.onClose(() => {
      if (!completed) finish(new Error('教师端已断开配对连接'));
    });
    socket.connect({ address: host, port: pairing.port, timeout: 5 });
  });
}

function normalizeSession(data) {
  const sourceAccount = data && data.account;
  const name = sourceAccount && String(sourceAccount.name || '').trim();
  const connectionId = sourceAccount && String(sourceAccount.connectionId || '').trim();
  if (!name || name.length > 20 || !/^[a-zA-Z0-9-]{8,128}$/.test(connectionId)) throw new Error('教师端返回的身份信息无效');
  const rooms = (Array.isArray(data.rooms) ? data.rooms : []).slice(0, 50).map(room => ({
    id: String(room.id || '').slice(0, 80),
    name: String(room.name || '教室').slice(0, 40),
    connectionCode: connectionCode.format(room.connectionCode),
    subjects: Array.from(new Set((room.subjects || []).map(value => String(value).trim()).filter(Boolean))).slice(0, 20),
  })).filter(room => connectionCode.isValid(room.connectionCode));
  return {
    account: { name, connectionId, subjects: [] },
    rooms,
    activeRoom: rooms[0] || null,
    cloud: data && data.cloud || null,
    pairedAt: new Date().toISOString(),
  };
}

async function pairWithTeacher(value, localSession) {
  if (!localSession || !localSession.account) throw authError('PAIR_ACCOUNT_REQUIRED', '请先在小程序登录或创建教师账户');
  const pairing = parsePairingQr(value);
  let lastError = null;
  for (const host of pairing.hosts) {
    try {
      const result = await requestHost(host, pairing, localSession);
      return normalizeSession(result);
    } catch (error) {
      lastError = error;
      if (error && (error.code === 'PAIR_UNSUPPORTED' || error.code === 'PAIR_QR_EXPIRED')) throw error;
      if (Date.now() > pairing.expiresAt) throw authError('PAIR_QR_EXPIRED', '二维码已过期，请在教师端重新生成');
    }
  }
  const detail = lastError && lastError.message && !String(lastError.message).includes('request:fail') ? `：${lastError.message}` : '';
  throw authError('PAIR_NETWORK', `无法连接教师端${detail}`);
}

module.exports = {
  parsePairingQr,
  parseDirectPairingLink,
  savePendingPairing,
  loadPendingPairing,
  clearPendingPairing,
  pairWithTeacher,
};
