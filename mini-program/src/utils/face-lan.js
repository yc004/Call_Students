const connectionCode = require('./connection-code');
const { resolveClassroomHost } = require('./local-service');

function decodeSocketMessage(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return decodeArrayBuffer(data);
  if (ArrayBuffer.isView(data)) return decodeArrayBuffer(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  return String(data == null ? '' : data);
}

function decodeArrayBuffer(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 1) encoded += `%${bytes[index].toString(16).padStart(2, '0')}`;
  try { return decodeURIComponent(encoded); } catch (_error) { return ''; }
}

function connect(room, account, listener, timeoutMs = 8000) {
  if (!room || !connectionCode.isValid(room.connectionCode)) {
    listener('unavailable', { message:'当前教室没有可用的局域网连接信息，人脸服务不可用' });
    return { send() { return false; }, close() {} };
  }
  let active = null;
  let cancelled = false;
  resolveClassroomHost(room, Math.min(2200, timeoutMs - 500)).then(result => {
    if (!cancelled) active = connectResolved(result.host, room, account, listener, timeoutMs);
  }).catch(() => {
    if (!cancelled) listener('unavailable', { message:'局域网连接码无效，人脸服务不可用' });
  });
  return {
    send(data) { return !!(active && active.send(data)); },
    close() { cancelled = true; if (active) active.close(); },
  };
}

function connectResolved(host, room, account, listener, timeoutMs) {
  const task = wx.connectSocket({ url:`ws://${host}:3456`, tcpNoDelay:true, timeout:timeoutMs });
  let ready = false;
  let closed = false;
  const timer = setTimeout(() => fail('当前局域网连接超时，人脸服务不可用'), timeoutMs);
  function fail(message) {
    if (closed || ready) return;
    clearTimeout(timer);
    listener('unavailable', { message });
    try { task.close({ code:1000, reason:'face lan unavailable' }); } catch (_error) {}
  }
  task.onMessage(({ data }) => {
    let message;
    try { message = JSON.parse(decodeSocketMessage(data)); } catch (_error) { return; }
    if (message.type === 'sync') {
      ready = true; clearTimeout(timer); listener('available', message);
      listener('attendance', { attendance:message.attendance || [] });
      listener('pendingFaces', { faces:message.pendingFaces || [] });
    } else if (message.type === 'face-status') listener('attendance', message);
    else if (message.type === 'face-detections') listener('presence', message);
    else if (message.type === 'pending-face-library') listener('pendingFaces', message);
    else if (message.type === 'face-system-state') listener('faceSystemState', message);
    else if (message.type === 'face-preview-state') listener('facePreviewState', message);
    else if (message.type === 'face-camera-frame') listener('faceCameraFrame', message);
    else if (['approval-required','login-required','auth-required','subject-required'].includes(message.type)) {
      if (ready) listener('error', message);
      else fail(message.message || '局域网身份验证失败，人脸服务不可用');
    }
  });
  task.onError(() => fail('当前局域网连接失败，人脸服务不可用。请确认手机与教室电脑连接同一 Wi-Fi。'));
  task.onClose(() => { if (!closed && !ready) fail('当前局域网连接失败，人脸服务不可用'); else if (!closed) listener('unavailable', { message:'局域网连接已断开，人脸服务暂时不可用' }); });
  task.onOpen(() => task.send({ data:JSON.stringify({ type:'connect', purpose:'face', connectionId:account.connectionId, name:account.name, subjects:room.subjects || [] }) }));
  return {
    send(data) {
      if (!ready || closed) return false;
      try { task.send({ data:JSON.stringify(data) }); return true; } catch (_error) { return false; }
    },
    close() { closed = true; clearTimeout(timer); try { task.close({ code:1000, reason:'leave attendance' }); } catch (_error) {} },
  };
}

module.exports = { connect };
