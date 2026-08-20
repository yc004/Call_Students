const listeners = new Set();
const connectionCode = require('./connection-code');
const { sessionStore } = require('./session');
const cloudApi = require('./cloud');
const roomContext = require('./room-context');
const { resolveClassroomHost } = require('./local-service');
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
let localResolveSequence = 0;
let state = { status: 'offline', message: '未连接', detail: '', target: '', data: null, attendance: [], presence: [], pendingFaces: [] };

function nonEmptySubjects(array) {
  return Array.isArray(array) && array.length ? array : null;
}

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
  const isCloud = !!(room && room.transport === 'cloud' && room.cloudClassroomId);
  if (!room || (!isCloud && !room.connectionCode) || !account) return;
  // 切到云端时取消尚未完成的局域网发现，防止迟到的 mDNS 回调覆盖云连接。
  if (isCloud) localResolveSequence += 1;
  if (isCloud && !options.skipCloudRefresh) {
    const stored = sessionStore.load();
    const expiresAt = new Date(stored && stored.cloud && stored.cloud.accessExpiresAt || 0).getTime();
    if (stored && stored.cloud && (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60000)) {
      setStatus('connecting', '正在刷新云端登录', room.name || '云端教室');
      cloudApi.refreshSession(stored.cloud).then(cloud => {
        const updated = sessionStore.updateCloud(cloud);
        try { getApp().globalData.session = updated; } catch (_error) {}
        connect(room, account, { ...options, force:true, skipCloudRefresh:true });
      }).catch(error => setStatus('offline', '云服务登录已失效', error.message || '请重新连接云服务'));
      return;
    }
  }
  const sameTarget = currentRoom && currentAccount && (currentRoom.id || currentRoom.connectionCode) === (room.id || room.connectionCode) && currentAccount.connectionId === account.connectionId;
  if (!options.force && socketTask && sameTarget && (socketPhase === 'open' || socketPhase === 'connecting')) {
    if (socketPhase === 'open') startHeartbeat();
    return;
  }
  if (!isCloud && !options.resolvedHost) {
    const resolveSequence = ++localResolveSequence;
    setStatus('connecting', '正在发现教室', `连接码 ${connectionCode.format(room.connectionCode)}`);
    resolveClassroomHost(room, 2200).then(result => {
      if (resolveSequence !== localResolveSequence) return;
      connect(room, account, { ...options, resolvedHost:result.host, discovery:result.source });
    }).catch(error => {
      if (resolveSequence !== localResolveSequence) return;
      setStatus('offline', '无法解析教室地址', error && error.message || '连接码无效');
    });
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
  // 必须先解除旧任务的“当前连接”身份，再调用 close。
  // 微信真机可能在 close() 内同步触发 onClose；顺序相反会把旧连接关闭误报为新扫码连接失败。
  const previousTask = socketTask;
  socketTask = null;
  if (previousTask) { try { previousTask.close({ code: 1000, reason: 'switch room' }); } catch (_error) {} }
  socketPhase = 'connecting';
  let target;
  let url;
  if (isCloud) {
    const stored = sessionStore.load();
    const cloud = stored && stored.cloud;
    if (!cloud || !cloud.accessToken) { setStatus('offline', '云服务登录已失效', '请在“我的”页面重新连接云服务'); return; }
    target = cloud.serverUrl;
    state.target = room.name || '云端教室';
    url = `${cloud.serverUrl.replace(/^http/i, 'ws')}/ws/v1/client?client=mini-program&protocol=1`;
    setStatus('connecting', '正在连接云服务', state.target);
  } else {
    try { target = options.resolvedHost || connectionCode.decode(room.connectionCode); }
    catch (error) { setStatus('offline', '连接码无效', error.message); return; }
    state.target = connectionCode.format(room.connectionCode);
    setStatus('connecting', '正在连接教室', `连接码 ${state.target}`);
    url = `ws://${target}:3456`;
  }
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
  task = wx.connectSocket({ url, tcpNoDelay:true, timeout:8000, fail:error => failAttempt(error) });
  socketTask = task;
  const handleOpen = () => {
    if (socketTask !== task) return;
    socketPhase = 'open';
    setStatus('connecting', isCloud ? '正在验证云端身份' : '正在验证身份', isCloud ? state.target : `连接码 ${state.target}`);
    if (isCloud) {
      task.send({ data:JSON.stringify({ type:'authenticate', token:sessionStore.load().cloud.accessToken }) });
    } else {
      // 先建立超时保护再发送身份。局域网响应可能在 send 返回前到达；顺序相反会留下
      // 一个无法被响应处理清除的“幽灵计时器”，8 秒后把正常 pending 连接误判为失败。
      verificationTimer = setTimeout(() => failAttempt(new Error('教室端身份验证超时')), 8000);
      send({ type: 'connect', purpose:'session', connectionId: account.connectionId, name: account.name, subjects: room.subjects || account.subjects || [] });
      startHeartbeat();
    }
  };
  const handleMessage = ({ data }) => {
    if (socketTask !== task) return;
    let message;
    try { message = JSON.parse(decodeSocketMessage(data)); } catch (_error) { return; }
    if (isCloud && message.type === 'session.ready') {
      task.send({ data:JSON.stringify({ type:'subscribe', classroomId:room.cloudClassroomId }) });
      return;
    }
    if (isCloud && message.type === 'subscription.ready') {
      verificationTimer = setTimeout(() => failAttempt(new Error('云端教室身份验证超时')), 8000);
      send({ type:'connect', connectionId:account.connectionId, name:account.name, subjects:room.subjects || [] });
      startHeartbeat();
      return;
    }
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
    } else if (message.type === 'leave-classroom-ack') {
      emit('left', message);
    } else if (message.type === 'membership-revoked') {
      const revokedRoom = currentRoom;
      disconnect();
      if (revokedRoom) {
        const roomKey = roomContext.keyOf(revokedRoom);
        const updated = sessionStore.removeRoom(revokedRoom);
        try { getApp().globalData.session = updated; } catch (_error) {}
        emit('membershipRevoked', { ...message, connectionCode: revokedRoom.connectionCode, roomKey });
      } else {
        emit('membershipRevoked', message);
      }
      wx.showModal({
        title: '已退出教室',
        content: message.message || '班主任已将你移出当前教室，本地教室记录已删除。',
        showCancel: false,
        confirmText: '返回首页',
        success: () => wx.switchTab({ url: '/pages/home/index' }),
      });
    } else if (message.type === 'approval-rejected' || message.type === 'login-required' || message.type === 'auth-required' || message.type === 'subject-required' || message.type === 'delivery-unavailable') {
      emit('error', message);
    } else if (message.type === 'ack') emit('ack', message);
    else if (message.type === 'face-status') { state.attendance = message.attendance || []; emit('attendance', message); }
    else if (message.type === 'face-detections') { state.presence = message.detections || []; emit('presence', message); }
    else if (message.type === 'pending-face-library') { state.pendingFaces = message.faces || []; emit('pendingFaces', message); }
  };
  // 接收与异常监听必须先于 onOpen。局域网内服务端响应非常快，先发送身份再注册
  // onMessage 会漏掉首次绑定的 approval-required，最终被误判为连接超时。
  task.onMessage(handleMessage);
  task.onClose(() => failAttempt(new Error('教室连接已断开')));
  task.onError(error => failAttempt(error));
  task.onOpen(handleOpen);
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
  if (currentRoom && currentRoom.transport === 'cloud' && /^(face-|pending-face|label-face)/.test(String(data && data.type || ''))) return false;
  const payload = currentRoom && currentRoom.transport === 'cloud' ? { ...data, classroomId:currentRoom.cloudClassroomId } : data;
  try { socketTask.send({ data: JSON.stringify(payload) }); return true; }
  catch (_error) { return false; }
}

function subscribe(listener, options = {}) {
  listeners.add(listener);
  if (options.replay === false) return () => listeners.delete(listener);
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
    unsubscribe = subscribe((event, payload) => {
      if (settled) return;
      if (event === 'sync') finish(null, { status:'approved', payload });
      else if (event === 'notice' && payload && payload.type === 'approval-required') finish(null, { status:'pending', payload });
      else if (event === 'error') finish(new Error(payload && payload.message || '教室端拒绝了当前教师身份'));
      else if (event === 'status' && payload.status === 'offline' && /连接失败|无法连接|无效/.test(payload.message || '')) finish(new Error(payload.detail || payload.message));
    }, { replay:false });
    // 先订阅本次连接事件再发起 WebSocket，避免首次绑定的快速响应被漏掉。
    connect(room, account, { force:true });
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
  localResolveSequence += 1;
  currentRoom = null;
  currentAccount = null;
  stopTimers();
  const previousTask = socketTask;
  socketTask = null;
  socketPhase = 'closed';
  if (previousTask) { try { previousTask.close({ code: 1000, reason: 'logout' }); } catch (_error) {} }
  resetConnectionFailures();
  state = { status: 'offline', message: '未连接', detail: '', target: '', data: null, attendance: [], presence: [], pendingFaces: [] };
  emit('status', { ...state });
}

function pauseHeartbeat() { if (heartbeatTimer) clearInterval(heartbeatTimer); heartbeatTimer = null; }
function getState() { return { ...state }; }
function reconnect(room, account) { connect(room, account, { force:true }); }

function roomSnapshotError(roomStatus, message) {
  const error = new Error(message || '无法读取教室状态');
  error.roomStatus = roomStatus;
  return error;
}

function fetchRoomSnapshot(room, account, timeoutMs = 6000) {
  const sameCurrentRoom = currentRoom && currentAccount && room && account
    && (currentRoom.id || currentRoom.connectionCode) === (room.id || room.connectionCode)
    && currentAccount.connectionId === account.connectionId;
  if (sameCurrentRoom && state.data) return Promise.resolve(state.data);
  if (sameCurrentRoom && state.status === 'waiting') {
    return Promise.reject(roomSnapshotError('pending', '加入申请已发送，等待班主任批准'));
  }
  if (sameCurrentRoom && socketTask && (socketPhase === 'connecting' || socketPhase === 'open')) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new Error('读取教室状态超时')), timeoutMs);
      const unsubscribe = subscribe((event, payload) => {
        if (event === 'sync') finish(null, payload);
        else if (event === 'notice' && payload && payload.type === 'approval-required') finish(roomSnapshotError('pending', payload.message || '等待班主任批准'));
        else if (event === 'error') finish(roomSnapshotError('identity-error', payload && payload.message || '教师身份无效'));
      }, { replay:false });
      function finish(error, data) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        if (error) reject(error); else resolve(data);
      }
    });
  }
  if (room && room.transport === 'cloud' && room.cloudClassroomId) {
    const stored = sessionStore.load();
    if (!stored || !stored.cloud) return Promise.reject(new Error('云服务登录已失效'));
    const loadSnapshot = async () => {
      let cloud = stored.cloud;
      const expiresAt = new Date(cloud.accessExpiresAt || 0).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60000) {
        cloud = await cloudApi.refreshSession(cloud);
        const updated = sessionStore.updateCloud(cloud);
        try { getApp().globalData.session = updated; } catch (_error) {}
      }
      return cloudApi.request(cloud.serverUrl, `/api/v1/classrooms/${encodeURIComponent(room.cloudClassroomId)}/snapshot`, { token:cloud.accessToken, timeout:timeoutMs });
    };
    return loadSnapshot().then(snapshot => {
      const submissions = new Map();
      (snapshot.submissions || []).forEach(item => {
        if (!submissions.has(item.assignment_id)) submissions.set(item.assignment_id, {});
        submissions.get(item.assignment_id)[item.student_id] = item.status;
      });
      return {
        type:'sync', className:snapshot.classroom && snapshot.classroom.name || room.name,
        classroomConfigured:snapshot.classroom && snapshot.classroom.configured !== false,
        students:(snapshot.students || []).map(item => ({ id:item.id, name:item.name })),
        assignments:(snapshot.assignments || []).map(item => ({ id:item.id, subject:item.subject, type:item.type, title:item.title, deadline:item.deadline, date:String(item.publish_at || item.created_at || '').slice(0,10), submissions:submissions.get(item.id) || {} })),
        teacher:{ role:snapshot.teacher && snapshot.teacher.role === 'homeroom' ? '班主任' : '授课教师', subjects:snapshot.teacher && snapshot.teacher.subjects_json || [] },
        teachers:{ approved:(snapshot.members || []).map(item => ({ connection_id:item.user_id, name:item.name, role:item.role === 'homeroom' ? '班主任' : '授课教师', subjects:item.subjects_json || [] })), pending:[] },
        attendance:[], pendingFaces:[], faceLanRequired:true,
      };
    });
  }
  if (room && !room.__resolvedHost) {
    return resolveClassroomHost(room, Math.min(2200, timeoutMs - 500)).then(result => (
      fetchRoomSnapshot({ ...room, __resolvedHost:result.host }, account, timeoutMs)
    ));
  }
  return new Promise((resolve, reject) => {
    let target;
    try { target = room.__resolvedHost || connectionCode.decode(room && room.connectionCode); }
    catch (error) { reject(error); return; }
    const task = wx.connectSocket({ url:`ws://${target}:3456`, tcpNoDelay:true, timeout:timeoutMs });
    let finished = false;
    const timer = setTimeout(() => finish(new Error('连接超时')), timeoutMs);
    function finish(error, data) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { task.close({ code: 1000, reason: 'summary complete' }); } catch (_error) {}
      if (error) reject(error); else resolve(data);
    }
    task.onMessage(({ data }) => {
      let message;
      try { message = JSON.parse(decodeSocketMessage(data)); } catch (_error) { return; }
      if (message.type === 'sync') finish(null, message);
      else if (message.type === 'approval-required') {
        const text = message.message || '等待班主任批准';
        const status = /初始化|绑定班主任|首次设置/.test(text) ? 'uninitialized' : 'pending';
        finish(roomSnapshotError(status, text));
      } else if (message.type === 'auth-required') {
        const text = message.message || '没有访问权限';
        finish(roomSnapshotError(/初始化|基础配置/.test(text) ? 'uninitialized' : 'identity-error', text));
      } else if (message.type === 'approval-rejected' || message.type === 'subject-required' || message.type === 'login-required') {
        finish(roomSnapshotError('identity-error', message.message || '教师身份无效'));
      }
    });
    task.onError(error => finish(new Error(error && error.errMsg || '无法连接')));
    task.onClose(() => { if (!finished) finish(new Error('连接已断开')); });
    task.onOpen(() => task.send({ data: JSON.stringify({ type: 'connect', purpose:'snapshot', connectionId: account.connectionId, name: account.name, subjects: room.subjects || account.subjects || [] }) }));
  });
}

function leaveClassroom(room, account, timeoutMs = 8000) {
  if (room && room.transport === 'cloud' && room.cloudClassroomId) {
    const stored = sessionStore.load();
    if (!stored || !stored.cloud) return Promise.reject(new Error('云服务登录已失效，请重新连接云服务'));
    const expiresAt = new Date(stored.cloud.accessExpiresAt || 0).getTime();
    const sessionPromise = !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60000 ? cloudApi.refreshSession(stored.cloud) : Promise.resolve(stored.cloud);
    return sessionPromise.then(cloud => {
      if (cloud !== stored.cloud) { const updated=sessionStore.updateCloud(cloud); try { getApp().globalData.session=updated; } catch (_error) {} }
      return cloudApi.leaveClassroom(cloud, room.cloudClassroomId);
    }).then(() => ({ type:'leave-classroom-ack', removed:true, cloud:true }));
  }
  const sameTarget = currentRoom && currentAccount
    && currentRoom.connectionCode === room.connectionCode
    && currentAccount.connectionId === account.connectionId;
  if (sameTarget && socketTask && socketPhase === 'open') {
    return new Promise((resolve, reject) => {
      let settled = false;
      const unsubscribe = subscribe((event, payload) => {
        if (event === 'left') finish(null, payload);
        else if (event === 'error') finish(new Error(payload && payload.message || '教室端拒绝退出请求'));
      });
      const timer = setTimeout(() => finish(new Error('等待教室端确认超时')), timeoutMs);
      function finish(error, result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        if (error) reject(error); else resolve(result);
      }
      if (!send({ type: 'leave-classroom' })) finish(new Error('教室连接已断开'));
    });
  }

  if (room && !room.__resolvedHost) {
    return resolveClassroomHost(room, Math.min(2200, timeoutMs - 500)).then(result => (
      leaveClassroom({ ...room, __resolvedHost:result.host }, account, timeoutMs)
    ));
  }

  return new Promise((resolve, reject) => {
    let target;
    try { target = room.__resolvedHost || connectionCode.decode(room && room.connectionCode); }
    catch (error) { reject(error); return; }
    const task = wx.connectSocket({ url:`ws://${target}:3456`, tcpNoDelay:true, timeout:timeoutMs });
    let finished = false;
    let authenticated = false;
    const timer = setTimeout(() => finish(new Error('无法连接教室端，退出操作尚未完成')), timeoutMs);
    function finish(error, data) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { task.close({ code: 1000, reason: 'leave complete' }); } catch (_error) {}
      if (error) reject(error); else resolve(data);
    }
    task.onMessage(({ data }) => {
      let message;
      try { message = JSON.parse(decodeSocketMessage(data)); } catch (_error) { return; }
      if ((message.type === 'sync' || message.type === 'approval-required') && !authenticated) {
        authenticated = true;
        task.send({ data: JSON.stringify({ type: 'leave-classroom' }) });
      } else if (message.type === 'leave-classroom-ack') finish(null, message);
      else if (['approval-rejected', 'login-required', 'auth-required', 'subject-required'].includes(message.type)) finish(new Error(message.message || '教室端拒绝退出请求'));
    });
    task.onError(error => finish(new Error(error && error.errMsg || '无法连接教室端')));
    task.onClose(() => { if (!finished) finish(new Error('教室连接已断开，退出操作尚未完成')); });
    task.onOpen(() => task.send({ data: JSON.stringify({
      type: 'connect',
      purpose:'leave',
      connectionId: account.connectionId,
      name: account.name,
      subjects: room.subjects || account.subjects || [],
    }) }));
  });
}

module.exports = { connect, reconnect, disconnect, send, subscribe, pauseHeartbeat, getState, fetchRoomSnapshot, waitForConnection, leaveClassroom };
