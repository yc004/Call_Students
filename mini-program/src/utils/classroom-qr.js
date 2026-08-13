const PREFIX = 'CLASSROOM-CALL-ROOM-1';
const connectionCode = require('./connection-code');

function decodeUtf8(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 1) encoded += `%${bytes[index].toString(16).padStart(2, '0')}`;
  return decodeURIComponent(encoded);
}

function decodeBase64Url(value) {
  let base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return decodeUtf8(wx.base64ToArrayBuffer(base64));
}

function parseClassroomQr(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 2 || parts[0] !== PREFIX) throw new Error('这不是有效的教室连接二维码');
  let payload;
  try { payload = JSON.parse(decodeBase64Url(parts[1])); }
  catch (_error) { throw new Error('二维码内容无法读取，请在教室端重新打开二维码'); }
  const name = String(payload.name || '').trim().slice(0, 40);
  const code = connectionCode.format(payload.connectionCode);
  if (payload.version !== 1 || payload.type !== 'classroom' || !name || !connectionCode.isValid(code)) {
    throw new Error('教室二维码已失效或格式不正确');
  }
  return { name, connectionCode: code };
}

module.exports = { PREFIX, parseClassroomQr };
