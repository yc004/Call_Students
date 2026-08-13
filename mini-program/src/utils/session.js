const STORAGE_KEY = 'classroom_call_teacher_session_v1';
const connectionCode = require('./connection-code');

function migrateRoom(room) {
  if (!room) return null;
  const subjects = Array.from(new Set((room.subjects || []).map(value => String(value).trim()).filter(Boolean))).slice(0, 20);
  if (connectionCode.isValid(room.connectionCode)) return { ...room, subjects, connectionCode: connectionCode.format(room.connectionCode), ip: undefined };
  try { return { id: room.id, name: room.name || '教室', subjects, connectionCode: connectionCode.encode(room.ip) }; }
  catch (_error) { return null; }
}

function sanitizeAccount(account) {
  if (!account) return null;
  const name = String(account.name || '').trim();
  const connectionId = String(account.connectionId || '').trim();
  if (!name || !connectionId) return null;
  return { name, connectionId, subjects: [] };
}

function sanitizeSession(session) {
  if (!session) return null;
  const account = sanitizeAccount(session.account);
  if (!account) return null;
  const rooms = (session.rooms || []).map(migrateRoom).filter(Boolean);
  const activeRoom = migrateRoom(session.activeRoom) || rooms[0] || null;
  return {
    account,
    rooms,
    activeRoom,
    pairedAt: session.pairedAt || session.pairingAt || new Date().toISOString(),
  };
}

function load() {
  try {
    const session = wx.getStorageSync(STORAGE_KEY) || null;
    if (!session) return null;
    const migrated = sanitizeSession(session);
    if (!migrated) return null;
    if (JSON.stringify(migrated) !== JSON.stringify(session)) wx.setStorageSync(STORAGE_KEY, migrated);
    return migrated;
  }
  catch (_error) { return null; }
}

function save(session) {
  const safeSession = sanitizeSession(session);
  if (!safeSession) throw new Error('登录会话无效');
  wx.setStorageSync(STORAGE_KEY, safeSession);
  return safeSession;
}

function clear() {
  wx.removeStorageSync(STORAGE_KEY);
}

function setActiveRoom(room) {
  const current = load();
  if (!current) return null;
  current.activeRoom = room;
  return save(current);
}

function removeRoom(connectionCodeValue) {
  const current = load();
  if (!current) return null;
  const target = String(connectionCodeValue || '').replace(/[^0-9]/g, '');
  current.rooms = (current.rooms || []).filter(room => String(room.connectionCode || '').replace(/[^0-9]/g, '') !== target);
  const activeCode = String(current.activeRoom && current.activeRoom.connectionCode || '').replace(/[^0-9]/g, '');
  if (activeCode === target) current.activeRoom = current.rooms[0] || null;
  return save(current);
}

module.exports = { sessionStore: { load, save, clear, setActiveRoom, removeRoom } };
