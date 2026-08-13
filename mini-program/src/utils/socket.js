const listeners = new Set();
const connectionCode = require('./connection-code');
let socketTask = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let consecutiveFailures = 0;
let reconnectPaused = false;
let failurePromptShown = false;
const MAX_CONNECT_ATTEMPTS = 5;
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

function resetConnectionFailures() {
  reconnectAttempt = 0;
  consecutiveFailures = 0;
  reconnectPaused = false;
  failurePromptShown = false;
}

function showConnectionFailureGuide() {
  if (failurePromptShown || !currentRoom || !currentAccount) return;
  failurePromptShown = true;
  const roomName = currentRoom.name || '当前教室';
  wx.showModal({
    title: '无法连接教室',
    content: [
      `已连续尝试 ${MAX_CONNECT_ATTEMPTS} 次，仍无法连接“${roomName}”，自动重连已暂停。`,
      '',
      '请检查以下情况：',
      '1. 教室端软件已经启动并完成班主任绑定；',
      '2. 手机和教室电脑连接同一个 Wi‑Fi，且不是访客网络；',
      '3. 教室连接码与教室端当前显示的一致；',
      '4. 电脑防火墙允许教室端访问专用网络和 TCP 3456 端口；',
      '5. 暂时关闭手机 VPN、代理或网络加速。',
      '',
      '调整完成后可以重新连接。',
    ].join('\n'),
    cancelText: '稍后再试',
    confirmText: '重新连接',
    success: result => {
      failurePromptShown = false;
      if (!result.confirm || !currentRoom || !currentAccount) return;
      const room = currentRoom;
      const account = currentAccount;
      resetConnectionFailures();
      connect(room, account, { force: true });
    },
  });
}

function recordConnectionFailure(error, target) {
  consecutiveFailures += 1;
  const detail = formatSocketError(error, target);
  if (consecutiveFailures >= MAX_CONNECT_ATTEMPTS) {
    reconnectPaused = true;
    stopTimers();
    setStatus('offline', `连续 ${MAX_CONNECT_ATTEMPTS} 次连接失败`, `${detail} · 自动重连已暂停`);
    showConnectionFailureGuide();
    return;
  }
  setStatus('offline', '无法连接教室', `${detail} · 已尝试 ${consecutiveFailures}/${MAX_CONNECT_ATTEMPTS} 次`);
  scheduleReconnect();
}

function scheduleReconnect() {
  if (!currentRoom || !currentAccount || reconnectTimer || reconnectPaused) return;
  const delay = Math.min(1000 * (2 ** reconnectAttempt), 30000);
  reconnectAttempt += 1;
  setStatus('connecting', '正在准备重新连接', `已尝试 ${consecutiveFailures}/${MAX_CONNECT_ATTEMPTS} 次`);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(currentRoom, currentAccount); }, delay);
}

function connect(room, account, options = {}) {
  if (!room || !room.connectionCode || !account) return;
  const sameTarget = currentRoom && currentAccount && currentRoom.connectionCode === room.connectionCode && currentAccount.connectionId === account.connectionId;
  if (!options.force && socketTask && sameTarget && (socketPhase === 'open' || socketPhase === 'connecting')) {
    if (socketPhase === 'open') startHeartbeat();
    return;
  }
  if (!sameTarget) {
    state.data = null;
    state.attendance = [];
    state.presence = [];
    state.pendingFaces = [];
    resetConnectionFailures();
  } else if (options.force) {
    // 强制重连时先清除上一条连接留下的同步快照，避免扫码流程把旧教室状态误判为本次连接成功。
    state.data = null;
    state.attendance = [];
    state.presence = [];
    state.pendingFaces = [];
    resetConnectionFailures();
  } else if (reconnectPaused) {
    return;
  }
  currentRoom = room;
  currentAccount = account;
  stopTimers();
  if (socketTask) { try { socketTask.close({ code: 1000, reason: 'switch room' }); } catch (_error) {} }
  socketTask = null;
  socketPhase = 'connecting';
  let target;
  try { target = connectionCode.decode(room.connectionCode); }
  catch (error) { setStatus('offline', '连接码无效', error.message); return; }
  state.target = connectionCode.format(room.connectionCode);
  setStatus('connecting', '正在连接教室', `连接码 ${state.target}`);
  const url = `ws://${target}:3456`;
  let task = null;
  let failureRecorded = false;
  let verificationTimer = null;
  function failAttempt(error) {
    if (failureRecorded || socketTask !== task) return;
    failureRecorded = true;
    if (verificationTimer) clearTimeout(verificationTimer);
    verificationTimer = null;
    socketTask = null;
    socketPhase = 'closed';
    stopTimers();
    try { task && task.close({ code: 1000, reason: 'connect failed' }); } catch (_error) {}
    recordConnectionFailure(error, target);
  }
  task = wx.connectSocket({
    url,
    tcpNoDelay: true,
    timeout: 8000,
    fail(error) {
      failAttempt(error);
    },
  });
  socketTask = task;
  task.onOpen(() => {
    if (socketTask !== task) return;
    socketPhase = 'open';
    setStatus('connecting', '正在验证身份', `连接码 ${state.target}`);
    send({ type: 'connect', connectionId: account.connectionId, name: account.name, subjects: room.subjects || account.subjects || [] });
    startHeartbeat();
    verificationTimer = setTimeout(() => failAttempt(new Error('教室端身份验证超时')), 8000);
  });
  task.onMessage(({ data }) => {
    if (socketTask !== task) return;
    let message;
    try { message = JSON.parse(data); } catch (_error) { return; }
    if (verificationTimer) clearTimeout(verificationTimer);
    verificationTimer = null;
    resetConnectionFailures();
    if (message.type === 'sync') {
      state.data = message;
      state.attendance = message.attendance || [];
      state.pendingFaces = message.pendingFaces || [];
      setStatus('online', '已连接');
      emit('sync', message);
    } else if (message.type === 'approval-required') {
      setStatus('waiting', '等待班主任批准');
      emit('notice', message);
    } else if (message.type === 'approval-rejected' || message.type === 'login-required' || message.type === 'auth-required' || message.type === 'subject-required') {
      emit('error', message);
    } else if (message.type === 'ack') emit('ack', message);
    else if (message.type === 'face-status') { state.attendance = message.attendance || []; emit('attendance', message); }
    else if (message.type === 'face-detections') { state.presence = message.detections || []; emit('presence', message); }
    else if (message.type === 'pending-face-library') { state.pendingFaces = message.faces || []; emit('pendingFaces', message); }
  });
  task.onClose(() => {
    failAttempt(new Error('教室连接已断开'));
  });
  task.onError(error => {
    failAttempt(error);
  });
}

function formatSocketError(error, target) {
  const raw = String(error && (error.errMsg || error.message) || '').trim();
  const code = currentRoom ? connectionCode.format(currentRoom.connectionCode) : '';
  if (/domain|合法域名/i.test(raw)) return `连接码 ${code} · 微信阻止了局域网连接`;
  if (/timeout|timed out/i.test(raw)) return `连接码 ${code} · 连接超时`;
  if (/refused|10061/i.test(raw)) return `连接码 ${code} · 教室端未启动或被防火墙拦截`;
  return `连接码 ${code}${raw ? ` · ${raw.replace(/^connectSocket:fail\s*/i, '')}` : ''}`;
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

function waitForConnection(room, account, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const timer = setTimeout(() => finish(new Error('连接教室超时，请确认手机与教室电脑处于同一 Wi‑Fi')), timeoutMs);
    // connect 的网络事件一定异步触发；先重置连接状态，再订阅可避免收到上一教室的缓存 sync。
    connect(room, account, { force:true });
    unsubscribe = subscribe((event, payload) => {
      if (settled) return;
      if (event === 'sync') finish(null, { status:'approved', payload });
      else if (event === 'notice' && payload && payload.type === 'approval-required') finish(null, { status:'pending', payload });
      else if (event === 'error') finish(new Error(payload && payload.message || '教室端拒绝了当前教师身份'));
      else if (event === 'status' && payload.status === 'offline' && /连接失败|无法连接|无效/.test(payload.message || '')) finish(new Error(payload.detail || payload.message));
    });
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      if (error) reject(error); else resolve(result);
    }
  });
}

function disconnect() {
  currentRoom = null;
  currentAccount = null;
  stopTimers();
  if (socketTask) { try { socketTask.close({ code: 1000, reason: 'logout' }); } catch (_error) {} }
  socketTask = null;
  socketPhase = 'closed';
  resetConnectionFailures();
  state = { status: 'offline', message: '未连接', detail: '', target: '', data: null, attendance: [], presence: [], pendingFaces: [] };
  emit('status', { ...state });
}

function pauseHeartbeat() { if (heartbeatTimer) clearInterval(heartbeatTimer); heartbeatTimer = null; }
function getState() { return { ...state }; }
function reconnect(room, account) { connect(room, account, { force: true }); }

function fetchRoomSnapshot(room, account, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    let target;
    try { target = connectionCode.decode(room && room.connectionCode); }
    catch (error) { reject(error); return; }
    const task = wx.connectSocket({ url: `ws://${target}:3456`, tcpNoDelay: true, timeout: timeoutMs });
    let finished = false;
    const timer = setTimeout(() => finish(new Error('连接超时')), timeoutMs);
    function finish(error, data) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { task.close({ code: 1000, reason: 'summary complete' }); } catch (_error) {}
      if (error) reject(error); else resolve(data);
    }
    task.onOpen(() => task.send({ data: JSON.stringify({ type: 'connect', connectionId: account.connectionId, name: account.name, subjects: room.subjects || account.subjects || [] }) }));
    task.onMessage(({ data }) => {
      let message;
      try { message = JSON.parse(data); } catch (_error) { return; }
      if (message.type === 'sync') finish(null, message);
      else if (message.type === 'approval-required') finish(new Error('等待班主任批准'));
      else if (message.type === 'approval-rejected' || message.type === 'auth-required' || message.type === 'subject-required') finish(new Error(message.message || '没有访问权限'));
    });
    task.onError(error => finish(new Error(error && error.errMsg || '无法连接')));
    task.onClose(() => { if (!finished) finish(new Error('连接已断开')); });
  });
}

module.exports = { connect, reconnect, disconnect, send, subscribe, pauseHeartbeat, getState, fetchRoomSnapshot, waitForConnection };
