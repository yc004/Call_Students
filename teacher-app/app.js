/* ══════════════════════════════════════════
   教师端 — 登录与连接流程
   本地账户登录 → 输入教室 IP → 管理员审核 → 同步教室数据
   ══════════════════════════════════════════ */

(function () {
  'use strict';

  const api = window.api || {};

  // ── DOM ──
  let ipInput, connectBtn, roomList, noRooms, connDot, connLabel;
  let roomHeader, roomTitle, studentCount, msgRow, callMessageInp, callFlow;
  let studentGrid, emptyState, historyTbody, noHistory;
  let searchInput, searchRow, searchResult;
  let msgEditor;
  let mainTabs, mainTabBtns, mainTabContents;
  let hwSection;
  let hwStatusFilter, hwDateFrom, hwDateTo, addAssignmentBtn2;
  // 多选
  let hwSubjectMs, hwSubjectBtn, hwSubjectDrop, selectedSubjects = [];
  let hwAssignMs, hwAssignBtn, hwAssignDrop, selectedAssigns = [];
  let hwContent;
  let hwModal, hwModalTitleLabel, hwModalSubject, hwModalTitle, hwModalDate, hwModalDeadline, hwModalCancel, hwModalConfirm;
  // 人脸识别 DOM
  let faceSection, faceRoomName, faceSummary;
  let faceGridUnknown, faceGridRegistered;
  let faceSubtabActive = 'unknown'; // 当前活跃的子标签
  // 标注弹窗 DOM
  let labelModal, labelPreview, labelStudentSelect, labelNewName;
  let labelCancel, labelConfirm;
  // 账户与审批 DOM
  let accountOverlay, accountTitle, accountDesc, loginForm, registerForm, keyLoginForm;
  let loginName, loginPassword, loginError, regName, regSubjects, regPassword, regPassword2, regError;
  let loginKeyInput, keyLoginError, generatedLoginKey, loginKeyResult, loginKeyStatus;
  let teacherInfo, accountMenuBtn, accountModal, approvalOverlay, approvalDesc;
  let classroomTabBtn, manageClassName, manageStudents, saveClassroomBtn;
  let classroomSetupOverlay, setupClassName, setupStudents, setupError, completeSetupBtn;
  let pendingTeacherList, approvedTeacherList, pendingTeacherCount, approvedTeacherCount, refreshTeachersBtn;
  let teacherEditModal, teacherEditName, teacherEditSubjects, teacherEditCancel, teacherEditSave;
  let editingTeacherId = '';

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
    studentStatus: [],  // [{ studentId, name, status, lastSeen, similarity }]
    faceDetections: [], // 当前检测到的人脸 [{ faceId, cropBase64, descriptor, studentId, name, similarity, isRecognized }]
    pendingFaces: [],   // 教室端持久化的待标注人脸库，仅班主任可匹配姓名
    pendingLabelFace: null, // 待标注的人脸 { faceId, descriptor }
    account: null,      // 登录后才存在：{ name, subjects, connectionId }
    teacherStatus: null,
    classroomConfigured: false,
    teachers: { approved: [], pending: [] },
    pendingRoomIp: '',
  };
  const MAX_HISTORY = 500;

  // ═══════════════════════════════════
  //  持久化
  // ═══════════════════════════════════

  async function loadFromDisk() {
    if (!api.getData) return { rooms: [], callHistory: [], account: null };
    try {
      const d = await api.getData();
      return { rooms: d.rooms || [], callHistory: d.callHistory || [], account: d.account || null };
    } catch (e) { return { rooms: [], callHistory: [], account: null }; }
  }

  // ═══════════════════════════════════
  //  账户
  // ═══════════════════════════════════

  function showAccountOverlay(mode, account) {
    if (!accountOverlay) return;
    accountOverlay.classList.remove('hidden');
    accountOverlay.classList.toggle('register-mode', mode === 'register');
    document.body.classList.add('account-locked');
    const appRoot = document.querySelector('.app');
    if (appRoot) appRoot.setAttribute('inert', '');
    const isLogin = mode === 'login';
    const isRegister = mode === 'register';
    const isKeyLogin = mode === 'key';
    loginForm && loginForm.classList.toggle('hidden', !isLogin);
    registerForm && registerForm.classList.toggle('hidden', !isRegister);
    keyLoginForm && keyLoginForm.classList.toggle('hidden', !isKeyLogin);
    if (accountTitle) accountTitle.textContent = isLogin ? '教师登录' : (isRegister ? '创建教师账户' : '使用登录密钥');
    if (accountDesc) {
      accountDesc.textContent = isLogin
        ? '登录后才能连接教室和使用教学功能。'
        : (isRegister
          ? '账户保存在这台教师电脑上，创建后需由教室管理员批准。'
          : '粘贴从原教师端生成的密钥，恢复同一个教师身份。');
    }
    clearAccountErrors();
    if (isLogin && loginName) {
      loginName.value = account && account.name ? account.name : loginName.value;
      setTimeout(() => (loginPassword || loginName).focus(), 0);
    } else if (isRegister && regName) {
      setTimeout(() => regName.focus(), 0);
    } else if (isKeyLogin && loginKeyInput) {
      setTimeout(() => loginKeyInput.focus(), 0);
    }
  }

  function hideAccountOverlay() {
    accountOverlay && accountOverlay.classList.add('hidden');
    document.body.classList.remove('account-locked');
    const appRoot = document.querySelector('.app');
    if (appRoot) appRoot.removeAttribute('inert');
  }

  function clearAccountErrors() {
    [loginError, regError, keyLoginError].forEach(el => {
      if (!el) return;
      el.textContent = '';
      el.classList.add('hidden');
    });
  }

  function showAccountError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function setSignedInAccount(account) {
    state.account = account;
    if (teacherInfo) teacherInfo.textContent = account.name;
    const avatarText = (account.name || '教').trim().slice(0, 1);
    const sidebarAvatar = document.getElementById('accountAvatar');
    const modalAvatar = document.getElementById('accountModalAvatar');
    if (sidebarAvatar) sidebarAvatar.textContent = avatarText;
    if (modalAvatar) modalAvatar.textContent = avatarText;
    accountMenuBtn && accountMenuBtn.classList.remove('hidden');
    hideAccountOverlay();
  }

  async function handleLogin(event) {
    event && event.preventDefault();
    const name = loginName ? loginName.value.trim() : '';
    const password = loginPassword ? loginPassword.value : '';
    clearAccountErrors();
    if (!name || !password) {
      showAccountError(loginError, '请输入教师姓名和密码');
      return;
    }
    if (!api.loginAccount) {
      showAccountError(loginError, '请在教师端应用中登录');
      return;
    }
    let result;
    try {
      result = await api.loginAccount(name, password);
    } catch (error) {
      showAccountError(loginError, '登录服务暂时不可用，请重试');
      return;
    }
    if (!result || !result.ok) {
      showAccountError(loginError, result && result.message ? result.message : '登录失败');
      loginPassword && loginPassword.select();
      return;
    }
    if (loginPassword) loginPassword.value = '';
    setSignedInAccount(result.account);
  }

  async function handleRegister(event) {
    event && event.preventDefault();
    const name = regName ? regName.value.trim() : '';
    const password = regPassword ? regPassword.value : '';
    const password2 = regPassword2 ? regPassword2.value : '';
    const subjects = (regSubjects ? regSubjects.value : '')
      .split(/[,，]+/).map(value => value.trim()).filter(Boolean);
    clearAccountErrors();
    if (!name) { showAccountError(regError, '请输入教师姓名'); return; }
    if (password.length < 6) { showAccountError(regError, '密码至少需要 6 位'); return; }
    if (password !== password2) { showAccountError(regError, '两次输入的密码不一致'); return; }
    if (!api.registerAccount) { showAccountError(regError, '请在教师端应用中创建账户'); return; }
    let result;
    try {
      result = await api.registerAccount({ name, password, subjects });
    } catch (error) {
      showAccountError(regError, '账户创建失败，请重试');
      return;
    }
    if (!result || !result.ok) {
      showAccountError(regError, result && result.message ? result.message : '创建账户失败');
      return;
    }
    if (regPassword) regPassword.value = '';
    if (regPassword2) regPassword2.value = '';
    setSignedInAccount(result.account);
  }

  async function handleKeyLogin(event) {
    event && event.preventDefault();
    const loginKey = loginKeyInput ? loginKeyInput.value.trim() : '';
    clearAccountErrors();
    if (!loginKey) { showAccountError(keyLoginError, '请粘贴完整的登录密钥'); return; }
    if (!api.importLoginKey) { showAccountError(keyLoginError, '请在教师端应用中使用登录密钥'); return; }

    let result;
    try {
      result = await api.importLoginKey(loginKey, false);
      if (result && result.needsReplace) {
        const shouldReplace = confirm(`${result.message}\n\n替换只会更改本机教师账户，不会删除教室列表和呼叫记录。是否继续？`);
        if (!shouldReplace) return;
        result = await api.importLoginKey(loginKey, true);
      }
    } catch (_error) {
      showAccountError(keyLoginError, '密钥登录服务暂时不可用，请重试');
      return;
    }
    if (!result || !result.ok) {
      showAccountError(keyLoginError, result && result.message ? result.message : '登录密钥无效');
      return;
    }
    if (loginKeyInput) loginKeyInput.value = '';
    setSignedInAccount(result.account);
  }

  async function handleGenerateLoginKey() {
    if (!api.generateLoginKey) return;
    const button = document.getElementById('generateLoginKeyBtn');
    if (button) { button.disabled = true; button.textContent = '生成中…'; }
    try {
      const result = await api.generateLoginKey();
      if (!result || !result.ok) {
        alert(result && result.message ? result.message : '登录密钥生成失败');
        return;
      }
      if (generatedLoginKey) generatedLoginKey.value = result.loginKey;
      if (loginKeyStatus) loginKeyStatus.textContent = '密钥等同于登录凭证，请勿发送给他人。';
      loginKeyResult && loginKeyResult.classList.remove('hidden');
    } catch (_error) {
      alert('登录密钥生成失败，请重试');
    } finally {
      if (button) { button.disabled = false; button.textContent = '重新生成'; }
    }
  }

  async function handleCopyLoginKey() {
    const value = generatedLoginKey ? generatedLoginKey.value : '';
    if (!value) return;
    let copied = false;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch (_error) {
      generatedLoginKey.focus();
      generatedLoginKey.select();
      copied = document.execCommand('copy');
    }
    if (loginKeyStatus) loginKeyStatus.textContent = copied ? '已复制，可在其他教师端直接粘贴登录。' : '复制失败，请手动选择并复制。';
  }

  async function handleGenerateMiniProgramQr() {
    if (!api.generateMiniProgramQr) return;
    const button = document.getElementById('generateMiniProgramQrBtn');
    const resultBox = document.getElementById('miniProgramQrResult');
    const image = document.getElementById('miniProgramQrImage');
    const hint = document.getElementById('miniProgramQrHint');
    if (button) { button.disabled = true; button.textContent = '生成中…'; }
    try {
      const result = await api.generateMiniProgramQr();
      if (!result || !result.ok) { alert(result && result.message ? result.message : '二维码生成失败'); return; }
      if (image) image.src = result.qrDataUrl;
      if (hint) hint.textContent = result.roomCount
        ? `二维码包含当前账户和 ${result.roomCount} 个已保存教室。请勿拍照转发给他人。`
        : '当前还没有已保存教室；扫码后可在小程序中手动添加教室 IP。请勿转发二维码。';
      resultBox && resultBox.classList.remove('hidden');
      if (button) button.textContent = '刷新二维码';
    } catch (_error) {
      alert('二维码生成失败，请重试');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function openAccountModal() {
    if (!state.account || !accountModal) return;
    const name = document.getElementById('accountModalName');
    const subjects = document.getElementById('accountModalSubjects');
    const connectionId = document.getElementById('accountConnectionId');
    if (name) name.textContent = state.account.name;
    if (subjects) subjects.textContent = (state.account.subjects || []).join('、') || '未填写授课科目';
    if (connectionId) connectionId.textContent = state.account.connectionId;
    if (generatedLoginKey) generatedLoginKey.value = '';
    if (loginKeyStatus) loginKeyStatus.textContent = '密钥等同于登录凭证，请勿发送给他人。';
    loginKeyResult && loginKeyResult.classList.add('hidden');
    document.getElementById('miniProgramQrResult')?.classList.add('hidden');
    const generateButton = document.getElementById('generateLoginKeyBtn');
    if (generateButton) generateButton.textContent = '生成密钥';
    accountModal.classList.remove('hidden');
  }

  function handleLogout() {
    disconnect();
    hideApprovalOverlay();
    accountModal && accountModal.classList.add('hidden');
    const savedAccount = state.account;
    state.account = null;
    state.teacherStatus = null;
    accountMenuBtn && accountMenuBtn.classList.add('hidden');
    showAccountOverlay('login', savedAccount);
  }

  function showApprovalOverlay(className, message) {
    if (approvalDesc) {
      approvalDesc.textContent = message || `${className || '该教室'}的管理员批准后，即可使用学生、作业和出勤功能。`;
    }
    approvalOverlay && approvalOverlay.classList.remove('hidden');
    const appRoot = document.querySelector('.app');
    if (appRoot) appRoot.setAttribute('inert', '');
    hideRoomUI();
  }

  function hideApprovalOverlay() {
    approvalOverlay && approvalOverlay.classList.add('hidden');
    const appRoot = document.querySelector('.app');
    if (appRoot && (!accountOverlay || accountOverlay.classList.contains('hidden'))) appRoot.removeAttribute('inert');
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
    if (!state.account) {
      showAccountOverlay('login');
      return;
    }
    if (ipInput) ipInput.value = ip;

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
      setStatus('connecting', '正在同步…');
      ws.send(JSON.stringify({
        type: 'connect',
        connectionId: state.account.connectionId,
        name: state.account.name,
        subjects: state.account.subjects || [],
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
        state.studentStatus = msg.attendance || [];
        state.pendingFaces = msg.pendingFaces || [];
        state.classroomConfigured = msg.classroomConfigured !== false;
        state.teachers = msg.teachers || { approved: [], pending: [] };
        selectedSubjects = [];
        selectedAssigns  = [];
        state.teacherStatus = msg.teacher || null;
        state.pendingRoomIp = '';
        hideApprovalOverlay();

        // 自动添加到教室列表
        addOrUpdateRoom(ip, name);
        state.currentRoom = state.rooms.find(r => r.ip === ip) || null;
        renderRooms();
        applyTeacherPermissions();

        setStatus('online', '已连接');
        showRoomUI(name);
        renderStudents();
        renderHomework();
        renderFaceDetections();
        renderClassroomManagement();
        if (isHomeroomTeacher() && !state.classroomConfigured) showClassroomSetup();
        else hideClassroomSetup();
      } else if (msg.type === 'approval-required') {
        const name = msg.className || ip;
        state.teacherStatus = msg.teacher || { status: 'pending' };
        state.pendingRoomIp = ip;
        awaitRoomSave(ip, name);
        setStatus('connecting', '等待管理员审核');
        showApprovalOverlay(name, msg.message);
      } else if (msg.type === 'approval-rejected') {
        setStatus('offline', '审核未通过');
        showApprovalOverlay(msg.className || ip, msg.message || '管理员未批准此账户，请联系教室管理员。');
      } else if (msg.type === 'login-required') {
        setStatus('offline', '身份无效');
        disconnect();
        showAccountOverlay('login', state.account);
        showAccountError(loginError, msg.message || '请重新登录');
      } else if (msg.type === 'auth-required') {
        if (classroomSetupOverlay && !classroomSetupOverlay.classList.contains('hidden')) {
          setupError.textContent = msg.message || '教室配置未保存，请检查后重试';
          setupError.classList.remove('hidden');
          completeSetupBtn.disabled = false;
          completeSetupBtn.textContent = '保存并启用教室';
        } else {
          alert(msg.message || '当前账户没有执行此操作的权限');
        }
      } else if (msg.type === 'face-detections') {
        // 诊断：记录接收次数和最近一次收到的脸数
        state._faceRecvCount = (state._faceRecvCount || 0) + 1;
        state._faceRecvLast = (msg.detections || []).length;
        state._faceRecvAt = Date.now();
        console.log('[teacher] face-detections received #' + state._faceRecvCount + ':', state._faceRecvLast, 'faces');
        // 教室端已用连续两帧空检测做过防抖；此处直接采用最新结果，
        // 避免教师端再次等待两次空消息而把离开提示拖慢数秒。
        state.faceDetections = msg.detections || [];
        renderFaceDetections();
      } else if (msg.type === 'face-labeled') {
        // 标注结果：更新对应人脸并标记为手动标注
        const f = state.faceDetections.find(d => d.faceId === msg.faceId);
        if (f) {
          f.studentId = msg.studentId;
          f.name = msg.name;
          f.isRecognized = true;
          f._manuallyLabeled = true;
        }
        state.pendingFaces = (state.pendingFaces || []).filter(face => face.faceId !== msg.faceId);
        renderFaceDetections();
      } else if (msg.type === 'pending-face-library') {
        state.pendingFaces = msg.faces || [];
        renderFaceDetections();
      } else if (msg.type === 'face-status') {
        state.studentStatus = msg.attendance || [];
        // keep old attendance rendering if needed
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

  async function awaitRoomSave(ip, name) {
    await addOrUpdateRoom(ip, name);
    state.currentRoom = state.rooms.find(room => room.ip === ip) || null;
    renderRooms();
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
    state.classroomConfigured = false;
    state.teachers = { approved: [], pending: [] };
    state.pendingRoomIp = '';
    state.searchQuery = '';
    if (searchInput) searchInput.value = '';
    hideClassroomSetup();
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
    if (callFlow)   callFlow.classList.remove('hidden');
    if (emptyState) emptyState.style.display = 'none';
    if (roomTitle)  roomTitle.textContent = name;
  }

  function isHomeroomTeacher() { return !!(state.teacherStatus && state.teacherStatus.role === '班主任'); }
  function canModifySubject(subject) { return isHomeroomTeacher() || !!(state.teacherStatus && (state.teacherStatus.subjects || []).includes(subject)); }

  function applyTeacherPermissions() {
    const homeroom = isHomeroomTeacher();
    if (classroomTabBtn) classroomTabBtn.classList.toggle('hidden', !homeroom);
    if (!homeroom && document.querySelector('.main-tab.active')?.dataset.tab === 'classroom') switchMainTab('call');
  }

  function buildStudentsFromText(value) {
    const names = String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    if (new Set(names).size !== names.length) return { error: '学生名单中有重复姓名，请整理后再保存' };
    const existingByName = new Map((state.students || []).map(student => [student.name, student]));
    return {
      students: names.map((name, index) => ({
        id: (existingByName.get(name) || {}).id || ('s' + Date.now().toString(36) + index),
        name,
      })),
    };
  }

  function submitClassroomConfig(nameInput, studentsInput, forced) {
    if (!isHomeroomTeacher()) return;
    const className = nameInput.value.trim();
    const parsed = buildStudentsFromText(studentsInput.value);
    const showError = message => {
      if (forced && setupError) { setupError.textContent = message; setupError.classList.remove('hidden'); }
      else alert(message);
    };
    if (!className) { showError('请输入班级名称'); nameInput.focus(); return; }
    if (parsed.error) { showError(parsed.error); return; }
    if (!parsed.students.length) { showError('请至少添加一名学生'); studentsInput.focus(); return; }
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) { showError('教室连接已断开，请重新连接后再保存'); return; }
    if (setupError) setupError.classList.add('hidden');
    state.ws.send(JSON.stringify({ type: 'update-classroom', classroom: { className, students: parsed.students } }));
    if (forced && completeSetupBtn) { completeSetupBtn.disabled = true; completeSetupBtn.textContent = '正在启用…'; }
  }

  function showClassroomSetup() {
    if (!classroomSetupOverlay) return;
    if (setupClassName && !setupClassName.value) setupClassName.value = state.className || '';
    if (setupStudents && !setupStudents.value) setupStudents.value = (state.students || []).map(student => student.name).join('\n');
    classroomSetupOverlay.classList.remove('hidden');
    document.querySelector('.app')?.setAttribute('inert', '');
    setTimeout(() => setupClassName && setupClassName.focus(), 0);
  }

  function hideClassroomSetup() {
    if (!classroomSetupOverlay) return;
    classroomSetupOverlay.classList.add('hidden');
    if (completeSetupBtn) { completeSetupBtn.disabled = false; completeSetupBtn.textContent = '保存并启用教室'; }
    const accountHidden = !accountOverlay || accountOverlay.classList.contains('hidden');
    const approvalHidden = !approvalOverlay || approvalOverlay.classList.contains('hidden');
    if (accountHidden && approvalHidden) document.querySelector('.app')?.removeAttribute('inert');
  }

  function renderClassroomManagement() {
    if (!isHomeroomTeacher()) return;
    if (manageClassName && document.activeElement !== manageClassName) manageClassName.value = state.className || '';
    if (manageStudents && document.activeElement !== manageStudents) manageStudents.value = (state.students || []).map(student => student.name).join('\n');
    renderTeacherManagement();
  }

  function teacherSubjectText(teacher) {
    return (teacher.subjects || []).join('、') || '未设置授课科目';
  }

  function renderTeacherManagement() {
    if (!pendingTeacherList || !approvedTeacherList) return;
    const pending = state.teachers.pending || [];
    const approved = state.teachers.approved || [];
    pendingTeacherCount.textContent = String(pending.length);
    approvedTeacherCount.textContent = String(approved.length);
    pendingTeacherList.innerHTML = pending.length ? pending.map(teacher => `
      <div class="teacher-manage-item">
        <div class="teacher-manage-main"><strong>${esc(teacher.name)}</strong><small>${esc(teacherSubjectText(teacher))} · ${esc(teacher.connection_id.slice(-8))}</small></div>
        <div class="teacher-manage-actions"><button class="btn btn-primary" data-teacher-action="approve" data-id="${esc(teacher.connection_id)}">批准加入</button><button class="btn btn-danger-text" data-teacher-action="reject" data-id="${esc(teacher.connection_id)}">拒绝</button></div>
      </div>`).join('') : '<div class="teacher-manage-empty">暂无等待审核的教师</div>';
    approvedTeacherList.innerHTML = approved.length ? approved.map(teacher => {
      const homeroom = teacher.role === '班主任';
      return `<div class="teacher-manage-item">
        <div class="teacher-manage-main"><div class="teacher-role-line"><strong>${esc(teacher.name)}</strong><span class="teacher-role-chip${homeroom ? ' homeroom' : ''}">${esc(teacher.role)}</span></div><small>${esc(teacherSubjectText(teacher))} · ${esc(teacher.connection_id.slice(-8))}</small></div>
        <div class="teacher-manage-actions">${homeroom ? `<button class="btn" data-teacher-action="edit" data-id="${esc(teacher.connection_id)}">设置科目</button>` : `<button class="btn" data-teacher-action="edit" data-id="${esc(teacher.connection_id)}">科目授权</button><button class="btn btn-danger-text" data-teacher-action="remove" data-id="${esc(teacher.connection_id)}">移除</button>`}</div>
      </div>`;
    }).join('') : '<div class="teacher-manage-empty">暂无已加入教师</div>';
  }

  function sendTeacherManagement(action, connectionId, subjects) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) { alert('教室连接已断开'); return; }
    state.ws.send(JSON.stringify({ type: 'manage-teacher', action, connectionId, subjects: subjects || [] }));
  }

  function hideRoomUI() {
    if (mainTabs)   mainTabs.classList.add('hidden');
    if (roomHeader) roomHeader.classList.add('hidden');
    if (msgRow)     msgRow.classList.add('hidden');
    if (searchRow)  searchRow.classList.add('hidden');
    if (callFlow)   callFlow.classList.add('hidden');
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
      btn.textContent = '呼叫';
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
      btnEl.textContent = '呼叫';
    }, 5000);
  }

  function updateCallStatus(callId, status) {
    const r = state.callHistory.find(x => x.id === callId);
    if (r) { r.status = status; renderHistory(); saveToDisk(); }
  }

  function renderFaceDetections() {
    const faceGridUnknown = document.getElementById('faceGridUnknown');
    const faceGridRegistered = document.getElementById('faceGridRegistered');
    const faceSummary = document.getElementById('faceSummary');
    const faceRoomName = document.getElementById('faceRoomName');
    const unknownCountEl = document.getElementById('unknownCount');
    const registeredCountEl = document.getElementById('registeredCount');

    if (!faceGridUnknown || !faceGridRegistered) return;

    const detections = state.faceDetections || [];
    const students = state.students || [];
    if (faceRoomName) faceRoomName.textContent = state.className ? state.className + ' — 人脸识别' : '人脸识别';

    // ── 诊断后缀 ──
    const recvAgo = state._faceRecvAt ? Math.round((Date.now() - state._faceRecvAt) / 1000) : -1;
    const diag = ` [收#${state._faceRecvCount || 0}/${recvAgo}s前]`;

    // ── 构建在场学生 ID 集合 ──
    const presentIds = new Set();
    for (const d of detections) {
      if (d.isRecognized && d.studentId) presentIds.add(d.studentId);
    }

    // ═══════════════════════════════════════
    //  1. 未标注人脸（未识别的检测结果）
    // ═══════════════════════════════════════
    const unknownCards = [];
    const studentIdSet = new Set(students.map(s => s.id)); // 学生名单 ID 集合

    for (const face of (state.pendingFaces || [])) {
      unknownCards.push({
        id: face.faceId,
        name: '待班主任匹配',
        status: 'unknown',
        cropBase64: face.cropBase64 || null,
        descriptor: face.descriptor,
        lastSeen: face.lastSeen,
      });
    }

    // ═══════════════════════════════════════
    //  2. 已入库学生（全部注册学生 + 已识别但不在名单中的图库人脸）
    // ═══════════════════════════════════════
    const registeredCards = [];
    const addedStudentIds = new Set(); // 跟踪已添加的学生，避免重复

    for (const s of students) {
      const isPresent = presentIds.has(s.id);
      const det = isPresent ? detections.find(d => d.studentId === s.id) : null;
      addedStudentIds.add(s.id);
      registeredCards.push({
        id: s.id,
        name: s.name,
        status: isPresent ? 'recognized' : 'absent',
        cropBase64: det ? det.cropBase64 : null,
        similarity: det ? det.similarity : 0,
        isPresent,
      });
    }

    // 已识别但不在学生名单中的人脸（纯图库注册，无学生记录）
    for (const d of detections) {
      if (d.isRecognized && d.studentId && !addedStudentIds.has(d.studentId)) {
        addedStudentIds.add(d.studentId);
        registeredCards.push({
          id: d.studentId,
          name: d.name || d.studentId,
          status: 'recognized',
          cropBase64: d.cropBase64 || null,
          similarity: d.similarity || 0,
          isPresent: true,
        });
      }
    }

    // 更新子标签计数
    if (unknownCountEl) unknownCountEl.textContent = unknownCards.length;
    if (registeredCountEl) registeredCountEl.textContent = registeredCards.length;

    // 更新摘要
    const presentCount = registeredCards.filter(c => c.isPresent).length;
    const totalRegistered = registeredCards.length;
    if (faceSummary) {
      if (totalRegistered > 0) {
        faceSummary.textContent = `${presentCount}/${totalRegistered} 已到${diag}`;
      } else if (unknownCards.length > 0) {
        faceSummary.textContent = `${unknownCards.length} 人待标注${diag}`;
      } else {
        faceSummary.textContent = `等待检测${diag}`;
      }
    }

    console.log('[teacher] rendered', unknownCards.length, 'unknown +', registeredCards.length, 'registered');

    // ═══════════════════════════════════════
    //  渲染「未标注」网格
    // ═══════════════════════════════════════
    if (unknownCards.length === 0) {
      faceGridUnknown.innerHTML = '<div class="muted-note">所有检测到的人脸均已标注入库</div>';
    } else {
      faceGridUnknown.innerHTML = unknownCards.map(c => {
        if (c.cropBase64) {
          return `<div class="face-card unknown" data-face-id="${c.id}">
            <img class="face-crop" src="${c.cropBase64}" alt="未识别">
            <div class="face-info">
              <span class="face-name unknown">待班主任匹配</span>
              ${state.teacherStatus && state.teacherStatus.role === '班主任' ? `<button class="face-label-btn" data-face-id="${c.id}">匹配姓名</button>` : '<span class="face-presence-badge absent">等待班主任处理</span>'}
            </div>
          </div>`;
        } else {
          return `<div class="face-card unknown" data-face-id="${c.id}">
            <div class="face-placeholder">❓</div>
            <div class="face-info">
              <span class="face-name unknown">待班主任匹配</span>
              ${state.teacherStatus && state.teacherStatus.role === '班主任' ? `<button class="face-label-btn" data-face-id="${c.id}">匹配姓名</button>` : '<span class="face-presence-badge absent">等待班主任处理</span>'}
            </div>
          </div>`;
        }
      }).join('');

      // 绑定标注按钮（仅未标注网格）
      faceGridUnknown.querySelectorAll('.face-label-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const faceId = btn.dataset.faceId;
          const face = (state.pendingFaces || []).find(f => f.faceId === faceId);
          if (face) openLabelModal(face);
        });
      });
    }

    // ═══════════════════════════════════════
    //  渲染「已入库」网格
    // ═══════════════════════════════════════
    if (registeredCards.length === 0) {
      faceGridRegistered.innerHTML = '<div class="muted-note">暂无已入库学生<br>在「未标注」中标注人脸即可自动入库</div>';
    } else {
      faceGridRegistered.innerHTML = registeredCards.map(c => {
        if (c.isPresent && c.cropBase64) {
          // 在场 + 有人脸截图：彩色显示
          return `<div class="face-card recognized" data-face-id="${c.id}">
            <img class="face-crop" src="${c.cropBase64}" alt="${esc(c.name)}">
            <div class="face-info">
              <span class="face-name recognized" title="${esc(c.name)}">${esc(c.name)}</span>
              <span class="face-presence-badge present">✓ 在教室</span>
            </div>
          </div>`;
        } else if (c.isPresent) {
          // 在场但缺少截图
          return `<div class="face-card recognized" data-face-id="${c.id}">
            <div class="face-placeholder">👤</div>
            <div class="face-info">
              <span class="face-name recognized" title="${esc(c.name)}">${esc(c.name)}</span>
              <span class="face-presence-badge present">✓ 在教室</span>
            </div>
          </div>`;
        } else {
          // 不在场：灰色
          return `<div class="face-card absent" data-face-id="${c.id}">
            <div class="face-placeholder">👤</div>
            <div class="face-info">
              <span class="face-name absent" title="${esc(c.name)}">${esc(c.name)}</span>
              <span class="face-presence-badge absent">不在教室</span>
            </div>
          </div>`;
        }
      }).join('');
    }
  }

  // ═══════════════════════════════════
  //  人脸标注
  // ═══════════════════════════════════

  function openLabelModal(face) {
    if (!labelModal || !labelStudentSelect || !labelNewName || !labelPreview) return;

    state.pendingLabelFace = { faceId: face.faceId, descriptor: face.descriptor };

    // 显示人脸缩略图
    labelPreview.innerHTML = face.cropBase64
      ? `<img src="${face.cropBase64}" class="label-crop" alt="人脸">`
      : '';

    // 填充已有学生列表
    labelStudentSelect.innerHTML = '<option value="">-- 选择已有学生 --</option>';
    (state.students || []).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      labelStudentSelect.appendChild(opt);
    });

    labelNewName.value = '';
    labelModal.classList.remove('hidden');
  }

  function confirmLabel() {
    if (!state.pendingLabelFace) return;

    const selectVal = labelStudentSelect ? labelStudentSelect.value : '';
    const newName = labelNewName ? labelNewName.value.trim() : '';

    let studentId, name;

    if (selectVal) {
      studentId = selectVal;
      const s = (state.students || []).find(st => st.id === selectVal);
      name = s ? s.name : selectVal;
    } else if (newName) {
      // 新学生：生成 ID
      studentId = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      name = newName;
    } else {
      alert('请选择已有学生或输入新姓名');
      return;
    }

    // 发送标注到教室端
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({
        type: 'label-face',
        faceId: state.pendingLabelFace.faceId,
        studentId,
        name,
        descriptor: state.pendingLabelFace.descriptor,
      }));
    }

    labelModal.classList.add('hidden');
    state.pendingLabelFace = null;
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
    mainTabBtns.forEach(b => {
      const selected = b.dataset.tab === name;
      b.classList.toggle('active', selected);
      b.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    mainTabContents.forEach(c => c.classList.toggle('hidden', c.id !== 'tab-' + name));
  }

  function handleTabKeydown(event, buttons) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const buttonList = Array.from(buttons).filter(button => !button.classList.contains('hidden'));
    const current = buttonList.indexOf(event.currentTarget);
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = buttonList[(current + offset + buttonList.length) % buttonList.length];
    next.focus();
    next.click();
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
    applyTeacherPermissions();

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
    const editable = canModifySubject(a.subject);
    if (editable) html += `<select class="hw-batch-sel" data-batch-aid="${a.id}"><option value="">批量▼</option><option value="已提交">全部已提交</option><option value="未提交">全部未提交</option><option value="迟交">全部迟交</option><option value="免交">全部免交</option></select>`;
    html += '<div class="hw-matrix-hw-acts">';
    if (editable) html += `<button class="btn-ico" data-edit-hw="${a.id}">✎</button><button class="btn-ico" data-del-hw="${a.id}">×</button>`;
    html += '</div></th></tr></thead><tbody>';
    state.students.forEach(s => {
      const st = (a.submissions && a.submissions[s.id]) || '未提交';
      if (filterStatus && st !== filterStatus) return;
      html += `<tr><td class="hw-matrix-name">${esc(s.name)}</td><td class="hw-matrix-cell">`;
      html += `<select class="hw-grid-status-select ${hwStatusClass(st)}" data-aid="${a.id}" data-sid="${s.id}" data-prev="${esc(st)}" ${editable ? '' : 'disabled'}>`;
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

  // ── 作业列表 ──

  function updateHwSubjectSelect() {
    if (!hwModalSubject) return;
    hwModalSubject.innerHTML = '';
    const availableSubjects = state.subjects.filter(canModifySubject);
    if (availableSubjects.length === 0) {
      hwModalSubject.innerHTML = '<option value="">-- 没有可管理的学科 --</option>';
      return;
    }
    availableSubjects.forEach(sub => {
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
      const editable = canModifySubject(a.subject);
      html += `<th class="hw-matrix-hw">`;
      html += `<div class="hw-matrix-hw-title" title="${esc(a.title)}">${esc(a.title)}</div>`;
      html += `<div class="hw-matrix-hw-date">${esc(a.date)}</div>`;
      html += `<div class="hw-matrix-hw-date">${a.deadline ? ('截止 ' + esc(formatDeadline(a.deadline))) : '未设置截止时间'}</div>`;
      if (editable) {
        html += `<select class="hw-batch-sel" data-batch-aid="${a.id}">`;
        html += `<option value="">批量▼</option>`;
        html += `<option value="已提交">全部已提交</option>`;
        html += `<option value="未提交">全部未提交</option>`;
        html += `<option value="迟交">全部迟交</option>`;
        html += `<option value="免交">全部免交</option></select>`;
      }
      html += `<div class="hw-matrix-hw-acts">`;
      if (editable) html += `<button class="btn-ico" data-edit-hw="${a.id}" title="编辑">✎</button><button class="btn-ico" data-del-hw="${a.id}" title="删除">×</button>`;
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
        const editable = canModifySubject(a.subject);
        html += `<td class="hw-matrix-cell">`;
        html += `<select class="hw-grid-status-select ${hwStatusClass(status)}" data-aid="${a.id}" data-sid="${s.id}" data-prev="${esc(status)}" ${editable ? '' : 'disabled'}>`;
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
    if (state.subjects.filter(canModifySubject).length === 0) { alert('你没有可布置作业的授权学科，请联系班主任'); return; }
    state.editingAssignmentId = null;
    if (hwModalTitleLabel) hwModalTitleLabel.textContent = '添加作业';
    if (hwModalTitle) hwModalTitle.value = '';
    if (hwModalDate) hwModalDate.value = new Date().toISOString().slice(0, 10);
    if (hwModalDeadline) {
      const later = new Date(Date.now() + 60 * 60 * 1000);
      later.setMinutes(0, 0, 0);
      hwModalDeadline.value = toDateTimeLocal(later);
    }
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
    if (hwModalDeadline) hwModalDeadline.value = a.deadline || '';
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
    const deadline = hwModalDeadline && hwModalDeadline.value ? hwModalDeadline.value : '';
    if (!deadline) { alert('请设置提交截止时间'); return; }

    const isEdit = !!state.editingAssignmentId;
    if (isEdit) {
      const a = state.assignments.find(x => x.id === state.editingAssignmentId);
      if (a) { a.subject = subject; a.title = title; a.date = date; a.deadline = deadline; }
    } else {
      const subs = {};
      state.students.forEach(s => { subs[s.id] = '未提交'; });
      state.assignments.push({ id: genId(), subject, title, date, deadline, submissions: subs });
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
  function toDateTimeLocal(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0') + 'T' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0'); }
  function formatDeadline(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }); }
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
    mainTabBtns.forEach(btn => {
      btn.addEventListener('click', () => switchMainTab(btn.dataset.tab));
      btn.addEventListener('keydown', event => handleTabKeydown(event, mainTabBtns));
    });

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
    if (addAssignmentBtn2)   addAssignmentBtn2.addEventListener('click', () => openAddHw());
    if (saveClassroomBtn) saveClassroomBtn.addEventListener('click', () => submitClassroomConfig(manageClassName, manageStudents, false));
    if (completeSetupBtn) completeSetupBtn.addEventListener('click', () => submitClassroomConfig(setupClassName, setupStudents, true));
    if (refreshTeachersBtn) refreshTeachersBtn.addEventListener('click', () => {
      if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: 'request-sync' }));
    });
    const handleTeacherListClick = event => {
      const button = event.target.closest('[data-teacher-action]');
      if (!button) return;
      const action = button.dataset.teacherAction;
      const connectionId = button.dataset.id;
      if (action === 'edit') {
        const teacher = (state.teachers.approved || []).find(item => item.connection_id === connectionId);
        if (!teacher) return;
        editingTeacherId = connectionId;
        const teacherEditTitle = document.getElementById('teacherEditTitle');
        if (teacherEditTitle) teacherEditTitle.textContent = teacher.role === '班主任' ? '设置班主任授课科目' : '设置授课科目';
        teacherEditName.textContent = `${teacher.name} · ${teacher.role || '授课教师'}`;
        teacherEditSubjects.value = (teacher.subjects || []).join(', ');
        teacherEditModal.classList.remove('hidden');
        teacherEditSubjects.focus();
      } else if ((action === 'remove' || action === 'reject') && !confirm(action === 'remove' ? '确定移除这位任课教师吗？' : '确定拒绝这条加入请求吗？')) {
        return;
      } else {
        sendTeacherManagement(action, connectionId);
      }
    };
    if (pendingTeacherList) pendingTeacherList.addEventListener('click', handleTeacherListClick);
    if (approvedTeacherList) approvedTeacherList.addEventListener('click', handleTeacherListClick);
    if (teacherEditCancel) teacherEditCancel.addEventListener('click', () => teacherEditModal.classList.add('hidden'));
    if (teacherEditSave) teacherEditSave.addEventListener('click', () => {
      const subjects = teacherEditSubjects.value.split(/[,，]/).map(item => item.trim()).filter(Boolean);
      if (!subjects.length) { alert('请至少填写一个授课科目'); teacherEditSubjects.focus(); return; }
      sendTeacherManagement('update', editingTeacherId, subjects);
      teacherEditModal.classList.add('hidden');
    });
    if (teacherEditModal) teacherEditModal.addEventListener('click', event => { if (event.target === teacherEditModal) teacherEditModal.classList.add('hidden'); });

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

    // 人脸标注弹窗
    if (labelCancel)  labelCancel.addEventListener('click', () => labelModal && labelModal.classList.add('hidden'));
    if (labelConfirm) labelConfirm.addEventListener('click', confirmLabel);
    if (labelNewName) {
      labelNewName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmLabel();
        if (e.key === 'Escape') labelModal && labelModal.classList.add('hidden');
      });
    }
    if (labelModal) {
      labelModal.addEventListener('click', (e) => {
        if (e.target === labelModal) labelModal.classList.add('hidden');
      });
    }

    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (registerForm) registerForm.addEventListener('submit', handleRegister);
    if (keyLoginForm) keyLoginForm.addEventListener('submit', handleKeyLogin);
    const showRegister = document.getElementById('showRegister');
    const showLogin = document.getElementById('showLogin');
    const showKeyLogin = document.getElementById('showKeyLogin');
    const showKeyLoginFromRegister = document.getElementById('showKeyLoginFromRegister');
    const backToPasswordLogin = document.getElementById('backToPasswordLogin');
    if (showRegister) showRegister.addEventListener('click', () => showAccountOverlay('register'));
    if (showLogin) showLogin.addEventListener('click', () => showAccountOverlay('login'));
    if (showKeyLogin) showKeyLogin.addEventListener('click', () => showAccountOverlay('key'));
    if (showKeyLoginFromRegister) showKeyLoginFromRegister.addEventListener('click', () => showAccountOverlay('key'));
    if (backToPasswordLogin) backToPasswordLogin.addEventListener('click', () => showAccountOverlay('login'));
    const generateLoginKeyBtn = document.getElementById('generateLoginKeyBtn');
    const copyLoginKeyBtn = document.getElementById('copyLoginKeyBtn');
    const generateMiniProgramQrBtn = document.getElementById('generateMiniProgramQrBtn');
    if (generateLoginKeyBtn) generateLoginKeyBtn.addEventListener('click', handleGenerateLoginKey);
    if (copyLoginKeyBtn) copyLoginKeyBtn.addEventListener('click', handleCopyLoginKey);
    if (generateMiniProgramQrBtn) generateMiniProgramQrBtn.addEventListener('click', handleGenerateMiniProgramQr);
    if (accountMenuBtn) accountMenuBtn.addEventListener('click', openAccountModal);
    const accountModalClose = document.getElementById('accountModalClose');
    const logoutBtn = document.getElementById('logoutBtn');
    if (accountModalClose) accountModalClose.addEventListener('click', () => accountModal && accountModal.classList.add('hidden'));
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    if (accountModal) accountModal.addEventListener('click', event => {
      if (event.target === accountModal) accountModal.classList.add('hidden');
    });
    const approvalRetryBtn = document.getElementById('approvalRetryBtn');
    const approvalCancelBtn = document.getElementById('approvalCancelBtn');
    if (approvalRetryBtn) approvalRetryBtn.addEventListener('click', () => {
      const ip = state.pendingRoomIp || (state.currentRoom && state.currentRoom.ip);
      if (ip) connect(ip);
    });
    if (approvalCancelBtn) approvalCancelBtn.addEventListener('click', () => {
      hideApprovalOverlay();
      disconnect();
    });

    // 人脸子标签切换（未标注 / 已入库）
    const faceSubtabs = document.querySelectorAll('.face-subtab');
    const faceGridUnknownEl = document.getElementById('faceGridUnknown');
    const faceGridRegisteredEl = document.getElementById('faceGridRegistered');
    const faceHintUnknown = document.getElementById('faceHintUnknown');
    const faceHintRegistered = document.getElementById('faceHintRegistered');

    faceSubtabs.forEach(tab => {
      tab.addEventListener('keydown', event => handleTabKeydown(event, Array.from(faceSubtabs)));
      tab.addEventListener('click', () => {
        faceSubtabs.forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        const target = tab.dataset.subtab;
        faceSubtabActive = target;

        if (target === 'unknown') {
          if (faceGridUnknownEl) faceGridUnknownEl.classList.remove('hidden');
          if (faceGridRegisteredEl) faceGridRegisteredEl.classList.add('hidden');
          if (faceHintUnknown) faceHintUnknown.classList.remove('hidden');
          if (faceHintRegistered) faceHintRegistered.classList.add('hidden');
        } else {
          if (faceGridUnknownEl) faceGridUnknownEl.classList.add('hidden');
          if (faceGridRegisteredEl) faceGridRegisteredEl.classList.remove('hidden');
          if (faceHintUnknown) faceHintUnknown.classList.add('hidden');
          if (faceHintRegistered) faceHintRegistered.classList.remove('hidden');
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
    callFlow       = document.getElementById('callFlow');
    callMessageInp = document.getElementById('callMessage');
    msgEditor      = document.getElementById('msgEditor');
    studentGrid    = document.getElementById('studentGrid');
    emptyState     = document.getElementById('emptyState');
    searchInput    = document.getElementById('searchInput');
    searchRow      = document.getElementById('searchRow');
    searchResult   = document.getElementById('searchResult');
    historyTbody   = document.querySelector('#historyTable tbody');
    noHistory      = document.getElementById('noHistory');

    accountOverlay = document.getElementById('accountOverlay');
    accountTitle   = document.getElementById('accountTitle');
    accountDesc    = document.getElementById('accountDesc');
    loginForm      = document.getElementById('loginForm');
    registerForm   = document.getElementById('registerForm');
    keyLoginForm   = document.getElementById('keyLoginForm');
    loginName      = document.getElementById('loginName');
    loginPassword  = document.getElementById('loginPassword');
    loginError     = document.getElementById('loginError');
    regName        = document.getElementById('regName');
    regSubjects    = document.getElementById('regSubjects');
    regPassword    = document.getElementById('regPassword');
    regPassword2   = document.getElementById('regPassword2');
    regError       = document.getElementById('regError');
    loginKeyInput  = document.getElementById('loginKeyInput');
    keyLoginError  = document.getElementById('keyLoginError');
    generatedLoginKey = document.getElementById('generatedLoginKey');
    loginKeyResult = document.getElementById('loginKeyResult');
    loginKeyStatus = document.getElementById('loginKeyStatus');
    teacherInfo    = document.getElementById('teacherInfo');
    accountMenuBtn = document.getElementById('accountMenuBtn');
    accountModal   = document.getElementById('accountModal');
    approvalOverlay= document.getElementById('approvalOverlay');
    approvalDesc   = document.getElementById('approvalDesc');

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

    hwStatusFilter       = document.getElementById('hwStatusFilter');
    hwDateFrom           = document.getElementById('hwDateFrom');
    hwDateTo             = document.getElementById('hwDateTo');
    addAssignmentBtn2    = document.getElementById('addAssignmentBtn2');
    hwContent            = document.getElementById('hwContent');
    hwModal               = document.getElementById('hwModal');
    hwModalTitleLabel     = document.getElementById('hwModalTitleLabel');
    hwModalSubject        = document.getElementById('hwModalSubject');
    hwModalTitle          = document.getElementById('hwModalTitle');
    hwModalDate           = document.getElementById('hwModalDate');
    hwModalDeadline       = document.getElementById('hwModalDeadline');
    hwModalCancel         = document.getElementById('hwModalCancel');
    hwModalConfirm        = document.getElementById('hwModalConfirm');
    classroomTabBtn       = document.getElementById('classroomTabBtn');
    manageClassName       = document.getElementById('manageClassName');
    manageStudents        = document.getElementById('manageStudents');
    saveClassroomBtn      = document.getElementById('saveClassroomBtn');
    classroomSetupOverlay = document.getElementById('classroomSetupOverlay');
    setupClassName        = document.getElementById('setupClassName');
    setupStudents         = document.getElementById('setupStudents');
    setupError            = document.getElementById('setupError');
    completeSetupBtn      = document.getElementById('completeSetupBtn');
    pendingTeacherList    = document.getElementById('pendingTeacherList');
    approvedTeacherList   = document.getElementById('approvedTeacherList');
    pendingTeacherCount   = document.getElementById('pendingTeacherCount');
    approvedTeacherCount  = document.getElementById('approvedTeacherCount');
    refreshTeachersBtn    = document.getElementById('refreshTeachersBtn');
    teacherEditModal      = document.getElementById('teacherEditModal');
    teacherEditName       = document.getElementById('teacherEditName');
    teacherEditSubjects   = document.getElementById('teacherEditSubjects');
    teacherEditCancel     = document.getElementById('teacherEditCancel');
    teacherEditSave       = document.getElementById('teacherEditSave');

    // 人脸识别 DOM
    faceSection        = document.getElementById('faceSection');
    faceRoomName       = document.getElementById('faceRoomName');
    faceSummary        = document.getElementById('faceSummary');
    faceGridUnknown    = document.getElementById('faceGridUnknown');
    faceGridRegistered = document.getElementById('faceGridRegistered');
    // 标注弹窗 DOM
    labelModal        = document.getElementById('labelModal');
    labelPreview      = document.getElementById('labelPreview');
    labelStudentSelect = document.getElementById('labelStudentSelect');
    labelNewName      = document.getElementById('labelNewName');
    labelCancel       = document.getElementById('labelCancel');
    labelConfirm      = document.getElementById('labelConfirm');

    bindEvents();
    loadFromDisk().then(data => {
      state.rooms       = data.rooms;
      state.callHistory = data.callHistory;
      renderRooms();
      renderHistory();
      // 不恢复登录会话：每次启动都要求教师重新输入密码。
      showAccountOverlay(data.account ? 'login' : 'register', data.account);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
