const connectionCode = require('./connection-code');
const { resolveClassroomHost } = require('./local-service');

function decodeSocketMessage(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) {
    const bytes = new Uint8Array(data);
    let encoded = '';
    for (let index = 0; index < bytes.length; index += 1) encoded += `%${bytes[index].toString(16).padStart(2, '0')}`;
    try { return decodeURIComponent(encoded); } catch (_error) { return ''; }
  }
  return String(data == null ? '' : data);
}

async function probeClassroom(room, timeoutMs = 8000) {
  const discoveryStartedAt = Date.now();
  const resolved = await resolveClassroomHost(room, Math.min(2500, Math.max(500, timeoutMs - 1000)));
  return probeResolvedClassroom(room, resolved, Math.max(1000, timeoutMs - (Date.now() - discoveryStartedAt)));
}

function probeResolvedClassroom(room, resolved, timeoutMs) {
  return new Promise((resolve, reject) => {
    const host = resolved.host;

    let task = null;
    let settled = false;
    const startedAt = Date.now();
    const timer = setTimeout(() => finish(new Error('教室响应超时，请确认手机与教室电脑处于同一局域网')), timeoutMs);

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const current = task;
      task = null;
      if (current) {
        try { current.close({ code:1000, reason:'preflight complete' }); } catch (_error) {}
      }
      if (error) reject(error); else resolve(result);
    }

    try {
      task = wx.connectSocket({
        url:`ws://${host}:3456`,
        tcpNoDelay:true,
        timeout:timeoutMs,
        fail:error => finish(new Error(error && error.errMsg || '无法连接教室')),
      });
    } catch (error) {
      finish(error);
      return;
    }

    // 真机局域网响应很快，必须先注册消息监听，再注册打开事件并发送探测请求。
    task.onMessage(({ data }) => {
      let message;
      try { message = JSON.parse(decodeSocketMessage(data)); }
      catch (_error) { return; }
      if (message.type === 'probe-ack') {
        finish(null, { ...message, host, discovery:resolved.source, elapsed:Date.now() - startedAt });
      }
    });
    task.onError(error => finish(new Error(error && error.errMsg || '局域网连接失败')));
    task.onClose(event => {
      if (!settled) finish(new Error(event && event.reason || '教室在响应前断开连接'));
    });
    task.onOpen(() => {
      try {
        task.send({
          data:JSON.stringify({ type:'probe', client:'mini-program', sentAt:Date.now() }),
          fail:error => finish(new Error(error && error.errMsg || '无法发送连接测试')),
        });
      } catch (error) { finish(error); }
    });
  });
}

module.exports = { probeClassroom };
