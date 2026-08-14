const PREFIX = 'CLASSROOM-CALL-ROOM-1';

function normalizeWechatDirectBaseUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let url;
  try { url = new URL(text); }
  catch (_error) { throw new Error('微信直达链接格式不正确'); }
  if (url.protocol !== 'https:') throw new Error('微信直达链接必须使用 HTTPS');
  if (url.username || url.password) throw new Error('微信直达链接不能包含账号或密码');
  url.hash = '';
  return url.toString();
}

function createWechatDirectLink(baseUrl, name, connectionCode) {
  const normalizedBaseUrl = normalizeWechatDirectBaseUrl(baseUrl);
  if (!normalizedBaseUrl) throw new Error('请先配置微信直达链接');
  const roomName = String(name || '本教室').trim().slice(0, 40) || '本教室';
  const code = String(connectionCode || '').trim();
  if (!/^\d{3}-\d{3}-\d{3}$/.test(code)) throw new Error('教室连接码无效');
  const url = new URL(normalizedBaseUrl);
  url.searchParams.set('cc_action', 'connect');
  url.searchParams.set('cc_code', code.replace(/-/g, ''));
  url.searchParams.set('cc_name', roomName);
  return url.toString();
}

function createClassroomQrPayload(name, connectionCode) {
  const roomName = String(name || '本教室').trim().slice(0, 40) || '本教室';
  const code = String(connectionCode || '').trim();
  if (!/^\d{3}-\d{3}-\d{3}$/.test(code)) throw new Error('教室连接码无效');
  const body = Buffer.from(JSON.stringify({
    version: 1,
    type: 'classroom',
    name: roomName,
    connectionCode: code,
  }), 'utf8').toString('base64url');
  return `${PREFIX}.${body}`;
}

module.exports = {
  PREFIX,
  createClassroomQrPayload,
  normalizeWechatDirectBaseUrl,
  createWechatDirectLink,
};
