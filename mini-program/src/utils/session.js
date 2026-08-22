const STORAGE_KEY = 'classroom_call_teacher_session_v1';
const connectionCode = require('./connection-code');

function migrateRoom(room) {
  if (!room) return null;
  const subjects = Array.from(new Set((room.subjects || []).map(value => String(value).trim()).filter(Boolean))).slice(0, 20);
  if (room.transport === 'cloud' && room.cloudClassroomId) {
    return { ...room, id:String(room.id || room.cloudClassroomId), cloudClassroomId:String(room.cloudClassroomId), transport:'cloud', subjects, connectionCode:room.connectionCode && connectionCode.isValid(room.connectionCode) ? connectionCode.format(room.connectionCode) : '' };
  }
  if (connectionCode.isValid(room.connectionCode)) return { ...room, subjects, connectionCode: connectionCode.format(room.connectionCode), ip: undefined };
  try { return { id: room.id, name: room.name || '教室', subjects, connectionCode: connectionCode.encode(room.ip) }; }
  catch (_error) { return null; }
}

function sanitizeCloud(cloud) {
  if (!cloud) return null;
  const serverUrl = String(cloud.serverUrl || '').trim().replace(/\/+$/, '');
  const accessToken = String(cloud.accessToken || '');
  const refreshToken = String(cloud.refreshToken || '');
  if (!/^https?:\/\//i.test(serverUrl) || !accessToken || !refreshToken) return null;
  const result = { version:1, serverUrl, userId:String(cloud.userId || ''), userName:String(cloud.userName || '').trim().slice(0,40), accessToken, accessExpiresAt:String(cloud.accessExpiresAt || ''), refreshToken, expiresAt:String(cloud.expiresAt || '') };
  const nickname = String(cloud.nickname || '').trim().slice(0, 40);
  if (nickname) result.nickname = nickname;
  const avatarUrl = String(cloud.avatarUrl || '').trim().slice(0, 500);
  if (avatarUrl) result.avatarUrl = avatarUrl;
  result.mustChangePassword = !!cloud.mustChangePassword;
  const organization = cloud.organization && typeof cloud.organization === 'object' ? cloud.organization : {};
  result.organization = {
    id:String(organization.id || ''),
    name:String(organization.name || '组织空间').trim().slice(0, 120),
    shortName:String(organization.shortName || organization.name || '组织').trim().slice(0, 40),
    logoUrl:String(organization.logoUrl || '').trim().slice(0, 500),
    primaryColor:/^#[0-9A-Fa-f]{6}$/.test(String(organization.primaryColor || '')) ? String(organization.primaryColor).toUpperCase() : '#2563EB',
  };
  return result;
}

function sanitizeAccount(account) {
  if (!account) return null;
  const name = String(account.name || '').trim();
  const connectionId = String(account.connectionId || '').trim();
  if (!name || !connectionId) return null;
  const subjects = Array.from(new Set((account.subjects || []).map(value => String(value).trim()).filter(Boolean))).slice(0, 20);
  const result = { name, connectionId, subjects };
  const loginName = String(account.loginName || '').trim().slice(0, 40);
  if (loginName) result.loginName = loginName;
  const avatarUrl = String(account.avatarUrl || '').trim().slice(0, 1000);
  if (avatarUrl) result.avatarUrl = avatarUrl;
  return result;
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
    cloud: sanitizeCloud(session.cloud),
    usageMode:session.cloud ? 'tob' : 'toc',
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
  const inputRoom = connectionCodeValue && typeof connectionCodeValue === 'object' ? connectionCodeValue : null;
  const targetCloudId = inputRoom && inputRoom.transport === 'cloud' ? String(inputRoom.cloudClassroomId || inputRoom.id || '') : '';
  const target = targetCloudId ? '' : String(inputRoom ? inputRoom.connectionCode : connectionCodeValue || '').replace(/[^0-9]/g, '');
  current.rooms = (current.rooms || []).filter(room => targetCloudId ? String(room.cloudClassroomId || '') !== targetCloudId : String(room.connectionCode || '').replace(/[^0-9]/g, '') !== target);
  const activeCode = String(current.activeRoom && current.activeRoom.connectionCode || '').replace(/[^0-9]/g, '');
  const activeCloudId = String(current.activeRoom && current.activeRoom.cloudClassroomId || '');
  if ((targetCloudId && activeCloudId === targetCloudId) || (!targetCloudId && activeCode === target)) current.activeRoom = current.rooms[0] || null;
  return save(current);
}

function updateCloud(cloud, rooms) {
  const current = load();
  if (!current) return null;
  current.cloud = cloud;
  if (cloud) current.account = { ...current.account, name:cloud.nickname || cloud.userName || current.account.name, avatarUrl:cloud.avatarUrl || current.account.avatarUrl || '' };
  if (Array.isArray(rooms)) {
    const localRooms = current.rooms.filter(room => room.transport !== 'cloud');
    current.rooms = [...localRooms, ...rooms];
    if (!current.activeRoom || !current.rooms.some(room => room.id === current.activeRoom.id)) current.activeRoom = current.rooms[0] || null;
  }
  return save(current);
}

module.exports = { sessionStore: { load, save, clear, setActiveRoom, removeRoom, updateCloud } };
