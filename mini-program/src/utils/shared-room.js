const STORAGE_KEY = 'classroom_call_pending_shared_room_v1';
const connectionCode = require('./connection-code');

function decodeOption(value) {
  const text = String(value || '');
  try { return decodeURIComponent(text); } catch (_error) { return text; }
}

function normalizeRoom(input) {
  const name = decodeOption(input && input.name).trim().slice(0, 40);
  const code = connectionCode.format(decodeOption(input && input.connectionCode));
  if (!name || !connectionCode.isValid(code)) return null;
  return { name, connectionCode: code };
}

function parseQueryString(value) {
  const text = String(value || '').replace(/^\?/, '');
  return text.split('&').reduce((result, pair) => {
    const separator = pair.indexOf('=');
    if (separator < 0) return result;
    const key = decodeOption(pair.slice(0, separator).replace(/\+/g, ' '));
    const itemValue = decodeOption(pair.slice(separator + 1).replace(/\+/g, ' '));
    result[key] = itemValue;
    return result;
  }, {});
}

function parseDirectLink(value) {
  let text = String(value || '').trim();
  if (!/^https:\/\//i.test(text)) text = decodeOption(text).trim();
  if (!/^https:\/\//i.test(text)) return null;
  const question = text.indexOf('?');
  if (question < 0) return null;
  const hash = text.indexOf('#', question);
  const query = parseQueryString(text.slice(question + 1, hash < 0 ? text.length : hash));
  if (query.cc_action !== 'connect') return null;
  return normalizeRoom({
    name: query.cc_name || '扫码连接的教室',
    connectionCode: query.cc_code,
  });
}

function parseScene(value) {
  const text = decodeOption(value).trim();
  if (!text) return null;
  const query = parseQueryString(text);
  const code = query.cc_code || query.c || (/^\d{9}$/.test(text) ? text : '');
  return normalizeRoom({ name: query.cc_name || query.n || '扫码连接的教室', connectionCode: code });
}

function fromLaunchOptions(options) {
  const query = options && options.query && typeof options.query === 'object' ? options.query : options || {};
  return parseDirectLink(query.q || options && options.q)
    || parseScene(query.scene || options && options.scene)
    || normalizeRoom({ name:query.name, connectionCode:query.code });
}

function createPath(room) {
  const normalized = normalizeRoom(room);
  if (!normalized) return '/pages/home/index';
  return `/pages/room-connect/index?name=${encodeURIComponent(normalized.name)}&code=${encodeURIComponent(normalized.connectionCode)}`;
}

function savePending(room) {
  const normalized = normalizeRoom(room);
  if (!normalized) return false;
  wx.setStorageSync(STORAGE_KEY, normalized);
  return true;
}

function loadPending() {
  try { return normalizeRoom(wx.getStorageSync(STORAGE_KEY)); }
  catch (_error) { return null; }
}

function clearPending() {
  try { wx.removeStorageSync(STORAGE_KEY); } catch (_error) {}
}

function resumePending() {
  const room = loadPending();
  if (!room) return false;
  wx.redirectTo({ url: createPath(room) });
  return true;
}

module.exports = {
  normalizeRoom,
  parseDirectLink,
  parseScene,
  fromLaunchOptions,
  createPath,
  savePending,
  loadPending,
  clearPending,
  resumePending,
};
