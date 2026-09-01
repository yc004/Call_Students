'use strict';

const FACE_MESSAGE_PREFIXES = ['face-', 'pending-face', 'label-face'];
const DURABLE_MESSAGE_TYPES = new Set(['update-classroom','manage-teacher','update-assignments','update-submission']);

function operationId() {
  if(globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function')return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,character=>{
    const value=Math.floor(Math.random()*16);
    return(character==='x'?value:(value&3)|8).toString(16);
  });
}

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
  url.searchParams.set('protocol', '2');
  return url.toString();
}

function isFaceMessage(message) {
  const type = String(message && message.type || '');
  return FACE_MESSAGE_PREFIXES.some(prefix => type.startsWith(prefix));
}

async function requestJson(serverUrl, pathname, options = {}) {
  const headers = { 'x-banda-client':'teacher-desktop', 'x-banda-protocol':'2', ...(options.token ? { authorization:`Bearer ${options.token}` } : {}) };
  if (options.body !== undefined) headers['content-type']='application/json';
  const response = await fetch(new URL(pathname, `${normalizeServerUrl(serverUrl)}/`), {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal:AbortSignal.timeout(Number(options.timeout)||10000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error && data.error.message || `云服务请求失败（${response.status}）`), { code:data.error && data.error.code || 'CLOUD_REQUEST_FAILED', status:response.status });
  return data && Object.prototype.hasOwnProperty.call(data,'data') ? data.data : data;
}

const refreshes=new Map();
function refreshCloudSession(serverUrl,refreshToken) {
  const key=`${normalizeServerUrl(serverUrl)}\n${String(refreshToken||'')}`;
  if(refreshes.has(key))return refreshes.get(key);
  const pending=requestJson(serverUrl,'/api/v2/auth/refresh',{method:'POST',body:{refreshToken}}).finally(()=>refreshes.delete(key));
  refreshes.set(key,pending);
  return pending;
}

class CloudClassroomSocket {
  constructor({ serverUrl, accessToken, accessExpiresAt, refreshToken, classroomId, onSession, WebSocketImpl = WebSocket }) {
    this.readyState = CloudClassroomSocket.CONNECTING;
    this.classroomId = classroomId;
    this.serverUrl = serverUrl;
    this.WebSocketImpl = WebSocketImpl;
    const expires = new Date(accessExpiresAt || 0).getTime();
    if (refreshToken && (!Number.isFinite(expires) || expires <= Date.now() + 60000)) {
      refreshCloudSession(serverUrl,refreshToken).then(session => {
        if (typeof onSession === 'function') onSession(session);
        this._open(session.accessToken);
      }).catch(error => { this.readyState=CloudClassroomSocket.CLOSED; this.onerror && this.onerror(error); this.onclose && this.onclose({ code:4401, reason:error.message }); });
    } else this._open(accessToken);
  }

  _open(accessToken) {
    this._socket = new this.WebSocketImpl(websocketUrl(this.serverUrl, '/ws/client'));
    this._socket.onopen = () => this._socket.send(JSON.stringify({ event:'authenticate', data:{ token:accessToken } }));
    this._socket.onerror = event => this.onerror && this.onerror(event);
    this._socket.onclose = event => { this.readyState = CloudClassroomSocket.CLOSED; this.onclose && this.onclose(event); };
    this._socket.onmessage = event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch (_error) { return; }
      if (message.event === 'session.ready') {
        this._socket.send(JSON.stringify({ event:'subscribe', data:{ classroomId:this.classroomId } }));
        return;
      }
      if (message.event === 'subscription.ready') {
        this.readyState = CloudClassroomSocket.OPEN;
        this.onopen && this.onopen({ type:'open' });
        return;
      }
      if(message.event==='classroom.event')this.onmessage && this.onmessage({ data:JSON.stringify(message.data) });
    };
  }

  send(raw) {
    const message = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (isFaceMessage(message)) throw new Error('人脸服务仅允许通过局域网连接使用');
    if (!this._socket) throw new Error('云服务仍在建立连接');
    const data={ ...message, classroomId:this.classroomId };
    if(DURABLE_MESSAGE_TYPES.has(String(data.type||''))&&!data.operationId)data.operationId=operationId();
    this._socket.send(JSON.stringify({ event:'publish', data }));
  }

  close(code, reason) { this.readyState = CloudClassroomSocket.CLOSING; if (this._socket) this._socket.close(code, reason); else this.readyState=CloudClassroomSocket.CLOSED; }
}

CloudClassroomSocket.CONNECTING = 0;
CloudClassroomSocket.OPEN = 1;
CloudClassroomSocket.CLOSING = 2;
CloudClassroomSocket.CLOSED = 3;

const cloudClientExports = { normalizeServerUrl, websocketUrl, isFaceMessage, requestJson, refreshCloudSession, CloudClassroomSocket };
if (typeof module !== 'undefined' && module.exports) module.exports = cloudClientExports;
if (typeof globalThis !== 'undefined') Object.assign(globalThis, cloudClientExports);
