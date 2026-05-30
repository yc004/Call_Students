/* ══════════════════════════════════════════
   教师端 — 简化的连接流程
   输入 IP → 自动连接 → 班级名由教室端回传
   ══════════════════════════════════════════ */

(function () {
  'use strict';

  const api = window.api || {};

  // ── DOM ──
  let ipInput, connectBtn, roomList, noRooms, connDot, connLabel;
  let roomHeader, roomTitle, studentCount, msgRow, callMessageInp;
  let studentGrid, emptyState, historyTbody, noHistory;
  let msgEditor;

  // ── 状态 ──
  const state = {
    rooms:        [],       // { id, ip, name (from sync) }
    callHistory:  [],
    currentRoom:  null,
    ws:           null,
    students:     [],
    className:    '',
    callTimers:   {},
    reconnectTimer: null,
    reconnectAttempts: 0,
  };
  const MAX_HISTORY = 500;

  // ═══════════════════════════════════
  //  持久化
  // ═══════════════════════════════════

  async function loadFromDisk() {
    if (!api.getData) return { rooms: [], callHistory: [] };
    try {
      const d = await api.getData();
      return { rooms: d.rooms || [], callHistory: d.callHistory || [] };
    } catch (e) { return { rooms: [], callHistory: [] }; }
  }

  async function saveToDisk() {
    if (!api.saveData) return;
    try {
      await api.saveData({ rooms: state.rooms, callHistory: state.callHistory });
    } catch (e) {
      console.error('saveToDisk failed:', e.message || e);
    }
  }

  // ═══════════════════════════════════
  //  连接
  // ═══════════════════════════════════

  function connect(ip) {
    ip = ip.trim();
    if (!ip) return;

    // 断开旧连接 & 清除重连
    if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
    state.reconnectAttempts = 0;
    disconnect();

    setStatus('connecting', '连接中…');
    const url = `ws://${ip}:3456`;
    let ws;
    try { ws = new WebSocket(url); }
    catch (e) { setStatus('offline', '连接失败'); return; }

    state.ws = ws;

    ws.onopen = () => {
      setStatus('online', '已连接');
      ws.send(JSON.stringify({ type: 'connect' }));
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'sync') {
        const name = msg.className || ip;
        state.className = name;
        state.students  = msg.students || [];

        // 自动添加到教室列表
        addOrUpdateRoom(ip, name);
        state.currentRoom = state.rooms.find(r => r.ip === ip) || null;
        renderRooms();

        showRoomUI(name);
        renderStudents();
      } else if (msg.type === 'ack') {
        updateCallStatus(msg.callId, 'displayed');
      }
    };

    ws.onclose = () => {
      state.ws = null;
      if (state.currentRoom && state.currentRoom.ip === ip) {
        setStatus('offline', '已断开');
        hideRoomUI();
        renderRooms();
        scheduleReconnect(ip);
      }
    };

    ws.onerror = () => { /* onclose follows */ };
  }

  function disconnect() {
    if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
    state.reconnectAttempts = 0;
    if (state.ws) {
      state.ws.onclose = null;
      state.ws.close();
      state.ws = null;
    }
    state.currentRoom = null;
    state.students    = [];
    state.className   = '';
    hideRoomUI();
    renderStudents();
    setStatus('offline', '未连接');
    renderRooms();
  }

  function scheduleReconnect(ip) {
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 30000);
    state.reconnectAttempts++;
    setStatus('connecting', `重连中(${state.reconnectAttempts})…`);
    state.reconnectTimer = setTimeout(() => connect(ip), delay);
  }

  function setStatus(cls, text) {
    if (connDot)   connDot.className   = `dot ${cls}`;
    if (connLabel) connLabel.textContent = text;
  }

  // ═══════════════════════════════════
  //  教室列表
  // ═══════════════════════════════════

  async function addOrUpdateRoom(ip, name) {
    const existing = state.rooms.find(r => r.ip === ip);
    if (existing) {
      existing.name = name;
    } else {
      state.rooms.push({ id: genId(), ip, name });
    }
    await saveToDisk();
  }

  function renderRooms() {
    if (!roomList || !noRooms) return;
    roomList.innerHTML = '';

    if (state.rooms.length === 0) {
      noRooms.style.display = 'block';
      return;
    }
    noRooms.style.display = 'none';

    state.rooms.forEach(room => {
      const li = document.createElement('li');
      const isActive = state.currentRoom && state.currentRoom.ip === room.ip;
      li.className = 'room-item' + (isActive ? ' active' : '');
      const cls = isActive ? (state.ws ? 'online' : 'connecting') : 'offline';

      li.innerHTML =
        `<span class="dot ${cls}"></span>` +
        `<span class="room-name">${esc(room.name)}</span>` +
        `<span class="room-ip">${esc(room.ip)}</span>` +
        `<span class="room-del" data-ip="${esc(room.ip)}" title="删除">×</span>`;

      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('room-del')) return;
        connect(room.ip);
      });

      const del = li.querySelector('.room-del');
      if (del) del.addEventListener('click', (e) => {
        e.stopPropagation();
        removeRoom(room.ip);
      });

      roomList.appendChild(li);
    });
  }

  function removeRoom(ip) {
    if (state.currentRoom && state.currentRoom.ip === ip) disconnect();
    state.rooms = state.rooms.filter(r => r.ip !== ip);
    renderRooms();
    saveToDisk();
  }

  // ═══════════════════════════════════
  //  主区域
  // ═══════════════════════════════════

  function showRoomUI(name) {
    if (roomHeader) roomHeader.classList.remove('hidden');
    if (msgRow)     msgRow.classList.remove('hidden');
    if (emptyState) emptyState.style.display = 'none';
    if (roomTitle)  roomTitle.textContent = name;
  }

  function hideRoomUI() {
    if (roomHeader) roomHeader.classList.add('hidden');
    if (msgRow)     msgRow.classList.add('hidden');
    if (emptyState) emptyState.style.display = '';
    if (roomTitle)  roomTitle.textContent = '';
  }

  function renderStudents() {
    if (!studentGrid) return;
    studentGrid.innerHTML = '';
    if (studentCount) studentCount.textContent = '';

    if (!state.currentRoom || state.students.length === 0) return;
    if (studentCount) studentCount.textContent = `${state.students.length} 人`;

    state.students.forEach(s => {
      const card = document.createElement('div');
      card.className = 'student-card';
      card.innerHTML = `<div class="stu-name">${esc(s.name)}</div>`;

      const btn = document.createElement('button');
      btn.className = 'call-btn';
      btn.textContent = '📢 呼叫';
      btn.addEventListener('click', () => callStudent(s, btn));
      card.appendChild(btn);
      studentGrid.appendChild(card);
    });
  }

  // ═══════════════════════════════════
  //  呼叫
  // ═══════════════════════════════════

  function callStudent(student, btnEl) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      alert('未连接到教室，请先输入 IP 并连接');
      return;
    }

    const callId = genId();
    const rawMsg = (callMessageInp && callMessageInp.value.trim()) || '{name}同学，请到办公室';
    const msg = rawMsg.replace(/\{name\}/g, student.name);

    state.ws.send(JSON.stringify({
      type: 'call', callId,
      studentName: student.name,
      className: state.className,
      message: msg,
    }));

    state.callHistory.unshift({
      id: callId,
      roomName: state.className || (state.currentRoom ? state.currentRoom.ip : ''),
      studentName: student.name,
      time: new Date().toISOString(),
      status: 'sent',
    });
    if (state.callHistory.length > MAX_HISTORY) state.callHistory.length = MAX_HISTORY;
    renderHistory();
    saveToDisk();

    btnEl.classList.add('called');
    btnEl.textContent = '✓ 已发送';
    clearTimeout(state.callTimers[student.name]);
    state.callTimers[student.name] = setTimeout(() => {
      btnEl.classList.remove('called');
      btnEl.textContent = '📢 呼叫';
    }, 5000);
  }

  function updateCallStatus(callId, status) {
    const r = state.callHistory.find(x => x.id === callId);
    if (r) { r.status = status; renderHistory(); saveToDisk(); }
  }

  function renderHistory() {
    if (!historyTbody || !noHistory) return;
    historyTbody.innerHTML = '';
    if (state.callHistory.length === 0) { noHistory.style.display = 'block'; return; }
    noHistory.style.display = 'none';

    state.callHistory.forEach(r => {
      const t = new Date(r.time);
      const ts = t.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const lbl = r.status === 'displayed' ? '已展示' : r.status === 'sent' ? '已发送' : r.status;
      const cls = r.status === 'displayed' ? 'ok' : r.status === 'sent' ? 'pending' : 'fail';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${ts}</td><td>${esc(r.roomName)}</td><td>${esc(r.studentName)}</td><td><span class="status-tag ${cls}">${lbl}</span></td>`;
      historyTbody.appendChild(tr);
    });
  }

  // ═══════════════════════════════════
  //  消息编辑（contenteditable，{name} → 方块）
  // ═══════════════════════════════════

  function editorToText() {
    if (!msgEditor) return '';
    let out = '';
    msgEditor.childNodes.forEach(n => {
      if (n.nodeType === 3) out += n.textContent;
      else if (n.classList && n.classList.contains('name-block')) out += '{name}';
      else out += n.textContent || '';
    });
    return out;
  }

  function syncEditor() {
    if (callMessageInp) callMessageInp.value = editorToText();
  }

  function renderBlocks() {
    if (!msgEditor) return;
    // 只扫描文本节点，把 {name} 就地替换为 block（不重建整个 DOM）
    const walker = document.createTreeWalker(msgEditor, NodeFilter.SHOW_TEXT, null, false);
    const toReplace = [];
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.textContent.indexOf('{name}');
      if (idx !== -1) toReplace.push({ node, idx });
    }

    for (const { node, idx } of toReplace) {
      const before = node.textContent.substring(0, idx);
      const after  = node.textContent.substring(idx + 6);

      const block = document.createElement('span');
      block.className = 'name-block';
      block.contentEditable = 'false';
      block.textContent = '学生姓名';

      const afterText = document.createTextNode(after);
      node.textContent = before;
      node.parentNode.insertBefore(block, node.nextSibling);
      block.parentNode.insertBefore(afterText, block.nextSibling);
    }
  }

  function initEditor() {
    if (!msgEditor) return;
    const raw = (callMessageInp && callMessageInp.value) || '{name}同学，请到办公室';
    msgEditor.innerHTML = raw
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\{name\}/g, '<span class="name-block" contenteditable="false">学生姓名</span>');

    msgEditor.addEventListener('input', () => {
      renderBlocks();
      syncEditor();
    });

    // Enter 插入 {name}
    msgEditor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.execCommand('insertText', false, '{name}');
        renderBlocks();
        syncEditor();
      }
    });
  }

  // ═══════════════════════════════════
  //  工具
  // ═══════════════════════════════════

  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 9); }
  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  // ═══════════════════════════════════
  //  事件
  // ═══════════════════════════════════

  function bindEvents() {
    if (connectBtn) connectBtn.addEventListener('click', () => connect(ipInput ? ipInput.value : ''));
    if (ipInput) ipInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') connect(ipInput.value);
    });

    initEditor();
  }

  // ═══════════════════════════════════
  //  心跳
  // ═══════════════════════════════════

  setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);

  // ═══════════════════════════════════
  //  启动
  // ═══════════════════════════════════

  function onReady() {
    ipInput        = document.getElementById('ipInput');
    connectBtn     = document.getElementById('connectBtn');
    roomList       = document.getElementById('roomList');
    noRooms        = document.getElementById('noRooms');
    connDot        = document.getElementById('connDot');
    connLabel      = document.getElementById('connLabel');
    roomHeader     = document.getElementById('roomHeader');
    roomTitle      = document.getElementById('roomTitle');
    studentCount   = document.getElementById('studentCount');
    msgRow         = document.getElementById('msgRow');
    callMessageInp = document.getElementById('callMessage');
    msgEditor      = document.getElementById('msgEditor');
    studentGrid    = document.getElementById('studentGrid');
    emptyState     = document.getElementById('emptyState');
    historyTbody   = document.querySelector('#historyTable tbody');
    noHistory      = document.getElementById('noHistory');

    bindEvents();
    loadFromDisk().then(data => {
      state.rooms       = data.rooms;
      state.callHistory = data.callHistory;
      renderRooms();
      renderHistory();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
