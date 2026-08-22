'use strict';

const FACE_MESSAGE_PREFIXES = ['face-', 'pending-face', 'label-face'];

function normalizeServerUrl(value, useHttps) {
  let raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) throw new Error('请填写服务器地址');
  if (typeof useHttps === 'boolean') {
    raw = raw.replace(/^https?:\/\//i, '');
    raw = `${useHttps ? 'https' : 'http'}://${raw}`;
  } else if (!/^https?:\/\//i.test(raw)) {
    throw new Error('服务器地址必须以 http:// 或 https:// 开头');
  }
  const url = new URL(raw);
  if (url.username || url.password || url.hash || url.search) throw new Error('服务器地址不能包含账号、查询参数或片段');
  if (url.pathname !== '' && url.pathname !== '/') throw new Error('服务器地址不能包含路径');
  return url.toString().replace(/\/$/, '');
}

function websocketUrl(serverUrl, pathname) {
  const url = new URL(pathname, `${normalizeServerUrl(serverUrl)}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('client', 'teacher-desktop');
  url.searchParams.set('protocol', '1');
  return url.toString();
}

function isFaceMessage(message) {
  const type = String(message && message.type || '');
  return FACE_MESSAGE_PREFIXES.some(prefix => type.startsWith(prefix));
}

async function requestJson(serverUrl, pathname, options = {}) {
  const headers = { 'x-banda-client':'teacher-desktop', 'x-banda-protocol':'1', ...(options.token ? { authorization:`Bearer ${options.token}` } : {}) };
  if (options.body !== undefined) headers['content-type']='application/json';
  const response = await fetch(new URL(pathname, `${normalizeServerUrl(serverUrl)}/`), {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || `云服务请求失败（${response.status}）`), { code:data.error || 'CLOUD_REQUEST_FAILED', status:response.status });
  return data;
}

class CloudClassroomSocket {
  constructor({ serverUrl, accessToken, accessExpiresAt, refreshToken, classroomId, onSession, WebSocketImpl = WebSocket }) {
    this.readyState = CloudClassroomSocket.CONNECTING;
    this.classroomId = classroomId;
    this.serverUrl = serverUrl;
    this.WebSocketImpl = WebSocketImpl;
    const expires = new Date(accessExpiresAt || 0).getTime();
    if (refreshToken && (!Number.isFinite(expires) || expires <= Date.now() + 60000)) {
      requestJson(serverUrl, '/api/v1/auth/refresh', { method:'POST', body:{ refreshToken } }).then(session => {
        if (typeof onSession === 'function') onSession(session);
        this._open(session.accessToken);
      }).catch(error => { this.readyState=CloudClassroomSocket.CLOSED; this.onerror && this.onerror(error); this.onclose && this.onclose({ code:4401, reason:error.message }); });
    } else this._open(accessToken);
  }

  _open(accessToken) {
    this._socket = new this.WebSocketImpl(websocketUrl(this.serverUrl, '/ws/v1/client'));
    this._socket.onopen = () => this._socket.send(JSON.stringify({ type:'authenticate', token:accessToken }));
    this._socket.onerror = event => this.onerror && this.onerror(event);
    this._socket.onclose = event => { this.readyState = CloudClassroomSocket.CLOSED; this.onclose && this.onclose(event); };
    this._socket.onmessage = event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch (_error) { return; }
      if (message.type === 'session.ready') {
        this._socket.send(JSON.stringify({ type:'subscribe', classroomId:this.classroomId }));
        return;
      }
      if (message.type === 'subscription.ready') {
        this.readyState = CloudClassroomSocket.OPEN;
        this.onopen && this.onopen({ type:'open' });
        return;
      }
      this.onmessage && this.onmessage({ data:JSON.stringify(message) });
    };
  }

  send(raw) {
    const message = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (isFaceMessage(message)) throw new Error('人脸服务仅允许通过局域网连接使用');
    if (!this._socket) throw new Error('云服务仍在建立连接');
    this._socket.send(JSON.stringify({ ...message, classroomId:this.classroomId }));
  }

  close(code, reason) { this.readyState = CloudClassroomSocket.CLOSING; if (this._socket) this._socket.close(code, reason); else this.readyState=CloudClassroomSocket.CLOSED; }
}

CloudClassroomSocket.CONNECTING = 0;
CloudClassroomSocket.OPEN = 1;
CloudClassroomSocket.CLOSING = 2;
CloudClassroomSocket.CLOSED = 3;

const cloudClientExports = { normalizeServerUrl, websocketUrl, isFaceMessage, requestJson, CloudClassroomSocket };
if (typeof module !== 'undefined' && module.exports) module.exports = cloudClientExports;
if (typeof globalThis !== 'undefined') Object.assign(globalThis, cloudClientExports);
