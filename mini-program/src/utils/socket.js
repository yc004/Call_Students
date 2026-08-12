const listeners = new Set();
let socketTask = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let currentRoom = null;
let currentAccount = null;
let socketPhase = 'closed';
let state = { status: 'offline', message: '未连接', detail: '', target: '', data: null, attendance: [], presence: [], pendingFaces: [] };

function emit(event, payload) {
  listeners.forEach(listener => { try { listener(event, payload); } catch (_error) {} });
}

function setStatus(status, message, detail = '') {
  state.status = status;
  state.message = message;
  state.detail = detail;
  emit('status', { ...state });
}

function stopTimers() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  heartbeatTimer = null;
  reconnectTimer = null;
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => send({ type: 'ping' }), 20000);
}

function scheduleReconnect() {
  if (!currentRoom || !currentAccount || reconnectTimer) return;
  const delay = Math.min(1000 * (2 ** reconnectAttempt), 30000);
  reconnectAttempt += 1;
  setStatus('connecting', '正在重新连接');
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(currentRoom, currentAccount); }, delay);
}

function connect(room, account, options = {}) {
  if (!room || !room.ip || !account) return;
  const sameTarget = currentRoom && currentAccount && currentRoom.ip === room.ip && currentAccount.connectionId === account.connectionId;
  if (!options.force && socketTask && sameTarget && (socketPhase === 'open' || socketPhase === 'connecting')) {
    if (socketPhase === 'open') startHeartbeat();
    return;
  }
  if (!sameTarget) {
    state.data = null;
    state.attendance = [];
    state.presence = [];
    state.pendingFaces = [];
  }
  currentRoom = room;
  currentAccount = account;
  stopTimers();
  if (socketTask) { try { socketTask.close({ code: 1000, reason: 'switch room' }); } catch (_error) {} }
  socketTask = null;
  socketPhase = 'connecting';
  const target = String(room.ip).trim();
  state.target = target;
  setStatus('connecting', '正在连接教室', `${target}:3456`);
  const url = `ws://${target}:3456`;
  let task = null;
  task = wx.connectSocket({
    url,
    tcpNoDelay: true,
    timeout: 8000,
    fail(error) {
      if (socketTask !== task) return;
      socketTask = null;
      socketPhase = 'closed';
      setStatus('offline', '无法连接教室', formatSocketError(error, target));
      scheduleReconnect();
    },
  });
  socketTask = task;
  task.onOpen(() => {
    if (socketTask !== task) return;
    socketPhase = 'open';
    reconnectAttempt = 0;
    setStatus('connecting', '正在验证身份', `${target}:3456`);
    send({ type: 'connect', connectionId: account.connectionId, name: account.name, subjects: account.subjects || [] });
    startHeartbeat();
  });
  task.onMessage(({ data }) => {
    if (socketTask !== task) return;
    let message;
    try { message = JSON.parse(data); } catch (_error) { return; }
    if (message.type === 'sync') {
      state.data = message;
      state.attendance = message.attendance || [];
      state.pendingFaces = message.pendingFaces || [];
      setStatus('online', '已连接');
      emit('sync', message);
    } else if (message.type === 'approval-required') {
      setStatus('waiting', '等待班主任批准');
      emit('notice', message);
    } else if (message.type === 'approval-rejected' || message.type === 'login-required' || message.type === 'auth-required') {
      emit('error', message);
    } else if (message.type === 'ack') emit('ack', message);
    else if (message.type === 'face-status') { state.attendance = message.attendance || []; emit('attendance', message); }
    else if (message.type === 'face-detections') { state.presence = message.detections || []; emit('presence', message); }
    else if (message.type === 'pending-face-library') { state.pendingFaces = message.faces || []; emit('pendingFaces', message); }
  });
  task.onClose(() => {
    if (socketTask !== task) return;
    socketTask = null;
    socketPhase = 'closed';
    stopTimers();
    setStatus('offline', '教室连接已断开', `${target}:3456`);
    scheduleReconnect();
  });
  task.onError(error => {
    if (socketTask !== task) return;
    socketTask = null;
    socketPhase = 'closed';
    stopTimers();
    setStatus('offline', '无法连接教室', formatSocketError(error, target));
    try { task.close({ code: 1000, reason: 'connect failed' }); } catch (_error) {}
    scheduleReconnect();
  });
}

function formatSocketError(error, target) {
  const raw = String(error && (error.errMsg || error.message) || '').trim();
  if (/domain|合法域名/i.test(raw)) return `${target}:3456 · 微信阻止了该网络地址`;
  if (/timeout|timed out/i.test(raw)) return `${target}:3456 · 连接超时`;
  if (/refused|10061/i.test(raw)) return `${target}:3456 · 教室端未启动或端口被防火墙拦截`;
  return `${target}:3456${raw ? ` · ${raw.replace(/^connectSocket:fail\s*/i, '')}` : ''}`;
}

function send(data) {
  if (!socketTask) return false;
  try { socketTask.send({ data: JSON.stringify(data) }); return true; }
  catch (_error) { return false; }
}

function subscribe(listener) {
  listeners.add(listener);
  listener('status', { ...state });
  if (state.data) listener('sync', state.data);
  if (state.attendance.length) listener('attendance', { attendance: state.attendance });
  if (state.presence.length) listener('presence', { detections: state.presence });
  if (state.pendingFaces.length) listener('pendingFaces', { faces: state.pendingFaces });
  return () => listeners.delete(listener);
}

function disconnect() {
  currentRoom = null;
  currentAccount = null;
  stopTimers();
  if (socketTask) { try { socketTask.close({ code: 1000, reason: 'logout' }); } catch (_error) {} }
  socketTask = null;
  socketPhase = 'closed';
  state = { status: 'offline', message: '未连接', detail: '', target: '', data: null, attendance: [], presence: [], pendingFaces: [] };
  emit('status', { ...state });
}

function pauseHeartbeat() { if (heartbeatTimer) clearInterval(heartbeatTimer); heartbeatTimer = null; }
function getState() { return { ...state }; }
function reconnect(room, account) { connect(room, account, { force: true }); }

module.exports = { connect, reconnect, disconnect, send, subscribe, pauseHeartbeat, getState };
