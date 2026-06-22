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
  // 批量呼叫
  let batchBar, batchCount, batchSelectAll, batchClear, batchCallBtn;

  // ── 状态 ──
  const state = {
    rooms:        [],       // { ip, name (from sync), password? }
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
    account:      null,       // { name, role, subjects, connectionId }
    teacherStatus: null,      // 'approved' | 'pending' | null
    selectedStudents: new Set(),
  };
  const MAX_HISTORY = 500;

  // ═══════════════════════════════════
  //  持久化
  // ═══════════════════════════════════

  async function loadFromDisk() {
    if (!api.getData) return { rooms: [], callHistory: [], account: null };
    try {
      const d = await api.getData();
      return { account: d.account || null, rooms: d.rooms || [], callHistory: d.callHistory || [] };
    } catch (e) { return { rooms: [], callHistory: [], account: null }; }
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
  //  账户管理
  // ═══════════════════════════════════

  // DOM refs for account overlay
  let accountOverlay, accountTitle, loginForm, registerForm;
  let loginName, loginPassword, loginError, loginBtn;
  let regName, regPassword, regPassword2, regRole, regSubjectsGroup, regSubjects, regError, regBtn;
  let showRegister, showLogin;
  let teacherInfo, joinOverlay, joinDesc, joinRequestView, joinWaitingView;

  function showAccountOverlay(mode) {
    if (accountOverlay) accountOverlay.classList.remove('hidden');
    if (loginForm) loginForm.classList.toggle('hidden', mode !== 'login');
    if (registerForm) registerForm.classList.toggle('hidden', mode !== 'register');
    if (accountTitle) accountTitle.textContent = mode === 'login' ? '欢迎回来' : '创建教师账户';
    var desc = document.getElementById('accountDesc');
    if (desc) desc.textContent = mode === 'login' ? '登录以同步你的教学数据' : '注册后即可连接教室并使用全部功能';
    if (mode === 'login' && loginName) loginName.focus();
    if (mode === 'register' && regName) regName.focus();
  }

  function hideAccountOverlay() {
    if (accountOverlay) accountOverlay.classList.add('hidden');
  }

  async function handleRegister() {
    var name = regName ? regName.value.trim() : '';
    var pwd  = regPassword ? regPassword.value : '';
    var pwd2 = regPassword2 ? regPassword2.value : '';
    var subjStr = regSubjects ? regSubjects.value.trim() : '';

    if (!name) { showAcctError('regError', '请输入教师姓名'); return; }
    if (!pwd || pwd.length < 3) { showAcctError('regError', '密码至少3位'); return; }
    if (pwd !== pwd2) { showAcctError('regError', '两次输入的密码不一致'); return; }

    var subjects = subjStr.split(/[,，]+/).map(function (s) { return s.trim(); }).filter(Boolean);

    var account = {
      name: name, password: pwd, subjects: subjects,
      connectionId: genId(),
    };

    if (api.saveAccount) {
      await api.saveAccount(account);
      console.log('[account] saved:', account.name, account.connectionId);
    }
    state.account = { name: account.name, subjects: account.subjects, connectionId: account.connectionId };
    hideAccountOverlay();
    updateTeacherInfo();
  }

  async function handleLogin() {
    var name = loginName ? loginName.value.trim() : '';
    var pwd  = loginPassword ? loginPassword.value : '';
    if (!name) { showAcctError('loginError', '请输入教师姓名'); return; }
    if (!pwd)  { showAcctError('loginError', '请输入密码'); return; }

    var data = await loadFromDisk();
    var acct = data.account;
    if (!acct || acct.name !== name || acct.password !== pwd) {
      showAcctError('loginError', '姓名或密码不正确');
      return;
    }
    state.account = { name: acct.name, role: acct.role, subjects: acct.subjects || [], connectionId: acct.connectionId };
    hideAccountOverlay();
    updateTeacherInfo();
  }

  function showAcctError(id, msg) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  // ═══════════════════════════════
  //  加入教室流程
  // ═══════════════════════════════

  function showJoinOverlay(mode, className) {
    if (joinOverlay) joinOverlay.classList.remove('hidden');
    if (joinDesc) joinDesc.textContent = '教室：' + (className || '未知');
    if (joinRequestView) joinRequestView.classList.toggle('hidden', mode !== 'request');
    if (joinWaitingView) joinWaitingView.classList.toggle('hidden', mode !== 'waiting');
    // 确保主 UI 隐藏
    hideMainUI();
  }

  function hideJoinOverlay() {
    if (joinOverlay) joinOverlay.classList.add('hidden');
  }

  function hideMainUI() {
    if (mainTabs)   mainTabs.classList.add('hidden');
    if (roomHeader) roomHeader.classList.add('hidden');
    if (msgRow)     msgRow.classList.add('hidden');
    if (searchRow)  searchRow.classList.add('hidden');
    if (emptyState) emptyState.style.display = '';
  }

  function showMainUI() {
    if (mainTabs)   mainTabs.classList.remove('hidden');
    if (roomHeader) roomHeader.classList.remove('hidden');
    if (msgRow)     msgRow.classList.remove('hidden');
    if (searchRow)  searchRow.classList.remove('hidden');
    if (emptyState) emptyState.style.display = 'none';
  }

  function sendJoinRequest() {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    state.ws.send(JSON.stringify({ type: 'join-request' }));
    showJoinOverlay('waiting', state.className);
  }

  // ═══════════════════════════════
  //  账户管理
  // ═══════════════════════════════

  let acctModal, acctMgmtName, acctMgmtId, acctMgmtSubjects, acctMgmtExport;

  function openAcctModal() {
    console.log('[acct] openAcctModal, modal:', !!acctModal, 'account:', !!state.account);
    if (!acctModal || !state.account) return;
    if (acctMgmtName) acctMgmtName.textContent = state.account.name;
    if (acctMgmtId) acctMgmtId.textContent = state.account.connectionId;
    if (acctMgmtSubjects) acctMgmtSubjects.textContent = (state.account.subjects || []).join(', ') || '未设置';
    if (acctMgmtExport) acctMgmtExport.value = JSON.stringify({ connectionId: state.account.connectionId, name: state.account.name, subjects: state.account.subjects || [] });
    acctModal.classList.remove('hidden');
  }

  function closeAcctModal() {
    if (acctModal) acctModal.classList.add('hidden');
  }

  async function handleLogout() {
    if (!confirm('确定退出登录吗？')) return;
    if (api.saveAccount) await api.saveAccount(null);
    state.account = null;
    state.teacherStatus = null;
    closeAcctModal();
    hideJoinOverlay();
    hideMainUI();
    if (teacherInfo) teacherInfo.innerHTML = '';
    var exp = document.getElementById('exportSection');
    if (exp) exp.classList.add('hidden');
    showAccountOverlay('login');
    disconnect();
  }

  async function handleDeleteAccount() {
    if (!confirm('确定删除账户吗？此操作不可撤销，所有本地数据将被清除。')) return;
    // 清空 data.json
    if (api.saveData) await api.saveData({ account: null, rooms: [], callHistory: [] });
    state.account = null;
    state.teacherStatus = null;
    state.rooms = [];
    state.callHistory = [];
    closeAcctModal();
    hideJoinOverlay();
    hideMainUI();
    if (teacherInfo) teacherInfo.innerHTML = '';
    var exp = document.getElementById('exportSection');
    if (exp) exp.classList.add('hidden');
    renderRooms();
    renderHistory();
    disconnect();
    showAccountOverlay('register');
  }

  function updateTeacherInfo() {
    if (!teacherInfo || !state.account) return;
    var acct = state.account;
    var t = state.teacherStatus;
    var roleStr = t && t.role ? ' · ' + esc(t.role) : '';
    teacherInfo.innerHTML = esc(acct.name) + roleStr;

    // 显示导出区域
    var exp = document.getElementById('exportSection');
    var expInput = document.getElementById('exportInfo');
    if (exp && expInput) {
      exp.classList.remove('hidden');
      expInput.value = JSON.stringify({ connectionId: acct.connectionId, name: acct.name, subjects: acct.subjects || [] });
    }
  }


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
      const acct = state.account || {};
      ws.send(JSON.stringify({
        type: 'connect',
        connectionId: acct.connectionId || '',
        name: acct.name || '',
        subjects: acct.subjects || [],
      }));
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

        // 教师身份（来自教室端）
        if (msg.teacher) {
          state.teacherStatus = msg.teacher;
          updateTeacherInfo();
        }

        // 自动添加到教室列表
        addOrUpdateRoom(ip, name);
        state.currentRoom = state.rooms.find(r => r.ip === ip) || null;
        renderRooms();

        // 待审核状态
        if (msg.teacher && msg.teacher.status === 'pending') {
          showJoinOverlay('request', name);
        } else {
          hideJoinOverlay();
          showRoomUI(name);
          renderStudents();
          renderHomework();
        }
      } else if (msg.type === 'join-ack') {
        // 教室端确认收到加入请求
        showJoinOverlay('waiting', state.className);
      } else if (msg.type === 'auth-required') {
        alert(msg.message || '操作被拒绝：权限不足');
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
    state.selectedStudents.clear();
    updateBatchBar();
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
      state.rooms.push({ ip, name });
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
  //  密码认证
  // ═══════════════════════════════════

  async function promptForPassword(ip) {
    const pwd = prompt(`教室「${state.className || ip}」需要管理密码才能修改数据：\n\n请输入管理密码（取消则仅查看）：`);
    if (pwd === null || pwd.trim() === '') return; // 取消 → 保持只读
    // 断开并重新连接，带上密码
    const room = state.rooms.find(r => r.ip === ip);
    if (room) room.password = pwd.trim();
    await saveToDisk();
    // 重新连接
    disconnect();
    setTimeout(() => connect(ip), 300);
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
    hideMainUI();
    hideJoinOverlay();
    if (roomTitle) roomTitle.textContent = '';
    state.teacherStatus = null;
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
      if (state.selectedStudents.has(s.id)) card.classList.add('selected');
      const initial = s.name.charAt(0);
      card.innerHTML = `<div class="stu-avatar">${esc(initial)}</div><div class="stu-name">${esc(s.name)}</div><div class="card-check">✓</div>`;

      // 点击卡片切换选中
      card.addEventListener('click', (e) => {
        // 不拦截按钮点击
        if (e.target.closest('.call-btn')) return;
        toggleSelect(s.id);
        renderStudents();
      });

      const btn = document.createElement('button');
      btn.className = 'call-btn';
      btn.textContent = '📢 呼叫';
      btn.addEventListener('click', () => callStudent(s, btn));
      card.appendChild(btn);
      studentGrid.appendChild(card);
    });

    updateBatchBar();
  }

  function toggleSelect(id) {
    if (state.selectedStudents.has(id)) {
      state.selectedStudents.delete(id);
    } else {
      state.selectedStudents.add(id);
    }
  }

  function updateBatchBar() {
    if (!batchBar) return;
    var count = state.selectedStudents.size;
    if (count > 0) {
      batchBar.classList.remove('hidden');
      if (batchCount) batchCount.textContent = '已选 ' + count + ' 人';
    } else {
      batchBar.classList.add('hidden');
    }
  }

  function selectAll() {
    var list = getFilteredStudentList();
    list.forEach(function (s) { state.selectedStudents.add(s.id); });
    renderStudents();
  }

  function clearSelection() {
    state.selectedStudents.clear();
    renderStudents();
  }

  function getFilteredStudentList() {
    var q = state.searchQuery || '';
    return q ? state.students.filter(function (s) { return s.name.toLowerCase().includes(q); }) : state.students;
  }

  function batchCall() {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      alert('未连接到教室');
      return;
    }
    if (state.selectedStudents.size === 0) return;

    // 收集选中学生姓名
    var names = [];
    state.selectedStudents.forEach(function (sid) {
      var student = state.students.find(function (s) { return s.id === sid; });
      if (student) names.push(student.name);
    });
    if (names.length === 0) return;

    var joinedNames = names.join('、');
    var rawMsg = (callMessageInp && callMessageInp.value.trim()) || '{name}同学，请到办公室';
    var msg = rawMsg.replace(/\{name\}/g, joinedNames);

    var callId = genId();
    state.ws.send(JSON.stringify({
      type: 'call', callId: callId,
      studentName: joinedNames,
      className: state.className,
      message: msg,
    }));

    state.callHistory.unshift({
      id: callId,
      roomName: state.className || (state.currentRoom ? state.currentRoom.ip : ''),
      studentName: joinedNames,
      time: new Date().toISOString(),
      status: 'sent',
    });

    if (state.callHistory.length > MAX_HISTORY) state.callHistory.length = MAX_HISTORY;
    renderHistory();
    saveToDisk();

    // 视觉反馈
    var cards = studentGrid.querySelectorAll('.student-card.selected');
    cards.forEach(function (c) { c.classList.add('card-called'); });
    setTimeout(function () {
      cards.forEach(function (c) { c.classList.remove('card-called'); });
    }, 2000);

    clearSelection();
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
    const card = btnEl.closest('.student-card');
    if (card) card.classList.add('card-called');
    clearTimeout(state.callTimers[student.name]);
    state.callTimers[student.name] = setTimeout(() => {
      btnEl.classList.remove('called');
      btnEl.textContent = '📢 呼叫';
      if (card) card.classList.remove('card-called');
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

  function getTeacherSubjects() {
    var t = state.teacherStatus;
    if (!t || t.role === '班主任') return state.subjects;
    return state.subjects.filter(function (s) { return (t.subjects || []).indexOf(s) !== -1; });
  }

  function buildSubjectDrop() {
    if (!hwSubjectDrop) return;
    let html = '';
    var subs = getTeacherSubjects();
    subs.forEach(sub => {
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
        if (b.dataset.msAction === 'all') selectedSubjects = [...getTeacherSubjects()];
        else selectedSubjects = [];
        buildSubjectDrop(); updateSubjectBtn(); applyFilters();
      });
    });
  }

  function updateSubjectBtn() {
    if (!hwSubjectBtn) return;
    var teacherSubs = getTeacherSubjects();
    if (selectedSubjects.length === 0 || selectedSubjects.length === teacherSubs.length) {
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

    // 授课教师只能看到自己学科的作业
    var t = state.teacherStatus;
    if (t && t.role !== '班主任' && (t.subjects || []).length > 0) {
      hws = hws.filter(function (a) { return t.subjects.indexOf(a.subject) !== -1; });
    }

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

    // 授课教师：隐藏学科筛选 + 学科管理按钮（角色来自教室端 sync）
    var t = state.teacherStatus;
    var isHR = !t || t.role === '班主任';
    if (hwSubjectMs)     hwSubjectMs.style.display     = isHR ? '' : 'none';
    if (addSubjectBtn)   addSubjectBtn.style.display   = isHR ? '' : 'none';
    if (delSubjectBtn)   delSubjectBtn.style.display   = isHR ? '' : 'none';

    if (isHR) {
      buildSubjectDrop();
      updateSubjectBtn();
    }
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
    var subs = getTeacherSubjects();
    if (subs.length === 0) {
      hwModalSubject.innerHTML = '<option value="">-- 请先添加学科 --</option>';
      return;
    }
    subs.forEach(sub => {
      const opt = document.createElement('option');
      opt.value = sub; opt.textContent = sub;
      hwModalSubject.appendChild(opt);
    });
  }

  function getFilteredAssignments(subject) {
    let hws = state.assignments;

    // 授课教师只能看到自己学科的作业
    var t = state.teacherStatus;
    if (t && t.role !== '班主任' && (t.subjects || []).length > 0) {
      hws = hws.filter(function (a) { return t.subjects.indexOf(a.subject) !== -1; });
    }

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
    var assignments = getFilteredAssignments(null);  // 授课教师只看自己学科的
    assignments.forEach(a => {
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

  // 基于时间戳的唯一 ID：毫秒时间戳(36进制) + 4位随机数
  function genId() {
    return Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);
  }
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

    // 账户事件
    if (showRegister) showRegister.addEventListener('click', function (e) { e.preventDefault(); showAccountOverlay('register'); });
    if (showLogin)    showLogin.addEventListener('click',    function (e) { e.preventDefault(); showAccountOverlay('login'); });
    if (regBtn) regBtn.addEventListener('click', handleRegister);
    if (loginBtn) loginBtn.addEventListener('click', handleLogin);
    // Enter 键登录/注册
    if (loginPassword) loginPassword.addEventListener('keydown', function (e) { if (e.key === 'Enter') handleLogin(); });
    if (regPassword2)  regPassword2.addEventListener('keydown',  function (e) { if (e.key === 'Enter') handleRegister(); });
    // 导出复制
    var copyBtn = document.getElementById('copyExportBtn');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      var inp = document.getElementById('exportInfo');
      if (inp) { inp.select(); document.execCommand('copy'); }
    });
    // 加入教室
    // ── 批量呼叫 ──
    if (batchSelectAll) batchSelectAll.addEventListener('click', selectAll);
    if (batchClear)     batchClear.addEventListener('click', clearSelection);
    if (batchCallBtn)   batchCallBtn.addEventListener('click', batchCall);

    var joinRequestBtn = document.getElementById('joinRequestBtn');
    if (joinRequestBtn) joinRequestBtn.addEventListener('click', sendJoinRequest);
    // 重新连接检查（共用）
    var reconnectBtns = document.querySelectorAll('#joinReconnectBtn, #joinCheckBtn');
    reconnectBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (state.currentRoom) {
          disconnect();
          setTimeout(function () { connect(state.currentRoom.ip); }, 300);
        }
      });
    });
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
    // 批量呼叫
    batchBar       = document.getElementById('batchBar');
    batchCount     = document.getElementById('batchCount');
    batchSelectAll = document.getElementById('batchSelectAll');
    batchClear     = document.getElementById('batchClear');
    batchCallBtn   = document.getElementById('batchCallBtn');
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

    // 账户
    accountOverlay   = document.getElementById('accountOverlay');
    accountTitle     = document.getElementById('accountTitle');
    loginForm        = document.getElementById('loginForm');
    registerForm     = document.getElementById('registerForm');
    loginName        = document.getElementById('loginName');
    loginPassword    = document.getElementById('loginPassword');
    loginError       = document.getElementById('loginError');
    loginBtn         = document.getElementById('loginBtn');
    regName          = document.getElementById('regName');
    regPassword      = document.getElementById('regPassword');
    regPassword2     = document.getElementById('regPassword2');
    regSubjects      = document.getElementById('regSubjects');
    regError         = document.getElementById('regError');
    regBtn           = document.getElementById('regBtn');
    showRegister     = document.getElementById('showRegister');
    showLogin        = document.getElementById('showLogin');
    teacherInfo      = document.getElementById('teacherInfo');
    joinOverlay      = document.getElementById('joinOverlay');
    joinDesc         = document.getElementById('joinDesc');
    joinRequestView  = document.getElementById('joinRequestView');
    joinWaitingView  = document.getElementById('joinWaitingView');

    // 账户管理
    acctModal        = document.getElementById('acctModal');
    acctMgmtName     = document.getElementById('acctMgmtName');
    acctMgmtId       = document.getElementById('acctMgmtId');
    acctMgmtSubjects = document.getElementById('acctMgmtSubjects');
    acctMgmtExport   = document.getElementById('acctMgmtExport');

    // 账户设置按钮（直接绑定，不走 bindEvents）
    var gearBtn = document.getElementById('acctGearBtn');
    if (gearBtn) { gearBtn.onclick = openAcctModal; }
    if (acctModal) { acctModal.addEventListener('click', function (e) { if (e.target === acctModal) closeAcctModal(); }); }
    var acctClose = document.getElementById('acctMgmtClose');
    if (acctClose) { acctClose.onclick = closeAcctModal; }
    var acctLogout = document.getElementById('acctMgmtLogout');
    if (acctLogout) { acctLogout.onclick = handleLogout; }
    var acctDelete = document.getElementById('acctMgmtDelete');
    if (acctDelete) { acctDelete.onclick = handleDeleteAccount; }
    var acctCopy = document.getElementById('acctMgmtCopy');
    if (acctCopy) { acctCopy.onclick = function () { if (acctMgmtExport) { acctMgmtExport.select(); document.execCommand('copy'); } }; }

    bindEvents();
    loadFromDisk().then(data => {
      state.rooms       = data.rooms;
      state.callHistory = data.callHistory;
      // 账户检查：有账户直接进入，无账户显示注册
      if (data.account && data.account.connectionId) {
        state.account = { name: data.account.name, subjects: data.account.subjects || [], connectionId: data.account.connectionId };
        updateTeacherInfo();
        // 账号已存在 → 直接进入主页，无需登录
        hideAccountOverlay();
      } else {
        showAccountOverlay('register');
      }
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
