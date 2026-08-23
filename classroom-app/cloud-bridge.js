'use strict';

const WebSocket = require('ws');

function normalizeCloudConfig(value) {
  if (!value || value.enabled === false) return null;
  const serverUrl = String(value.serverUrl || '').trim().replace(/\/+$/, '');
  const deviceToken = String(value.deviceToken || '').trim();
  const classroomId = String(value.classroomId || '').trim();
  const deviceId = String(value.deviceId || '').trim();
  if (!/^https?:\/\//i.test(serverUrl)) throw new Error('云服务器地址必须以 http:// 或 https:// 开头');
  const parsed = new URL(serverUrl);
  if (parsed.protocol !== 'https:' && !['localhost','127.0.0.1','::1','[::1]'].includes(parsed.hostname)) throw new Error('云服务必须使用 HTTPS 加密连接');
  if (!deviceToken || !classroomId || !deviceId) throw new Error('云服务设备凭证不完整，请重新使用教室接入密钥绑定');
  return { enabled:true, serverUrl, deviceToken, classroomId, deviceId };
}

function isFaceMessage(message) {
  const type = String(message && message.type || '');
  return type.startsWith('face-') || type.startsWith('pending-face') || type.startsWith('label-face');
}

function sanitizeCloudMessage(message) {
  if (!message || typeof message !== 'object' || isFaceMessage(message)) return null;
  if (message.type !== 'sync') return { ...message };
  const safe = { ...message, faceLanRequired:true };
  delete safe.attendance;
  delete safe.pendingFaces;
  delete safe.faceDetections;
  return safe;
}

function cloudSocketUrl(config) {
  const url = new URL('/ws/v1/classroom', `${config.serverUrl}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('client', 'classroom-desktop');
  url.searchParams.set('protocol', '1');
  return url.toString();
}

class ClassroomCloudBridge {
  constructor(config, options = {}) {
    this.config = normalizeCloudConfig(config);
    this.WebSocketImpl = options.WebSocketImpl || WebSocket;
    this.localUrl = options.localUrl || 'ws://127.0.0.1:3456';
    this.logger = options.logger || (() => {});
    this.statusProvider = options.statusProvider || (() => ({}));
    this.snapshotProvider = options.snapshotProvider || (() => null);
    this.membershipHandler = options.membershipHandler || (() => false);
    this.classroomHandler = options.classroomHandler || (() => false);
    this.localBridgeSecret = String(options.localBridgeSecret || '');
    this.restoreHandler = options.restoreHandler || (() => false);
    this.cloud = null;
    this.localClients = new Map();
    this.retryTimer = null;
    this.statusTimer = null;
    this.stopped = false;
  }

  start() { this.stopped = false; this.connectCloud(); }

  connectCloud() {
    if (this.stopped || this.cloud) return;
    const cloud = new this.WebSocketImpl(cloudSocketUrl(this.config));
    this.cloud = cloud;
    cloud.on('open', () => {
      this.logger('云服务传输通道已连接');
      cloud.send(JSON.stringify({ type:'authenticate', token:this.config.deviceToken }));
      if (this.statusTimer) clearInterval(this.statusTimer);
      this.statusTimer = setInterval(() => { this.sendDeviceStatus(); this.sendSnapshot(); }, 20000);
      this.statusTimer.unref?.();
    });
    cloud.on('message', raw => this.handleCloudMessage(raw));
    cloud.on('error', error => this.logger(`云服务连接错误：${error.message}`));
    cloud.on('close', () => {
      if (this.cloud === cloud) this.cloud = null;
      if (this.statusTimer) clearInterval(this.statusTimer);
      this.statusTimer = null;
      this.closeLocalClients();
      if (!this.stopped) this.retryTimer = setTimeout(() => { this.retryTimer = null; this.connectCloud(); }, 5000);
    });
  }

  handleCloudMessage(raw) {
    let message;
    try { message = JSON.parse(String(raw)); } catch (_error) { return; }
    if (message.type === 'session.ready') {
      if (this.cloud && this.cloud.readyState === this.WebSocketImpl.OPEN) {
        this.sendDeviceStatus();
        this.sendSnapshot();
      }
      return;
    }
    if (message.type === 'cloud.restore') {
      try {
        const applied = this.restoreHandler(message);
        if (applied && this.cloud && this.cloud.readyState === this.WebSocketImpl.OPEN) this.cloud.send(JSON.stringify({ type:'device.snapshot-applied', classroomId:this.config.classroomId }));
      } catch (error) { this.logger(`云端离线变更恢复失败：${error.message}`); }
      return;
    }
    if (message.type === 'cloud.membership') {
      try { this.membershipHandler(message); }
      catch (error) { this.logger(`应用云端教师成员变更失败：${error.message}`); }
      return;
    }
    if (message.type === 'cloud.classroom-update') {
      try { this.classroomHandler(message); }
      catch (error) { this.logger(`应用云端教室信息变更失败：${error.message}`); }
      return;
    }
    if (isFaceMessage(message)) { this.logger(`已拒绝云端人脸消息：${message.type}`); return; }
    const clientId = String(message._cloudClientId || '');
    if (!clientId) return;
    delete message._cloudClientId;
    let local = this.localClients.get(clientId);
    if (!local) {
      local = this.createLocalClient(clientId);
      this.localClients.set(clientId, local);
    }
    const encoded = JSON.stringify({ ...message, _cloudBridgeSecret:this.localBridgeSecret });
    if (local.readyState === this.WebSocketImpl.OPEN) local.send(encoded);
    else (local._cloudQueue || (local._cloudQueue = [])).push(encoded);
  }

  sendDeviceStatus() {
    if (this.cloud && this.cloud.readyState === this.WebSocketImpl.OPEN) this.cloud.send(JSON.stringify({ type:'device.status', classroomId:this.config.classroomId, payload:this.statusProvider() }));
  }

  sendSnapshot() {
    if (!this.cloud || this.cloud.readyState !== this.WebSocketImpl.OPEN) return;
    let snapshot;
    try { snapshot = sanitizeCloudMessage(this.snapshotProvider()); }
    catch (error) { this.logger(`读取本机云同步数据失败：${error.message}`); return; }
    if (snapshot) this.cloud.send(JSON.stringify({ ...snapshot, classroomId:this.config.classroomId }));
  }

  createLocalClient(clientId) {
    const local = new this.WebSocketImpl(this.localUrl);
    local._cloudQueue = [];
    local.on('open', () => {
      const queue = local._cloudQueue.splice(0);
      queue.forEach(item => local.send(item));
    });
    local.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch (_error) { return; }
      message = sanitizeCloudMessage(message);
      if (!message) return;
      if (this.cloud && this.cloud.readyState === this.WebSocketImpl.OPEN) {
        this.cloud.send(JSON.stringify({ ...message, classroomId:this.config.classroomId, _cloudClientId:clientId }));
      }
    });
    local.on('close', () => { if (this.localClients.get(clientId) === local) this.localClients.delete(clientId); });
    local.on('error', error => this.logger(`本机业务通道错误：${error.message}`));
    return local;
  }

  closeLocalClients() {
    this.localClients.forEach(socket => { try { socket.close(); } catch (_error) {} });
    this.localClients.clear();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.retryTimer = null;
    this.statusTimer = null;
    this.closeLocalClients();
    if (this.cloud) { try { this.cloud.close(); } catch (_error) {} }
    this.cloud = null;
  }
}

module.exports = { normalizeCloudConfig, isFaceMessage, sanitizeCloudMessage, cloudSocketUrl, ClassroomCloudBridge };
