const MINI_PREFIX = 'CLASSROOM-CALL-MINI-1';
const TEACHER_PREFIX = 'TEACHER-KEY-1';

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

function parseTeacherKey(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3 || parts[0] !== TEACHER_PREFIX) throw new Error('教师身份信息无效');
  const data = JSON.parse(decodeBase64Url(parts[1]));
  if (!data.name || !data.connectionId || !data.passwordHash || !data.passwordSalt) throw new Error('教师身份信息不完整');
  return {
    name: String(data.name),
    subjects: Array.isArray(data.subjects) ? data.subjects.map(String) : [],
    connectionId: String(data.connectionId),
    passwordHash: String(data.passwordHash),
    passwordSalt: String(data.passwordSalt),
  };
}

function parseLoginQr(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== MINI_PREFIX) throw new Error('请扫描教师端生成的小程序登录二维码');
  let payload;
  try { payload = JSON.parse(decodeBase64Url(parts[1])); }
  catch (_error) { throw new Error('二维码内容无法读取，请重新生成'); }
  if (payload.version !== 1 || !payload.loginKey) throw new Error('二维码版本不受支持');
  const account = parseTeacherKey(payload.loginKey);
  const rooms = (Array.isArray(payload.rooms) ? payload.rooms : []).map(room => ({
    id: String(room.id || ''),
    name: String(room.name || room.ip || '教室'),
    ip: String(room.ip || '').trim(),
  })).filter(room => room.ip);
  return { account, rooms, activeRoom: rooms[0] || null, loginKey: payload.loginKey };
}

module.exports = { parseLoginQr };
