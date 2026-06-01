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
  let searchInput, searchRow, searchResult;
  let msgEditor;
  let mainTabs, mainTabBtns, mainTabContents;
  let hwSection, addSubjectBtn, delSubjectBtn;
  let hwStatusFilter, hwDateFrom, hwDateTo, addAssignmentBtn2;
  // 多选
  let hwSubjectMs, hwSubjectBtn, hwSubjectDrop, selectedSubjects = [];
  let hwAssignMs, hwAssignBtn, hwAssignDrop, selectedAssigns = [];
  let hwContent;
  let hwSubjectModal, hwSubjectName, hwSubjectModalCancel, hwSubjectModalConfirm;
  let hwModal, hwModalTitleLabel, hwModalSubject, hwModalTitle, hwModalDate, hwModalCancel, hwModalConfirm;

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
    searchQuery:  '',
    subjects:     [],
    assignments:  [],
    editingAssignmentId: null,
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
        state.subjects  = msg.subjects || [];
        state.assignments = msg.assignments || [];
        selectedSubjects = [];
        selectedAssigns  = [];

        // 自动添加到教室列表
        addOrUpdateRoom(ip, name);
        state.currentRoom = state.rooms.find(r => r.ip === ip) || null;
        renderRooms();

        showRoomUI(name);
        renderStudents();
        renderHomework();
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
    state.subjects    = [];
    state.assignments = [];
    state.searchQuery = '';
    if (searchInput) searchInput.value = '';
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
    if (mainTabs)   mainTabs.classList.remove('hidden');
    if (roomHeader) roomHeader.classList.remove('hidden');
    if (msgRow)     msgRow.classList.remove('hidden');
    if (searchRow)  searchRow.classList.remove('hidden');
    if (emptyState) emptyState.style.display = 'none';
    if (roomTitle)  roomTitle.textContent = name;
  }

  function hideRoomUI() {
    if (mainTabs)   mainTabs.classList.add('hidden');
    if (roomHeader) roomHeader.classList.add('hidden');
    if (msgRow)     msgRow.classList.add('hidden');
    if (searchRow)  searchRow.classList.add('hidden');
    if (emptyState) emptyState.style.display = '';
    if (roomTitle)  roomTitle.textContent = '';
  }

  function renderStudents() {
    if (!studentGrid) return;
    studentGrid.innerHTML = '';
    if (studentCount) studentCount.textContent = '';
    if (searchResult) searchResult.textContent = '';

    if (!state.currentRoom || state.students.length === 0) return;

    const q = state.searchQuery || '';
    const list = q ? state.students.filter(s => s.name.toLowerCase().includes(q)) : state.students;

    if (studentCount) studentCount.textContent = `${state.students.length} 人`;
    if (searchResult) {
      if (q && list.length < state.students.length) {
        searchResult.textContent = `${list.length} / ${state.students.length} 人`;
      } else if (q && list.length === 0) {
        searchResult.textContent = '无匹配';
      }
    }

    list.forEach(s => {
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
  // ═══════════════════════════════════
  //  Tab 切换
  // ═══════════════════════════════════

  function switchMainTab(name) {
    mainTabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    mainTabContents.forEach(c => c.classList.toggle('hidden', c.id !== 'tab-' + name));
  }

  // ═══════════════════════════════════
  //  多选组件
  // ═══════════════════════════════════

  function initMultiSelects() {
    // 点击外部关闭
    document.addEventListener('click', (e) => {
      if (hwSubjectDrop && !hwSubjectMs.contains(e.target)) hwSubjectDrop.classList.add('hidden');
      if (hwAssignDrop && !hwAssignMs.contains(e.target)) hwAssignDrop.classList.add('hidden');
    });
    // 学科按钮
    if (hwSubjectBtn) hwSubjectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hwSubjectDrop.classList.toggle('hidden');
      if (hwAssignDrop) hwAssignDrop.classList.add('hidden');
    });
    // 作业按钮
    if (hwAssignBtn) hwAssignBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hwAssignDrop.classList.toggle('hidden');
      if (hwSubjectDrop) hwSubjectDrop.classList.add('hidden');
    });
  }

  function buildSubjectDrop() {
    if (!hwSubjectDrop) return;
    let html = '';
    state.subjects.forEach(sub => {
      const chk = selectedSubjects.length === 0 || selectedSubjects.includes(sub) ? 'checked' : '';
      html += `<label><input type="checkbox" value="${esc(sub)}" ${chk}> ${esc(sub)}</label>`;
    });
    html += '<div class="ms-actions"><button data-ms-action="all">全选</button><button data-ms-action="none">清除</button></div>';
    hwSubjectDrop.innerHTML = html;
    // 事件
    hwSubjectDrop.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const v = cb.value;
        if (cb.checked) { if (!selectedSubjects.includes(v)) selectedSubjects.push(v); }
        else { selectedSubjects = selectedSubjects.filter(s => s !== v); }
        updateSubjectBtn();
        applyFilters();
      });
    });
    hwSubjectDrop.querySelectorAll('button[data-ms-action]').forEach(b => {
      b.addEventListener('click', () => {
        if (b.dataset.msAction === 'all') selectedSubjects = [...state.subjects];
        else selectedSubjects = [];
        buildSubjectDrop(); updateSubjectBtn(); applyFilters();
      });
    });
  }

  function updateSubjectBtn() {
    if (!hwSubjectBtn) return;
    if (selectedSubjects.length === 0 || selectedSubjects.length === state.subjects.length) {
      hwSubjectBtn.textContent = '全部学科 ▾';
    } else if (selectedSubjects.length <= 2) {
      hwSubjectBtn.textContent = selectedSubjects.join(', ') + ' ▾';
    } else {
      hwSubjectBtn.textContent = selectedSubjects.length + ' 个学科 ▾';
    }
  }

  function buildAssignDrop() {
    if (!hwAssignDrop) return;
    let hws = state.assignments;
    const from = hwDateFrom ? hwDateFrom.value : '';
    const to = hwDateTo ? hwDateTo.value : '';
    if (from) hws = hws.filter(a => a.date >= from);
    if (to) hws = hws.filter(a => a.date <= to);
    if (selectedSubjects.length > 0) hws = hws.filter(a => selectedSubjects.includes(a.subject));
    hws.sort((a, b) => a.date.localeCompare(b.date));
    let html = '';
    hws.forEach(a => {
      const chk = selectedAssigns.length === 0 || selectedAssigns.includes(a.id) ? 'checked' : '';
      html += `<label><input type="checkbox" value="${a.id}" ${chk}> ${esc(a.subject)} - ${esc(a.title)}</label>`;
    });
    html += '<div class="ms-actions"><button data-ms-action="all">全选</button><button data-ms-action="none">清除</button></div>';
    hwAssignDrop.innerHTML = html;
    hwAssignDrop.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const v = cb.value;
        if (cb.checked) { if (!selectedAssigns.includes(v)) selectedAssigns.push(v); }
        else { selectedAssigns = selectedAssigns.filter(s => s !== v); }
        updateAssignBtn();
        applyFilters();
      });
    });
    hwAssignDrop.querySelectorAll('button[data-ms-action]').forEach(b => {
      b.addEventListener('click', () => {
        if (b.dataset.msAction === 'all') {
          selectedAssigns = []; hwAssignDrop.querySelectorAll('input[type="checkbox"]').forEach(cb => { selectedAssigns.push(cb.value); });
        } else { selectedAssigns = []; }
        buildAssignDrop(); updateAssignBtn(); applyFilters();
      });
    });
  }

  function updateAssignBtn() {
    if (!hwAssignBtn) return;
    const hws = state.assignments;
    if (selectedAssigns.length === 0 || selectedAssigns.length >= hws.length) {
      hwAssignBtn.textContent = '全部作业 ▾';
    } else if (selectedAssigns.length <= 2) {
      const names = selectedAssigns.map(id => { const a = hws.find(x => x.id === id); return a ? a.title : id; });
      hwAssignBtn.textContent = names.join(', ') + ' ▾';
    } else {
      hwAssignBtn.textContent = selectedAssigns.length + ' 个作业 ▾';
    }
  }

  function applyFilters() {
    if (selectedAssigns.length > 0) {
      if (selectedAssigns.length === 1) { renderSingleAssignment(selectedAssigns[0]); return; }
      renderHomeworkList(null);
    } else {
      renderHomeworkList(null);
    }
  }

  // ═══════════════════════════════════
  //  作业管理
  // ═══════════════════════════════════

  function renderHomework() {
    if (!hwSubjectBtn) return;
    if (delSubjectBtn) delSubjectBtn.disabled = state.subjects.length === 0;

    buildSubjectDrop();
    updateSubjectBtn();
    buildAssignDrop();
    updateAssignBtn();

    if (selectedAssigns.length === 1) {
      renderSingleAssignment(selectedAssigns[0]);
    } else {
      renderHomeworkList(null);
    }
  }

  // ── 辅助函数 ──

  function updateStatusFilter() {
    if (!hwStatusFilter) return;
    const cur = hwStatusFilter.value;
    const builtin = ['已提交', '未提交', '迟交', '免交'];
    const customs = getHwCustomStatuses();
    hwStatusFilter.innerHTML = '<option value="">全部状态</option>';
    [...builtin, ...customs].forEach(st => {
      hwStatusFilter.innerHTML += `<option value="${esc(st)}" ${cur===st?'selected':''}>${esc(st)}</option>`;
    });
  }

  function renderSingleAssignment(aid) {
    if (!hwContent) return;
    const a = state.assignments.find(x => x.id === aid);
    if (!a) { hwContent.innerHTML = '<div class="muted-note">未找到该作业</div>'; return; }
    const builtin = ['已提交', '未提交', '迟交', '免交'];
    const customs = getHwCustomStatuses();
    const filterStatus = hwStatusFilter ? hwStatusFilter.value : '';
    updateStatusFilter();
    let html = '<div class="hw-table-wrap"><table class="hw-matrix"><thead><tr>';
    html += '<th class="hw-matrix-name">姓名</th>';
    html += `<th class="hw-matrix-hw"><div class="hw-matrix-hw-title">${esc(a.title)}</div>`;
    html += `<div class="hw-matrix-hw-date">${esc(a.subject)} · ${esc(a.date)}</div>`;
    html += `<select class="hw-batch-sel" data-batch-aid="${a.id}"><option value="">批量▼</option>`;
    html += '<option value="已提交">全部已提交</option><option value="未提交">全部未提交</option>';
    html += '<option value="迟交">全部迟交</option><option value="免交">全部免交</option></select>';
    html += '<div class="hw-matrix-hw-acts">';
    html += `<button class="btn-ico" data-edit-hw="${a.id}">✎</button>`;
    html += `<button class="btn-ico" data-del-hw="${a.id}">×</button></div></th></tr></thead><tbody>`;
    state.students.forEach(s => {
      const st = (a.submissions && a.submissions[s.id]) || '未提交';
      if (filterStatus && st !== filterStatus) return;
      html += `<tr><td class="hw-matrix-name">${esc(s.name)}</td><td class="hw-matrix-cell">`;
      html += `<select class="hw-grid-status-select ${hwStatusClass(st)}" data-aid="${a.id}" data-sid="${s.id}" data-prev="${esc(st)}">`;
      builtin.forEach(x => { html += `<option value="${x}" ${st===x?'selected':''}>${x}</option>`; });
      if (customs.length > 0) {
        html += '<optgroup label="自定义">';
        customs.forEach(x => { html += `<option value="${esc(x)}" ${st===x?'selected':''}>${esc(x)}</option>`; });
        html += '</optgroup>';
      }
      if (st && !builtin.includes(st) && !customs.includes(st)) html += `<option value="${esc(st)}" selected>${esc(st)}</option>`;
      html += '<option value="__custom__">✏️ 自定义...</option></select></td></tr>';
    });
    html += '</tbody></table></div>';
    hwContent.innerHTML = html;
    bindHwEvents();
  }

  function bindHwEvents() {
    if (!hwContent) return;
    hwContent.querySelectorAll('.hw-batch-sel').forEach(sel => {
      sel.addEventListener('change', (e) => { e.stopPropagation(); handleBatch(sel.dataset.batchAid, sel.value); sel.value = ''; });
    });
    hwContent.querySelectorAll('[data-edit-hw]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); openEditHw(btn.dataset.editHw); });
    });
    hwContent.querySelectorAll('[data-del-hw]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); deleteHw(btn.dataset.delHw); });
    });
    hwContent.querySelectorAll('.hw-grid-status-select').forEach(sel => {
      sel.addEventListener('change', (e) => { e.stopPropagation(); handleHwStatusChange(sel); });
      sel.addEventListener('click', (e) => e.stopPropagation());
    });
  }

  // ── 学科弹窗 ──

  function openAddSubject() {
    if (!hwSubjectModal || !hwSubjectName) return;
    hwSubjectName.value = '';
    hwSubjectModal.classList.remove('hidden');
    hwSubjectName.focus();
  }

  function confirmAddSubject() {
    if (!hwSubjectName || !hwSubjectModal) return;
    const name = hwSubjectName.value.trim();
    if (!name) { hwSubjectName.focus(); return; }
    if (state.subjects.includes(name)) { alert('该学科已存在'); return; }
    state.subjects.push(name);
    state.subjects.sort();
    // 自动选中新学科
    if (!selectedSubjects.includes(name)) selectedSubjects.push(name);
    hwSubjectModal.classList.add('hidden');
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'update-subjects', action: 'add', subject: name }));
    }
    renderHomework();
  }

  function deleteCurrentSubject() {
    if (selectedSubjects.length === 0) { alert('请先在学科多选中选择一个学科'); return; }
    const subject = selectedSubjects[0];
    const cnt = state.assignments.filter(a => a.subject === subject).length;
    const msg = cnt ? `学科「${subject}」下有 ${cnt} 项作业，删除学科将同时删除这些作业，确定吗？` : `确定删除学科「${subject}」吗？`;
    if (!confirm(msg)) return;
    state.subjects = state.subjects.filter(s => s !== subject);
    state.assignments = state.assignments.filter(a => a.subject !== subject);
    selectedSubjects = selectedSubjects.filter(s => s !== subject);
    selectedAssigns = selectedAssigns.filter(id => { const a = state.assignments.find(x => x.id === id); return a && a.subject !== subject; });
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'update-subjects', action: 'delete', subject }));
    }
    renderHomework();
  }

  // ── 作业列表 ──

  function updateHwSubjectSelect() {
    if (!hwModalSubject) return;
    hwModalSubject.innerHTML = '';
    if (state.subjects.length === 0) {
      hwModalSubject.innerHTML = '<option value="">-- 请先添加学科 --</option>';
      return;
    }
    state.subjects.forEach(sub => {
      const opt = document.createElement('option');
      opt.value = sub; opt.textContent = sub;
      hwModalSubject.appendChild(opt);
    });
  }

  function getFilteredAssignments(subject) {
    let hws = state.assignments;
    if (subject) hws = hws.filter(a => a.subject === subject);
    if (selectedSubjects.length > 0) hws = hws.filter(a => selectedSubjects.includes(a.subject));
    if (selectedAssigns.length > 0) hws = hws.filter(a => selectedAssigns.includes(a.id));
    const from = hwDateFrom ? hwDateFrom.value : '';
    const to   = hwDateTo   ? hwDateTo.value   : '';
    if (from) hws = hws.filter(a => a.date >= from);
    if (to)   hws = hws.filter(a => a.date <= to);
    // 按日期排序
    hws.sort((a, b) => a.date.localeCompare(b.date));
    return hws;
  }

  function renderHomeworkList(subject) {
    if (!hwContent) return;
    const hws = getFilteredAssignments(subject);
    updateStatusFilter();

    if (hws.length === 0) {
      hwContent.innerHTML = '<div class="muted-note">该学科暂无作业</div>';
      return;
    }

    const builtin = ['已提交', '未提交', '迟交', '免交'];
    const customs = getHwCustomStatuses();
    const filterStatus = hwStatusFilter ? hwStatusFilter.value : '';

    let html = '<div class="hw-table-wrap"><table class="hw-matrix"><thead><tr>';
    html += '<th class="hw-matrix-name">姓名</th>';
    hws.forEach(a => {
      html += `<th class="hw-matrix-hw">`;
      html += `<div class="hw-matrix-hw-title" title="${esc(a.title)}">${esc(a.title)}</div>`;
      html += `<div class="hw-matrix-hw-date">${esc(a.date)}</div>`;
      html += `<select class="hw-batch-sel" data-batch-aid="${a.id}">`;
      html += `<option value="">批量▼</option>`;
      html += `<option value="已提交">全部已提交</option>`;
      html += `<option value="未提交">全部未提交</option>`;
      html += `<option value="迟交">全部迟交</option>`;
      html += `<option value="免交">全部免交</option>`;
      html += `</select>`;
      html += `<div class="hw-matrix-hw-acts">`;
      html += `<button class="btn-ico" data-edit-hw="${a.id}" title="编辑">✎</button>`;
      html += `<button class="btn-ico" data-del-hw="${a.id}" title="删除">×</button>`;
      html += `</div></th>`;
    });
    html += '</tr></thead><tbody>';

    state.students.forEach(s => {
      // 状态筛选
      if (filterStatus) {
        const hasStatus = hws.some(a => {
          const st = (a.submissions && a.submissions[s.id]) || '未提交';
          return st === filterStatus;
        });
        if (!hasStatus) return;
      }
      html += '<tr>';
      html += `<td class="hw-matrix-name">${esc(s.name)}</td>`;
      hws.forEach(a => {
        const status = (a.submissions && a.submissions[s.id]) || '未提交';
        html += `<td class="hw-matrix-cell">`;
        html += `<select class="hw-grid-status-select ${hwStatusClass(status)}" data-aid="${a.id}" data-sid="${s.id}" data-prev="${esc(status)}">`;
        builtin.forEach(st => {
          html += `<option value="${st}" ${status === st ? 'selected' : ''}>${st}</option>`;
        });
        if (customs.length > 0) {
          html += '<optgroup label="自定义">';
          customs.forEach(st => {
            html += `<option value="${esc(st)}" ${status === st ? 'selected' : ''}>${esc(st)}</option>`;
          });
          html += '</optgroup>';
        }
        if (status && !builtin.includes(status) && !customs.includes(status)) {
          html += `<option value="${esc(status)}" selected>${esc(status)}</option>`;
        }
        html += '<option value="__custom__">✏️ 自定义...</option>';
        html += '</select>';
        html += '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    hwContent.innerHTML = html;
    bindHwEvents();
  }

  function getHwCustomStatuses() {
    const set = new Set();
    const builtin = ['已提交', '未提交', '迟交', '免交'];
    state.assignments.forEach(a => {
      if (!a.submissions) return;
      Object.values(a.submissions).forEach(v => {
        if (v && !builtin.includes(v)) set.add(v);
      });
    });
    return Array.from(set).sort();
  }

  function hwStatusClass(s) {
    switch (s) { case '已提交': return 'st-ok'; case '迟交': return 'st-late'; case '免交': return 'st-exempt'; default: return 'st-miss'; }
  }

  function handleBatch(aid, status) {
    if (!status) return;
    const a = state.assignments.find(x => x.id === aid);
    if (!a) return;
    if (!a.submissions) a.submissions = {};
    state.students.forEach(s => { a.submissions[s.id] = status; });
    // WS 同步
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({
        type: 'update-assignments', action: 'edit', assignment: a,
      }));
    }
    if (selectedAssigns.length === 1) renderSingleAssignment(aid);
    else renderHomeworkList(null);
  }

  function handleHwStatusChange(sel) {
    const aid = sel.dataset.aid;
    const sid = sel.dataset.sid;
    const a = state.assignments.find(x => x.id === aid);
    if (!a) return;
    if (!a.submissions) a.submissions = {};

    if (sel.value === '__custom__') {
      const custom = prompt('请输入自定义状态（例如：已补交、请假等）：');
      if (!custom || !custom.trim()) {
        sel.value = sel.dataset.prev;
        return;
      }
      const val = custom.trim();
      a.submissions[sid] = val;
      sel.dataset.prev = val;
    } else {
      a.submissions[sid] = sel.value;
      sel.dataset.prev = sel.value;
    }

    sel.className = 'hw-grid-status-select ' + hwStatusClass(a.submissions[sid]);

    // 通过 WS 同步到教室端
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({
        type: 'update-submission', assignmentId: aid, studentId: sid, status: a.submissions[sid],
      }));
    }

    // 如果有新的自定义状态，重新渲染以更新下拉选项
    const builtin = ['已提交', '未提交', '迟交', '免交'];
    if (!builtin.includes(a.submissions[sid])) {
      if (selectedAssigns.length === 1) renderSingleAssignment(selectedAssigns[0]);
      else renderHomeworkList(null);
    }
  }

  // ── 作业弹窗 ──

  function openAddHw() {
    if (state.subjects.length === 0) { alert('请先添加学科'); return; }
    state.editingAssignmentId = null;
    if (hwModalTitleLabel) hwModalTitleLabel.textContent = '添加作业';
    if (hwModalTitle) hwModalTitle.value = '';
    if (hwModalDate) hwModalDate.value = new Date().toISOString().slice(0, 10);
    updateHwSubjectSelect();
    // 默认选中已选的学科
    if (hwModalSubject && selectedSubjects.length > 0) {
      hwModalSubject.value = selectedSubjects[0];
    } else if (hwModalSubject && state.subjects.length > 0) {
      hwModalSubject.value = state.subjects[0];
    }
    hwModal.classList.remove('hidden');
    if (hwModalTitle) hwModalTitle.focus();
  }

  function openEditHw(aid) {
    const a = state.assignments.find(x => x.id === aid);
    if (!a) return;
    state.editingAssignmentId = aid;
    if (hwModalTitleLabel) hwModalTitleLabel.textContent = '编辑作业';
    updateHwSubjectSelect();
    if (hwModalSubject) hwModalSubject.value = a.subject;
    if (hwModalTitle) hwModalTitle.value = a.title;
    if (hwModalDate) hwModalDate.value = a.date;
    hwModal.classList.remove('hidden');
    if (hwModalTitle) hwModalTitle.focus();
  }

  function confirmHw() {
    if (!hwModal || !hwModalTitle || !hwModalSubject || !hwModalDate) return;
    const subject = hwModalSubject.value;
    if (!subject) { alert('请选择学科'); return; }
    const title = hwModalTitle.value.trim();
    if (!title) { hwModalTitle.focus(); return; }
    const date = hwModalDate.value || new Date().toISOString().slice(0, 10);

    const isEdit = !!state.editingAssignmentId;
    if (isEdit) {
      const a = state.assignments.find(x => x.id === state.editingAssignmentId);
      if (a) { a.subject = subject; a.title = title; a.date = date; }
    } else {
      const subs = {};
      state.students.forEach(s => { subs[s.id] = '未提交'; });
      state.assignments.push({ id: genId(), subject, title, date, submissions: subs });
    }

    const savedId = state.editingAssignmentId;
    state.editingAssignmentId = null;
    hwModal.classList.add('hidden');

    // 通过 WS 同步
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      const a = isEdit
        ? state.assignments.find(x => x.id === savedId)
        : state.assignments[state.assignments.length - 1];
      if (a) {
        state.ws.send(JSON.stringify({
          type: 'update-assignments',
          action: isEdit ? 'edit' : 'add',
          assignment: a,
        }));
      }
    }

    selectedAssigns = selectedAssigns.filter(id => id !== aid);
    if (selectedAssigns.length === 1) renderSingleAssignment(selectedAssigns[0]);
    else renderHomeworkList(null);
  }

  function deleteHw(aid) {
    const a = state.assignments.find(x => x.id === aid);
    if (!a) return;
    if (!confirm(`确定删除作业「${a.title}」吗？`)) return;
    state.assignments = state.assignments.filter(x => x.id !== aid);
    selectedAssigns = selectedAssigns.filter(id => id !== aid);
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'update-assignments', action: 'delete', assignment: { id: aid } }));
    }
    if (selectedAssigns.length === 1) renderSingleAssignment(selectedAssigns[0]);
    else renderHomeworkList(null);
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

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        state.searchQuery = searchInput.value.trim().toLowerCase();
        renderStudents();
      });
    }

    initEditor();

    // Tab 切换
    mainTabBtns.forEach(btn => btn.addEventListener('click', () => switchMainTab(btn.dataset.tab)));

    // 多选组件初始化
    initMultiSelects();

    // 状态筛选
    if (hwStatusFilter) hwStatusFilter.addEventListener('change', () => {
      if (selectedAssigns.length === 1) renderSingleAssignment(selectedAssigns[0]);
      else renderHomeworkList(null);
    });

    // 日期筛选
    const onDateChange = () => {
      buildAssignDrop(); updateAssignBtn();
      if (selectedAssigns.length === 1) renderSingleAssignment(selectedAssigns[0]);
      else renderHomeworkList(null);
    };
    if (hwDateFrom) hwDateFrom.addEventListener('change', onDateChange);
    if (hwDateTo)   hwDateTo.addEventListener('change', onDateChange);

    // 学科按钮
    if (addSubjectBtn)       addSubjectBtn.addEventListener('click', openAddSubject);
    if (delSubjectBtn)       delSubjectBtn.addEventListener('click', deleteCurrentSubject);
    if (addAssignmentBtn2)   addAssignmentBtn2.addEventListener('click', () => openAddHw());

    // 学科弹窗
    if (hwSubjectModalCancel)  hwSubjectModalCancel.addEventListener('click', () => hwSubjectModal && hwSubjectModal.classList.add('hidden'));
    if (hwSubjectModalConfirm) hwSubjectModalConfirm.addEventListener('click', confirmAddSubject);
    if (hwSubjectName) {
      hwSubjectName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmAddSubject();
        if (e.key === 'Escape') hwSubjectModal && hwSubjectModal.classList.add('hidden');
      });
    }
    if (hwSubjectModal) {
      hwSubjectModal.addEventListener('click', (e) => {
        if (e.target === hwSubjectModal) hwSubjectModal.classList.add('hidden');
      });
    }

    // 作业弹窗
    if (hwModalCancel)  hwModalCancel.addEventListener('click', () => hwModal && hwModal.classList.add('hidden'));
    if (hwModalConfirm) hwModalConfirm.addEventListener('click', confirmHw);
    if (hwModalTitle) {
      hwModalTitle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmHw();
        if (e.key === 'Escape') hwModal && hwModal.classList.add('hidden');
      });
    }
    if (hwModal) {
      hwModal.addEventListener('click', (e) => {
        if (e.target === hwModal) hwModal.classList.add('hidden');
      });
    }
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
    searchInput    = document.getElementById('searchInput');
    searchRow      = document.getElementById('searchRow');
    searchResult   = document.getElementById('searchResult');
    historyTbody   = document.querySelector('#historyTable tbody');
    noHistory      = document.getElementById('noHistory');

    // Tab
    mainTabs      = document.getElementById('mainTabs');
    mainTabBtns   = document.querySelectorAll('.main-tab');
    mainTabContents = document.querySelectorAll('.main-tab-content');

    // 作业管理 DOM
    hwSection            = document.getElementById('hwSection');
    // 多选
    hwSubjectMs    = document.getElementById('hwSubjectMs');
    hwSubjectBtn   = document.getElementById('hwSubjectBtn');
    hwSubjectDrop  = document.getElementById('hwSubjectDrop');
    hwAssignMs     = document.getElementById('hwAssignMs');
    hwAssignBtn    = document.getElementById('hwAssignBtn');
    hwAssignDrop   = document.getElementById('hwAssignDrop');

    addSubjectBtn        = document.getElementById('addSubjectBtn');
    delSubjectBtn        = document.getElementById('delSubjectBtn');
    hwStatusFilter       = document.getElementById('hwStatusFilter');
    hwDateFrom           = document.getElementById('hwDateFrom');
    hwDateTo             = document.getElementById('hwDateTo');
    addAssignmentBtn2    = document.getElementById('addAssignmentBtn2');
    hwContent            = document.getElementById('hwContent');
    hwSubjectModal        = document.getElementById('hwSubjectModal');
    hwSubjectName         = document.getElementById('hwSubjectName');
    hwSubjectModalCancel  = document.getElementById('hwSubjectModalCancel');
    hwSubjectModalConfirm = document.getElementById('hwSubjectModalConfirm');
    hwModal               = document.getElementById('hwModal');
    hwModalTitleLabel     = document.getElementById('hwModalTitleLabel');
    hwModalSubject        = document.getElementById('hwModalSubject');
    hwModalTitle          = document.getElementById('hwModalTitle');
    hwModalDate           = document.getElementById('hwModalDate');
    hwModalCancel         = document.getElementById('hwModalCancel');
    hwModalConfirm        = document.getElementById('hwModalConfirm');

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
