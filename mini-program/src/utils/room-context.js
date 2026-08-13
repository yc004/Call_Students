const { sessionStore } = require('./session');

function activateByCode(code) {
  const session = sessionStore.load();
  if (!session) return null;
  const normalized = String(code || '').replace(/[^0-9]/g, '');
  const room = (session.rooms || []).find(item => String(item.connectionCode || '').replace(/[^0-9]/g, '') === normalized)
    || session.activeRoom
    || session.rooms[0]
    || null;
  if (!room) return null;
  const updated = sessionStore.save({ ...session, activeRoom: room });
  getApp().globalData.session = updated;
  return { session: updated, room };
}

function featureUrl(feature, room) {
  const routes = { call: '/pages/call/index', homework: '/pages/homework/index', attendance: '/pages/attendance/index', settings: '/pages/classroom-settings/index' };
  const route = routes[feature];
  if (!route || !room) return '';
  return `${route}?code=${encodeURIComponent(room.connectionCode)}`;
}

module.exports = { activateByCode, featureUrl };
