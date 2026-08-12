const STORAGE_KEY = 'classroom_call_teacher_session_v1';

function load() {
  try { return wx.getStorageSync(STORAGE_KEY) || null; }
  catch (_error) { return null; }
}

function save(session) {
  wx.setStorageSync(STORAGE_KEY, session);
  return session;
}

function clear() {
  wx.removeStorageSync(STORAGE_KEY);
}

function setActiveRoom(room) {
  const current = load();
  if (!current) return null;
  current.activeRoom = room;
  save(current);
  return current;
}

module.exports = { sessionStore: { load, save, clear, setActiveRoom } };
