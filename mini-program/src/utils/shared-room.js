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

module.exports = { normalizeRoom, createPath, savePending, loadPending, clearPending, resumePending };
