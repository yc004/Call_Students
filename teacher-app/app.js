/* ══════════════════════════════════════════
   教师端 — 登录与连接流程
   个人本地 / 组织云端登录 → 小程序扫码同步 → 连接教室 → 使用教学功能
   ══════════════════════════════════════════ */

(function () {
  'use strict';

  const api = window.api || {};
  const connectionCode = window.ConnectionCode;
  const homeworkView = window.HomeworkView;
  const SUBJECT_OPTIONS = Object.freeze(['语文','数学','英语','物理','化学','生物','道德与法治','历史','地理','科学','信息科技','通用技术','体育与健康','音乐','美术','劳动','综合实践活动','心理健康','班会','日语','俄语']);

  function reportClientError(title, error, options = {}) {
    const reporter = window.clientErrors;
    if (reporter && typeof reporter.show === 'function') {
      return reporter.show({ title, error, message:options.message, context:options.context, suggestions:options.suggestions || [] });
    }
    alert(`${title}\n\n${error && error.message || error || '未知错误'}\n\n请将以上信息提交给管理员。`);
    return '';
  }

  // ── DOM ──
  let connectionCodeInput, connectBtn, roomList, noRooms, connDot, connLabel;
  let roomHeader, roomTitle, studentCount, msgRow, callMessageInp, callFlow;
  let studentGrid, emptyState, historyTbody, noHistory, multiCallToggle, callBatchBar, callBatchCount, clearCallSelection, sendBatchCall, callSelectionHint;
  let searchInput, searchRow, searchResult;
  let msgEditor;
  let mainTabs, mainTabBtns, mainTabContents;
  let hwSection;
  let hwStatusFilter, hwDateFrom, hwDateTo, addAssignmentBtn2, exportHomeworkBtn, aiHomeworkBtn;
  let hwStagePending, hwStageClosed, hwPendingCount, hwClosedCount, hwPendingLabel, hwClosedLabel, hwPendingHint, hwClosedHint;
  let hwContentHomework, hwContentNotice, publishNoticeBtn;
  // 多选
  let hwSubjectMs, hwSubjectBtn, hwSubjectDrop, selectedSubjects = [];
  let hwAssignMs, hwAssignBtn, hwAssignDrop, selectedAssigns = [];
  let homeworkStage = 'pending';
  let homeworkContentType = 'homework';
  let publishType = 'homework';
  let hwContent;
  let hwModal, hwModalTitleLabel, hwModalSubject, hwModalTitle, hwModalDate, hwModalDeadline, hwModalCancel, hwModalConfirm;
  let aiHomeworkModal, aiHomeworkClose, aiSubject, aiStage, aiDateFrom, aiDateTo, aiFocus, aiAnonymize;
  let aiProviderStatus, openAiSettingsBtn, aiAnalysisStatus, aiAnalyzeBtn, aiReportEmpty, aiReportLoading, aiReportContent;
  let accountAiSettings, accountAiEndpoint, accountAiModel, accountAiApiKey, accountAiStatus, saveAccountAiSettings;
  let lastAiAnalysis = null;
  let publishTypeHomework, publishTypeNotice, publishContentLabel, publishDeadlineLabel, publishHint;
  // 人脸识别 DOM
  let faceSection, faceRoomName, faceSummary;
  let faceGridUnknown, faceGridRegistered;
  let faceSubtabActive = 'unknown'; // 当前活跃的子标签
  // 标注弹窗 DOM
  let labelModal, labelPreview, labelStudentSelect, labelNewName;
  let labelCancel, labelConfirm;
  // 账户与审批 DOM
  let accountOverlay, accountTitle, accountDesc;
  let teacherInfo, accountMenuBtn, accountModal, approvalOverlay, approvalDesc;
  let classroomTabBtn, manageClassName, manageStudents, saveClassroomBtn;
  let classroomSetupOverlay, setupClassName, setupStudents, setupError, completeSetupBtn;
  let pendingTeacherList, approvedTeacherList, pendingTeacherCount, approvedTeacherCount, refreshTeachersBtn;
  let teacherEditModal, teacherEditName, teacherEditSubjects, teacherEditCancel, teacherEditSave;
  let pendingAccountAvatarPath = '';
  let connectSubjectDrop, teacherEditSubjectDrop;
  let connectSubjectSelection = [];
  let teacherEditSubjectSelection = [];
  let editingTeacherId = '';
  let miniLoginPollTimer = null;
  let teacherLoginMode = 'toc';

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
    consecutiveFailures: 0,
    reconnectPaused: false,
    failurePromptShown: false,
    searchQuery:  '',
    subjects:     [],
    assignments:  [],
    editingAssignmentId: null,
    studentStatus: [],  // [{ studentId, name, status, lastSeen, similarity }]
    faceDetections: [], // 当前检测到的人脸 [{ faceId, cropBase64, descriptor, studentId, name, similarity, isRecognized }]
    pendingFaces: [],   // 教室端持久化的待标注人脸库，仅班主任可匹配姓名
    pendingLabelFace: null, // 待标注的人脸 { faceId, descriptor }
    account: null,      // 登录后才存在：{ name, subjects, connectionId }
    cloud: null,        // 小程序扫码同步的云服务会话
    faceLanWs: null,
    teacherStatus: null,
    classroomConfigured: false,
    teachers: { approved: [], pending: [] },
    pendingRoomCode: '',
    connectingRoomCode: '',
    pendingConnectSubjects: [],
    leavingRoomCode: '',
    pendingLeave: null,
  };
  const MAX_HISTORY = 500;
  const MAX_CONNECT_ATTEMPTS = 5;
  let multiCallMode = false;
  const selectedCallStudentIds = new Set();

  // ═══════════════════════════════════
  //  持久化
  // ═══════════════════════════════════

  async function loadFromDisk() {
    if (!api.getData) return { rooms: [], callHistory: [], account: null };
    try {
      const d = await api.getData();
      return { rooms: d.rooms || [], callHistory: d.callHistory || [], account: d.account || null, cloud:d.cloud || null };
    } catch (e) {
      reportClientError('无法读取教师端本地数据', e, { context:'教师端启动', message:'本地账户或教室数据读取失败，本次将以空数据继续启动。', suggestions:['检查当前用户是否有数据目录读写权限', '不要卸载或清理数据，先复制错误信息提交管理员'] });
      return { rooms: [], callHistory: [], account: null };
    }
  }

  // ═══════════════════════════════════
  //  账户
  // ═══════════════════════════════════

  function showAccountOverlay() {
    if (!accountOverlay) return;
    accountOverlay.classList.remove('hidden');
    accountOverlay.classList.remove('register-mode');
    document.body.classList.add('account-locked');
    const appRoot = document.querySelector('.app');
    if (appRoot) appRoot.setAttribute('inert', '');
    document.getElementById('miniScanLogin')?.classList.remove('hidden');
    if (accountTitle) accountTitle.textContent = '开始使用教师端';
    if (accountDesc) accountDesc.textContent = '选择个人或组织模式，也可以直接使用小程序扫码登录。';
    loadTeacherDirectSettings();
    setTimeout(() => handleTeacherLoginQr(), 0);
  }

  function setTeacherLoginMode(mode) {
    teacherLoginMode = mode === 'tob' ? 'tob' : 'toc';
    document.querySelectorAll('.mode-switch-btn').forEach(button => button.classList.toggle('active', button.dataset.mode === teacherLoginMode));
    document.getElementById('personalLoginPanel')?.classList.toggle('hidden', teacherLoginMode !== 'toc');
    document.getElementById('organizationLoginPanel')?.classList.toggle('hidden', teacherLoginMode !== 'tob');
    if (accountTitle) accountTitle.textContent = teacherLoginMode === 'tob' ? '登录组织空间' : '开始个人使用';
    if (accountDesc) accountDesc.textContent = teacherLoginMode === 'tob' ? '连接组织服务器后，教室、作业和通知会在团队内同步。' : '数据保存在本机，适合个人或家庭使用。';
  }

  async function startPersonalSession() {
    const button = document.getElementById('personalStartBtn');
    const name = document.getElementById('personalTeacherName')?.value || '';
    if (button) { button.disabled = true; button.textContent = '正在准备…'; }
    try {
      const result = await api.createLocalSession?.({ name });
      if (!result || !result.ok) throw new Error(result?.message || '无法创建个人会话');
      disconnect(); resetRoomWorkspace(false); state.rooms = result.rooms || []; state.cloud = null; state.callHistory = [];
      renderRooms(); renderHistory(); setSignedInAccount(result.account);
    } catch (error) { reportClientError('无法创建个人会话', error, { context:'个人模式登录', suggestions:['检查教师姓名是否填写完整', '重新启动教师端后重试'] }); }
    finally { if (button) { button.disabled = false; button.textContent = '直接开始使用'; } }
  }

  async function loginOrganization() {
    const button = document.getElementById('organizationLoginBtn');
    const status = document.getElementById('organizationLoginStatus');
    const profileFields = document.getElementById('organizationProfileFields');
    const serverUrl = document.getElementById('organizationServer')?.value || '';
    const useHttps = !!document.getElementById('organizationUseHttps')?.checked;
    const loginName = document.getElementById('organizationLoginName')?.value || '';
    const password = document.getElementById('organizationPassword')?.value || '';
    if (button) { button.disabled = true; button.textContent = '登录中…'; }
    if (status) status.textContent = '正在连接组织服务器…';
    try {
      const result = await api.loginTeacherCloud?.({ serverUrl, useHttps, loginName, password });
      if (!result || !result.ok) throw Object.assign(new Error(result?.message || '组织登录失败'), { code:result?.code });
      if (result.cloud?.mustChangePassword) {
        profileFields?.classList.remove('hidden');
        if (status) status.textContent = '首次登录需要完善资料并修改默认密码，然后再次点击登录。';
        const confirm = document.getElementById('organizationNewPasswordConfirm')?.value || '';
        const newPassword = document.getElementById('organizationNewPassword')?.value || '';
        if (!newPassword || newPassword !== confirm) { if (button) { button.disabled = false; button.textContent = '保存资料并登录'; } return; }
        const username = document.getElementById('organizationNickname')?.value || '';
        const completed = await api.completeTeacherProfile?.({ name:username, nickname:username, newPassword });
        if (!completed?.ok) throw new Error(completed?.message || '资料更新失败');
        result.account = completed.account || result.account; result.cloud = completed.cloud || result.cloud;
        const refreshed = await api.refreshCloudClassrooms?.();
        if (refreshed?.ok) result.rooms = refreshed.rooms || [];
        profileFields.classList.add('hidden');
      }
      disconnect(); resetRoomWorkspace(false); state.rooms = result.rooms || []; state.cloud = result.cloud || null; state.callHistory = [];
      renderRooms(); renderHistory(); setSignedInAccount(result.account);
    } catch (error) {
      if (status) status.textContent = error.message || '组织登录失败';
      reportClientError('无法登录组织', error, { context:'组织模式登录', suggestions:['检查服务器地址、HTTP/HTTPS 选项和账号密码', '确认组织服务器已经启动且当前网络可以访问'] });
    }
    finally { if (button) { button.disabled = false; button.textContent = '登录组织'; } }
  }

  function hideAccountOverlay() {
    stopMiniLoginPolling();
    accountOverlay && accountOverlay.classList.add('hidden');
    document.body.classList.remove('account-locked');
    const appRoot = document.querySelector('.app');
    if (appRoot) appRoot.removeAttribute('inert');
  }

  function stopMiniLoginPolling() {
    if (miniLoginPollTimer) clearInterval(miniLoginPollTimer);
    miniLoginPollTimer = null;
  }

  async function handleTeacherLoginQr() {
    if (!api.generateMiniProgramQr) return;
    const image = document.getElementById('teacherLoginQrImage');
    const status = document.getElementById('teacherLoginQrStatus');
    const button = document.getElementById('refreshTeacherLoginQr');
    stopMiniLoginPolling();
    if (button) { button.disabled = true; button.textContent = '生成中…'; }
    if (status) status.textContent = '正在建立局域网临时登录服务…';
    try {
      const result = await api.generateMiniProgramQr();
      if (!result || !result.ok) throw new Error(result && result.message || '二维码生成失败');
      if (image) image.src = result.qrDataUrl;
      if (status) status.textContent = result.qrMode === 'wechat-direct'
        ? '打开微信直接扫描即可登录教师端。二维码 2 分钟内有效。'
        : '打开小程序“我的—登录电脑教师端”扫码。二维码 2 分钟内有效。';
      if (button) button.textContent = '刷新二维码';
      miniLoginPollTimer = setInterval(checkMiniProgramLoginStatus, 700);
    } catch (error) {
      if (status) status.textContent = '二维码生成失败，请检查局域网后重试。';
      reportClientError('教师端登录二维码生成失败', error, { context:'小程序扫码登录', suggestions:['确认教师电脑已连接局域网', '检查防火墙是否允许教师端建立临时登录服务'] });
    }
    finally { if (button) button.disabled = false; }
  }

  async function loadTeacherDirectSettings() {
    if (!api.getWechatDirectLinkSettings) return;
    const input = document.getElementById('teacherDirectBaseUrl');
    const status = document.getElementById('teacherDirectStatus');
    const settings = await api.getWechatDirectLinkSettings();
    if (input) input.value = settings && settings.baseUrl || '';
    if (status) status.textContent = settings && settings.enabled ? '已启用微信直接扫码。' : '未配置时继续使用小程序内扫码。';
  }

  async function checkMiniProgramLoginStatus() {
    if (!api.getMiniProgramLoginStatus) return;
    const result = await api.getMiniProgramLoginStatus();
    if (!result || !result.ok) return;
    stopMiniLoginPolling();
    disconnect();
    resetRoomWorkspace(false);
    state.rooms = result.rooms || [];
    state.cloud = result.cloud || null;
    state.callHistory = result.callHistory || [];
    state.currentRoom = null;
    state.connectingRoomCode = '';
    state.pendingRoomCode = '';
    renderRooms();
    renderHistory();
    setSignedInAccount(result.account);
  }

  function setSignedInAccount(account) {
    state.account = account;
    if (teacherInfo) teacherInfo.textContent = account.name;
    const sidebarAvatar = document.getElementById('accountAvatar');
    const modalAvatar = document.getElementById('accountModalAvatar');
    const cloudAvatar = state.cloud?.avatarUrl || '';
    renderAccountAvatar(sidebarAvatar, account, cloudAvatar);
    renderAccountAvatar(modalAvatar, account, cloudAvatar);
    const organization = state.cloud?.organization;
    document.body.dataset.usageMode = state.cloud ? 'tob' : 'toc';
    const modeLabel = document.querySelector('.brand-sub');
    if (modeLabel) modeLabel.textContent = organization?.shortName ? `${organization.shortName} · 组织模式` : (state.cloud ? '组织模式' : '个人模式');
    if (organization?.primaryColor && /^#[0-9A-Fa-f]{6}$/.test(organization.primaryColor)) document.documentElement.style.setProperty('--primary', organization.primaryColor);
    accountMenuBtn && accountMenuBtn.classList.remove('hidden');
    hideAccountOverlay();
    if (state.pendingRoomCode && connectionCode.isValid(state.pendingRoomCode)) {
      const code = state.pendingRoomCode;
      state.pendingRoomCode = '';
      setTimeout(() => connect(code), 0);
    }
  }

  function renderAccountAvatar(element, account, overrideUrl = '') {
    if (!element) return;
    const avatarUrl = overrideUrl || account && account.avatarUrl || '';
    element.style.backgroundImage = avatarUrl ? `url("${String(avatarUrl).replace(/["\\]/g, '\\$&')}")` : '';
    element.classList.toggle('has-image', !!avatarUrl);
    element.textContent = avatarUrl ? '' : String(account && account.name || '教').trim().slice(0, 1);
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
        ? `手机与电脑需在同一局域网。扫码后将安全传输 ${result.roomCount} 个已保存教室；二维码 2 分钟内有效，成功后立即失效。`
        : '手机与电脑需在同一局域网。当前没有已保存教室；二维码 2 分钟内有效，成功后立即失效。';
      resultBox && resultBox.classList.remove('hidden');
      if (button) button.textContent = '刷新二维码';
      stopMiniLoginPolling();
      miniLoginPollTimer = setInterval(checkMiniProgramLoginStatus, 700);
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
    if (subjects) subjects.textContent = '连接教室后确认授课科目';
    if (connectionId) connectionId.textContent = state.account.connectionId;
    const profileName = document.getElementById('accountProfileName');
    const profileHint = document.getElementById('accountProfileStorageHint');
    const passwordFields = document.getElementById('accountPasswordFields');
    if (profileName) profileName.value = state.cloud?.nickname || state.cloud?.userName || state.account.name || '';
    if (profileHint) profileHint.textContent = state.cloud ? '用户名与头像保存到组织云端' : '用户名与头像保存在当前电脑';
    passwordFields?.classList.toggle('hidden', !state.cloud);
    ['accountCurrentPassword','accountNewPassword','accountConfirmPassword'].forEach(id => { const input=document.getElementById(id); if(input) input.value=''; });
    pendingAccountAvatarPath = '';
    renderAccountAvatar(document.getElementById('accountProfileAvatar'), state.account, state.cloud?.avatarUrl || '');
    const profileStatus = document.getElementById('accountProfileStatus');
    if (profileStatus) profileStatus.textContent = state.cloud ? '组织模式可以同时修改登录密码' : '个人模式资料不会上传到云端';
    document.getElementById('miniProgramQrResult')?.classList.add('hidden');
    accountModal.classList.remove('hidden');
    renderCloudAccountSettings();
    loadHomeworkAiSettings();
  }

  async function chooseAccountAvatar() {
    if (!api.chooseTeacherAvatar) return;
    const result = await api.chooseTeacherAvatar();
    if (!result || result.canceled) return;
    if (!result.ok) { reportClientError('无法选择头像', new Error(result.message || '头像文件无效'), { context:'教师端设置－个人资料' }); return; }
    pendingAccountAvatarPath = result.filePath || '';
    renderAccountAvatar(document.getElementById('accountProfileAvatar'), state.account, result.previewUrl || '');
  }

  async function saveAccountProfile() {
    if (!api.updateTeacherProfile) return;
    const button = document.getElementById('saveAccountProfile');
    const status = document.getElementById('accountProfileStatus');
    const name = document.getElementById('accountProfileName')?.value.trim() || '';
    const currentPassword = document.getElementById('accountCurrentPassword')?.value || '';
    const newPassword = document.getElementById('accountNewPassword')?.value || '';
    const confirmPassword = document.getElementById('accountConfirmPassword')?.value || '';
    if (!name) { if(status)status.textContent='请输入用户名'; return; }
    if (newPassword && newPassword.length < 10) { if(status)status.textContent='新密码至少需要 10 位'; return; }
    if (newPassword && newPassword !== confirmPassword) { if(status)status.textContent='两次输入的新密码不一致'; return; }
    if (newPassword && !currentPassword) { if(status)status.textContent='修改密码前请输入当前密码'; return; }
    if (button) button.disabled = true;
    if (status) status.textContent = '正在保存…';
    try {
      const result = await api.updateTeacherProfile({ name, avatarPath:pendingAccountAvatarPath, currentPassword, newPassword });
      if (!result || !result.ok) throw Object.assign(new Error(result?.message || '个人资料保存失败'), { code:result?.code });
      state.cloud = result.cloud || null;
      setSignedInAccount(result.account);
      pendingAccountAvatarPath = '';
      renderAccountAvatar(document.getElementById('accountProfileAvatar'), result.account, result.cloud?.avatarUrl || '');
      ['accountCurrentPassword','accountNewPassword','accountConfirmPassword'].forEach(id => { const input=document.getElementById(id); if(input) input.value=''; });
      if (status) status.textContent = newPassword ? '个人资料和密码已更新' : '个人资料已保存';
    } catch (error) {
      if (status) status.textContent = error.message || '保存失败';
      reportClientError('个人资料保存失败', error, { context:'教师端设置－个人资料', suggestions:['组织模式请确认当前密码和网络连接', '头像仅支持 PNG、JPEG 或 WebP，且不能超过 5MB'] });
    } finally { if (button) button.disabled = false; }
  }

  function renderHomeworkAiSettings(settings = {}) {
    if (accountAiEndpoint) accountAiEndpoint.value = settings.endpoint || '';
    if (accountAiModel) accountAiModel.value = settings.model || '';
    if (accountAiApiKey) {
      accountAiApiKey.value = '';
      accountAiApiKey.placeholder = settings.hasApiKey ? '密钥已安全保存；留空保持不变' : '输入后使用系统安全存储加密保存';
    }
    const configured = !!(settings.endpoint && settings.model);
    if (accountAiStatus) {
      accountAiStatus.textContent = configured ? `已配置 ${settings.model}，所有教室共用` : '尚未配置 AI 服务';
      accountAiStatus.classList.toggle('is-success', configured);
    }
    if (aiProviderStatus) aiProviderStatus.textContent = configured ? `${settings.model} · 已就绪` : '尚未配置 AI 服务';
    return configured;
  }

  async function loadHomeworkAiSettings() {
    if (!api.getHomeworkAiSettings) {
      if (accountAiStatus) accountAiStatus.textContent = '当前版本不支持 AI API 配置';
      return null;
    }
    try {
      const settings = await api.getHomeworkAiSettings();
      renderHomeworkAiSettings(settings);
      return settings;
    } catch (error) {
      if (accountAiStatus) accountAiStatus.textContent = '无法读取 API 配置';
      if (aiProviderStatus) aiProviderStatus.textContent = '无法读取 API 配置';
      reportClientError('无法读取 AI API 设置', error, { context:'教师端设置', suggestions:['检查当前用户的数据目录权限', '重新启动教师端后重试'] });
      return null;
    }
  }

  async function saveHomeworkAiSettings() {
    if (!api.setHomeworkAiSettings || !saveAccountAiSettings) return;
    saveAccountAiSettings.disabled = true;
    if (accountAiStatus) {
      accountAiStatus.textContent = '正在保存…';
      accountAiStatus.classList.remove('is-success');
    }
    try {
      const result = await api.setHomeworkAiSettings({
        endpoint:accountAiEndpoint?.value || '',
        model:accountAiModel?.value || '',
        apiKey:accountAiApiKey?.value || '',
      });
      if (!result || !result.ok) throw new Error((result && result.message) || '保存 AI API 配置失败');
      renderHomeworkAiSettings(result.settings || {});
      if (accountAiStatus) accountAiStatus.textContent = '已保存，所有教室将共用此配置';
    } catch (error) {
      if (accountAiStatus) accountAiStatus.textContent = error.message || '保存失败';
      reportClientError('AI API 配置保存失败', error, { context:'教师端设置', suggestions:['检查 API 地址和模型名称是否正确', '如果填写了本地地址，请确认服务已启动'] });
    } finally {
      saveAccountAiSettings.disabled = false;
    }
  }

  function openGlobalAiSettings() {
    closeAiHomeworkAnalysis();
    openAccountModal();
    if (accountAiSettings) accountAiSettings.open = true;
    window.setTimeout(() => accountAiEndpoint?.focus(), 80);
  }

  function renderCloudAccountSettings() {
    const status = document.getElementById('accountCloudStatus');
    const server = document.getElementById('accountCloudServer');
    if (server && state.cloud && state.cloud.serverUrl) server.value = state.cloud.serverUrl;
    if (status) status.textContent = state.cloud ? `已连接 ${state.cloud.organization?.name ? `${state.cloud.organization.name} · ` : ''}${state.cloud.serverUrl}` : '当前为个人本地模式';
  }

  async function enrollTeacherCloud() {
    if (!api.enrollTeacherCloud) return;
    const button = document.getElementById('accountCloudConnectBtn');
    const status = document.getElementById('accountCloudStatus');
    button.disabled = true; status.textContent = '正在连接云服务…';
    const result = await api.enrollTeacherCloud({ serverUrl:document.getElementById('accountCloudServer').value, key:document.getElementById('accountCloudKey').value });
    button.disabled = false;
    if (!result.ok) { status.textContent = result.message || '连接失败'; return; }
    state.cloud = result.cloud; state.rooms = [...state.rooms.filter(room => room.transport !== 'cloud'), ...(result.rooms || [])];
    document.getElementById('accountCloudKey').value = ''; renderRooms(); renderCloudAccountSettings();
    status.textContent = `教师云账号已接入 ${result.cloud.serverUrl}`;
  }

  async function refreshCloudRooms(options={}) {
    if (!api.refreshCloudClassrooms) return;
    const status = document.getElementById('accountCloudStatus');
    if (status && !options.silent) status.textContent = '正在同步云端教室…';
    const result = await api.refreshCloudClassrooms();
    if (!result.ok) { if(status&&!options.silent)status.textContent=result.message||'同步失败'; return; }
    state.cloud = result.cloud; state.rooms = [...state.rooms.filter(room => room.transport !== 'cloud'), ...(result.rooms || [])]; if (result.account) setSignedInAccount(result.account); renderRooms(); renderCloudAccountSettings();
  }

  function handleLogout() {
    disconnect();
    hideApprovalOverlay();
    accountModal && accountModal.classList.add('hidden');
    state.account = null;
    state.teacherStatus = null;
    state.cloud = null;
    state.rooms = [];
    state.callHistory = [];
    api.clearTeacherSession && api.clearTeacherSession();
    renderRooms();
    renderHistory();
    accountMenuBtn && accountMenuBtn.classList.add('hidden');
    showAccountOverlay();
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

  function setFaceLanUnavailable(unavailable) {
    document.getElementById('faceLanWarning')?.classList.toggle('hidden', !unavailable);
  }

  function closeFaceLan() {
    if (!state.faceLanWs) return;
    state.faceLanWs.onclose = null;
    state.faceLanWs.onerror = null;
    try { state.faceLanWs.close(); } catch (_error) {}
    state.faceLanWs = null;
  }

  function startFaceLan(room) {
    closeFaceLan();
    if (!room || !connectionCode.isValid(room.connectionCode)) { setFaceLanUnavailable(true); return; }
    let ip;
    try { ip = connectionCode.decode(room.connectionCode); } catch (_error) { setFaceLanUnavailable(true); return; }
    const faceWs = new WebSocket(`ws://${ip}:3456`);
    state.faceLanWs = faceWs;
    let verified = false;
    const timer = setTimeout(() => { if (!verified) { setFaceLanUnavailable(true); try { faceWs.close(); } catch (_error) {} } }, 8000);
    faceWs.onopen = () => faceWs.send(JSON.stringify({ type:'connect', connectionId:state.account.connectionId, name:state.account.name, subjects:room.subjects || [] }));
    faceWs.onmessage = event => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (_error) { return; }
      if (msg.type === 'sync') {
        verified = true; clearTimeout(timer); setFaceLanUnavailable(false);
        state.studentStatus = msg.attendance || []; state.pendingFaces = msg.pendingFaces || []; renderFaceDetections();
      } else if (msg.type === 'face-detections') { state.faceDetections = msg.detections || []; renderFaceDetections(); }
      else if (msg.type === 'pending-face-library') { state.pendingFaces = msg.faces || []; renderFaceDetections(); }
      else if (msg.type === 'face-status') { state.studentStatus = msg.attendance || []; renderFaceDetections(); }
      else if (msg.type === 'face-labeled') { state.pendingFaces = (state.pendingFaces || []).filter(face => face.faceId !== msg.faceId); renderFaceDetections(); }
      else if (['approval-required','login-required','auth-required','subject-required'].includes(msg.type)) setFaceLanUnavailable(true);
    };
    faceWs.onerror = () => { clearTimeout(timer); setFaceLanUnavailable(true); };
    faceWs.onclose = () => { clearTimeout(timer); if (state.faceLanWs === faceWs) { state.faceLanWs = null; setFaceLanUnavailable(true); } };
  }

  function connect(codeValue, options = {}) {
    const explicitRoom = codeValue && typeof codeValue === 'object' ? codeValue : null;
    const cloudRoom = explicitRoom && explicitRoom.transport === 'cloud' ? explicitRoom : null;
    const formattedCode = cloudRoom ? String(cloudRoom.cloudClassroomId) : connectionCode.format(explicitRoom ? explicitRoom.connectionCode : codeValue);
    let ip = '';
    if (!cloudRoom) {
      try { ip = connectionCode.decode(formattedCode); }
      catch (error) {
        setStatus('offline', '连接码有误');
        openConnectRoomModal();
        setConnectRoomState(error.message || '连接码有误，请检查后重新输入', true, false);
        if (connectionCodeInput) { connectionCodeInput.focus(); connectionCodeInput.select(); }
        return;
      }
    }
    if (!state.account) {
      state.pendingRoomCode = formattedCode;
      showAccountOverlay();
      return;
    }
    const savedRoom = explicitRoom || state.rooms.find(room => room.connectionCode === formattedCode);
    let requestedSubjects = (savedRoom && savedRoom.subjects || []).map(value => String(value).trim()).filter(Boolean);
    if (!requestedSubjects.length && options.isRetry) requestedSubjects = [...(state.pendingConnectSubjects || [])];
    if (!requestedSubjects.length) {
      const subjectInput = document.getElementById('connectSubjectInput');
      requestedSubjects = [...connectSubjectSelection];
      if (!requestedSubjects.length) {
        openConnectRoomModal();
        setConnectRoomState('请先选择至少一个授课科目', true, false);
        if (subjectInput) subjectInput.focus();
        return;
      }
      if (savedRoom) {
        savedRoom.subjects = requestedSubjects;
        saveToDisk();
      }
    }
    state.pendingConnectSubjects = [...requestedSubjects];
    if (connectionCodeInput && !cloudRoom) connectionCodeInput.value = formattedCode;

    // 断开旧连接；自动重连时保留本轮失败次数，手动连接时重新计数。
    if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
    if (!options.isRetry) resetConnectionFailures();
    if (state.reconnectPaused && options.isRetry) return;
    if (state.ws) {
      state.ws.onclose = null;
      state.ws.onerror = null;
      state.ws.close();
      state.ws = null;
    }
    resetRoomWorkspace(false);

    // 连接尚未完成时也立即记录用户选择的教室，避免失败后仍沿用旧教室界面。
    state.connectingRoomCode = formattedCode;
    state.currentRoom = cloudRoom || state.rooms.find(room => room.connectionCode === formattedCode) || null;
    renderRooms();

    setStatus('connecting', '连接中…');
    setConnectRoomState('正在查找教室…', false, true);
    const useCloud = savedRoom && savedRoom.transport === 'cloud' && state.cloud && state.cloud.accessToken;
    const url = `ws://${ip}:3456`;
    let ws;
    try {
      ws = useCloud
        ? new CloudClassroomSocket({ serverUrl:state.cloud.serverUrl, accessToken:state.cloud.accessToken, accessExpiresAt:state.cloud.accessExpiresAt, refreshToken:state.cloud.refreshToken, classroomId:savedRoom.cloudClassroomId, onSession:session => { state.cloud={ ...state.cloud, ...session }; api.setCloudSettings && api.setCloudSettings(state.cloud); } })
        : new WebSocket(url);
    }
    catch (error) { state.ws = null; recordConnectionFailure(error, formattedCode); return; }

    state.ws = ws;
    let failureRecorded = false;
    let verificationTimer = setTimeout(() => failAttempt(new Error('教室端身份验证超时')), 8000);

    function failAttempt(error) {
      if (failureRecorded || state.ws !== ws) return;
      failureRecorded = true;
      if (state.pendingLeave && state.pendingLeave.code === formattedCode) state.pendingLeave.reject(error);
      if (verificationTimer) clearTimeout(verificationTimer);
      verificationTimer = null;
      state.ws = null;
      ws.onclose = null;
      ws.onerror = null;
      try { ws.close(); } catch (_error) {}
      resetRoomWorkspace(true);
      renderRooms();
      setConnectRoomState(error.message || '无法建立教室连接', true, false);
      recordConnectionFailure(error, formattedCode);
    }

    ws.onopen = () => {
      setStatus('connecting', '正在同步…');
      setConnectRoomState('已找到教室，正在验证教师身份…', false, true);
      ws.send(JSON.stringify({
        type: 'connect',
        connectionId: state.account.connectionId,
        name: state.account.name,
        subjects: requestedSubjects,
      }));
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (verificationTimer) clearTimeout(verificationTimer);
      verificationTimer = null;
      resetConnectionFailures();

      if (msg.type === 'leave-classroom-ack') {
        if (state.pendingLeave && state.pendingLeave.code === formattedCode) state.pendingLeave.resolve(msg);
      } else if (msg.type === 'membership-revoked') {
        const revokedCode = state.currentRoom && state.currentRoom.connectionCode;
        disconnect();
        if (revokedCode) {
          state.rooms = state.rooms.filter(room => room.connectionCode !== revokedCode);
          renderRooms();
          saveToDisk();
        }
        alert(msg.message || '当前教师已退出教室，教室端记录已删除');
      } else if (msg.type === 'sync') {
        const name = msg.className || (cloudRoom ? cloudRoom.name : `教室 ${formattedCode}`);
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
        homeworkStage = 'pending';
        homeworkContentType = 'homework';
        state.teacherStatus = msg.teacher || null;
        if (!isHomeroomTeacher()) {
          const allowedSubjects = new Set((state.teacherStatus && state.teacherStatus.subjects || []).map(String));
          state.assignments = state.assignments.filter(assignment => allowedSubjects.has(String(assignment.subject || '')));
          state.subjects = Array.from(allowedSubjects);
          state.teachers = { approved: [], pending: [] };
          state.pendingFaces = [];
        }
        state.pendingRoomCode = '';
        state.pendingConnectSubjects = [];
        state.connectingRoomCode = formattedCode;
        hideApprovalOverlay();

        // 自动添加到教室列表
        if (cloudRoom) {
          cloudRoom.name = name;
          if (requestedSubjects.length) cloudRoom.subjects = [...requestedSubjects];
          saveToDisk();
        } else addOrUpdateRoom(formattedCode, name, requestedSubjects);
        state.currentRoom = cloudRoom || state.rooms.find(r => r.connectionCode === formattedCode) || null;
        renderRooms();
        applyTeacherPermissions();

        setStatus('online', '已连接');
        showRoomUI(name);
        renderStudents();
        renderHomework();
        renderFaceDetections();
        renderClassroomManagement();
        if (useCloud) startFaceLan(savedRoom);
        else setFaceLanUnavailable(false);
        if (isHomeroomTeacher() && !state.classroomConfigured) showClassroomSetup();
        else hideClassroomSetup();
      } else if (msg.type === 'approval-required') {
        const name = msg.className || (cloudRoom ? cloudRoom.name : `教室 ${formattedCode}`);
        state.teacherStatus = msg.teacher || { status: 'pending' };
        state.pendingRoomCode = formattedCode;
        if (!cloudRoom) awaitRoomSave(formattedCode, name, requestedSubjects);
        setStatus('connecting', '等待管理员审核');
        closeConnectRoomModal();
        setConnectRoomState('', false, false);
        showApprovalOverlay(name, msg.message);
      } else if (msg.type === 'approval-rejected') {
        setStatus('offline', '审核未通过');
        showApprovalOverlay(msg.className || ip, msg.message || '管理员未批准此账户，请联系教室管理员。');
      } else if (msg.type === 'login-required') {
        setStatus('offline', '身份无效');
        disconnect();
        showAccountOverlay();
        alert(msg.message || '教师身份已失效，请使用小程序重新扫码登录');
      } else if (msg.type === 'auth-required') {
        if (classroomSetupOverlay && !classroomSetupOverlay.classList.contains('hidden')) {
          setupError.textContent = msg.message || '教室配置未保存，请检查后重试';
          setupError.classList.remove('hidden');
          completeSetupBtn.disabled = false;
          completeSetupBtn.textContent = '保存并启用教室';
        } else {
          alert(msg.message || '当前账户没有执行此操作的权限');
        }
      } else if (msg.type === 'delivery-unavailable') {
        alert(msg.message || '教室端当前离线，本次操作未送达');
      } else if (msg.type === 'subject-required') {
        const room = cloudRoom || state.rooms.find(item => item.connectionCode === formattedCode);
        if (room) { room.subjects = []; saveToDisk(); }
        setStatus('offline', '需要设置授课科目');
        disconnect();
        openConnectRoomModal();
        setConnectRoomState(msg.message || '请重新选择授课科目后连接', true, false);
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
      failAttempt(new Error('教室连接已断开'));
    };

    ws.onerror = () => failAttempt(new Error('无法建立教室连接'));
  }

  async function awaitRoomSave(code, name, subjects) {
    await addOrUpdateRoom(code, name, subjects);
    state.currentRoom = state.rooms.find(room => room.connectionCode === code) || null;
    renderRooms();
  }

  function disconnect() {
    if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
    resetConnectionFailures();
    closeFaceLan();
    if (state.ws) {
      state.ws.onclose = null;
      state.ws.close();
      state.ws = null;
    }
    resetRoomWorkspace(false);
    setStatus('offline', '未连接');
    renderRooms();
  }

  function resetRoomWorkspace(keepSelectedRoom) {
    if (!keepSelectedRoom) state.currentRoom = null;
    state.students    = [];
    state.className   = '';
    state.subjects    = [];
    state.assignments = [];
    state.studentStatus = [];
    state.faceDetections = [];
    state.pendingFaces = [];
    state.pendingLabelFace = null;
    state.teacherStatus = null;
    state._faceRecvCount = 0;
    state._faceRecvLast = 0;
    state._faceRecvAt = 0;
    state.classroomConfigured = false;
    state.teachers = { approved: [], pending: [] };
    state.pendingRoomCode = '';
    if (!keepSelectedRoom) state.connectingRoomCode = '';
    state.searchQuery = '';
    selectedSubjects = [];
    selectedAssigns = [];
    homeworkStage = 'pending';
    homeworkContentType = 'homework';
    state.editingAssignmentId = null;
    Object.values(state.callTimers).forEach(timer => clearTimeout(timer));
    state.callTimers = {};
    if (searchInput) searchInput.value = '';
    if (hwStatusFilter) hwStatusFilter.value = '';
    if (hwDateFrom) hwDateFrom.value = '';
    if (hwDateTo) hwDateTo.value = '';
    if (labelModal) labelModal.classList.add('hidden');
    if (hwModal) hwModal.classList.add('hidden');
    hideClassroomSetup();
    hideRoomUI();
    renderStudents();
    renderHomework();
    renderFaceDetections();
    applyTeacherPermissions();
  }

  function resetConnectionFailures() {
    state.reconnectAttempts = 0;
    state.consecutiveFailures = 0;
    state.reconnectPaused = false;
    state.failurePromptShown = false;
  }

  function connectionFailureDetail(error, code) {
    const message = String(error && error.message || '无法建立连接');
    if (/超时/.test(message)) return `连接码 ${code} · 连接超时`;
    if (/断开/.test(message)) return `连接码 ${code} · 教室连接已断开`;
    return `连接码 ${code} · 教室端未启动、网络不可达或被防火墙拦截`;
  }

  function showConnectionFailureGuide(code) {
    if (state.failurePromptShown) return;
    state.failurePromptShown = true;
    const room = state.rooms.find(item => item.connectionCode === code);
    const roomName = room && room.name || '当前教室';
    reportClientError('连续多次无法连接教室', new Error(`教室：${roomName}\n连接码：${code}\n${connectionFailureDetail(null, code)}\n已尝试：${MAX_CONNECT_ATTEMPTS} 次`), {
      context:'局域网教室连接',
      message:`已连续尝试 ${MAX_CONNECT_ATTEMPTS} 次，仍无法连接“${roomName}”，自动重连已暂停。`,
      suggestions:['确认教室端已经启动并完成班主任绑定', '确认教师电脑和教室电脑位于同一局域网', '确认连接码一致，并允许 TCP 3456 端口通过防火墙', '检查校园网络是否启用了终端隔离或 VLAN 隔离'],
    });
    state.failurePromptShown = false;
  }

  function recordConnectionFailure(error, code) {
    state.consecutiveFailures += 1;
    const detail = connectionFailureDetail(error, code);
    setConnectRoomState(detail, true, false);
    if (state.consecutiveFailures >= MAX_CONNECT_ATTEMPTS) {
      state.reconnectPaused = true;
      if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
      setStatus('offline', `连续 ${MAX_CONNECT_ATTEMPTS} 次连接失败`);
      showConnectionFailureGuide(code);
      return;
    }
    setStatus('offline', `连接失败 (${state.consecutiveFailures}/${MAX_CONNECT_ATTEMPTS})`);
    console.warn('[teacher] classroom connection failed:', detail);
    scheduleReconnect(code);
  }

  function scheduleReconnect(code) {
    if (state.reconnectTimer || state.reconnectPaused) return;
    const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 30000);
    state.reconnectAttempts++;
    setStatus('connecting', `准备重连 (${state.consecutiveFailures}/${MAX_CONNECT_ATTEMPTS})…`);
    setConnectRoomState(`连接失败，稍后自动重试（${state.consecutiveFailures}/${MAX_CONNECT_ATTEMPTS}）…`, true, true);
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      connect(code, { isRetry: true });
    }, delay);
  }

  function setStatus(cls, text) {
    if (connDot)   connDot.className   = `dot ${cls}`;
    if (connLabel) connLabel.textContent = text;
  }

  // ═══════════════════════════════════
  //  教室列表
  // ═══════════════════════════════════

  async function addOrUpdateRoom(code, name, subjects = []) {
    const existing = state.rooms.find(r => r.connectionCode === code);
    if (existing) {
      existing.name = name;
      if (subjects.length) existing.subjects = [...subjects];
    } else {
      state.rooms.push({ id: genId(), connectionCode: code, name, subjects:[...subjects] });
    }
    await saveToDisk();
  }

  function renderRooms() {
    if (!roomList || !noRooms) return;
    roomList.innerHTML = '';

    if (state.rooms.length === 0) {
      noRooms.style.display = 'flex';
      return;
    }
    noRooms.style.display = 'none';

    state.rooms.forEach(room => {
      const li = document.createElement('li');
      const isActive = state.currentRoom && state.currentRoom.id === room.id;
      li.className = 'room-item' + (isActive ? ' active' : '');
      const pendingApproval = isActive && state.teacherStatus && state.teacherStatus.status === 'pending';
      const connected = isActive && !pendingApproval && state.ws && state.ws.readyState === WebSocket.OPEN;
      const cls = connected ? 'online' : (isActive && !state.reconnectPaused ? 'connecting' : 'offline');
      const statusText = pendingApproval ? '待审核' : (connected ? '已连接' : (isActive && !state.reconnectPaused ? '连接中' : (room.transport === 'cloud' && room.cloudStatus === 'online' ? '云端在线' : '未连接')));
      const avatar = String(room.name || '教').trim().slice(0, 1) || '教';

      li.innerHTML =
        `<span class="room-avatar" aria-hidden="true">${esc(avatar)}</span>` +
        `<span class="room-copy"><strong class="room-name">${esc(room.name)}</strong><small class="room-ip">${room.transport === 'cloud' ? '组织教室' : `连接码 ${esc(room.connectionCode)}`}</small></span>` +
        `<span class="room-presence"><i class="dot ${cls}"></i><small>${statusText}</small></span>` +
        `<button class="room-del" data-code="${esc(room.connectionCode)}" type="button" aria-label="退出${esc(room.name)}" title="退出教室">×</button>`;

      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('room-del')) return;
        connect(room);
      });

      const del = li.querySelector('.room-del');
      if (del) del.addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeRoom(room);
      });

      roomList.appendChild(li);
    });
  }

  function sendLeaveRequest(ws, code) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (state.pendingLeave && state.pendingLeave.code === code) state.pendingLeave = null;
        reject(new Error('等待教室端确认超时'));
      }, 8000);
      state.pendingLeave = {
        code,
        resolve(message) { clearTimeout(timer); state.pendingLeave = null; resolve(message); },
        reject(error) { clearTimeout(timer); state.pendingLeave = null; reject(error); },
      };
      try { ws.send(JSON.stringify({ type: 'leave-classroom' })); }
      catch (error) { state.pendingLeave.reject(error); }
    });
  }

  function requestClassroomLeave(room) {
    const code = room.transport === 'cloud' ? room.cloudClassroomId : room.connectionCode;
    const activeRoom = state.currentRoom && state.currentRoom.id === room.id;
    if (activeRoom && state.ws && state.ws.readyState === WebSocket.OPEN) {
      return sendLeaveRequest(state.ws, code);
    }
    return new Promise((resolve, reject) => {
      let ws;
      try {
        if (room.transport === 'cloud') {
          if (!state.cloud) throw new Error('云服务登录已失效');
          ws = new CloudClassroomSocket({ serverUrl:state.cloud.serverUrl, accessToken:state.cloud.accessToken, accessExpiresAt:state.cloud.accessExpiresAt, refreshToken:state.cloud.refreshToken, classroomId:room.cloudClassroomId, onSession:session => { state.cloud={ ...state.cloud, ...session }; api.setCloudSettings && api.setCloudSettings(state.cloud); } });
        } else ws = new WebSocket(`ws://${connectionCode.decode(code)}:3456`);
      } catch (error) { reject(error); return; }
      let finished = false;
      let authenticated = false;
      const timer = setTimeout(() => finish(new Error('无法连接教室端，退出操作尚未完成')), 8000);
      function finish(error, message) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null;
        try { ws.close(); } catch (_error) {}
        if (error) reject(error); else resolve(message);
      }
      ws.onopen = () => ws.send(JSON.stringify({
        type: 'connect',
        connectionId: state.account.connectionId,
        name: state.account.name,
        subjects: room.subjects || [],
      }));
      ws.onmessage = event => {
        let message;
        try { message = JSON.parse(event.data); } catch (_error) { return; }
        if ((message.type === 'sync' || message.type === 'approval-required') && !authenticated) {
          authenticated = true;
          ws.send(JSON.stringify({ type: 'leave-classroom' }));
        } else if (message.type === 'leave-classroom-ack') finish(null, message);
        else if (['login-required', 'auth-required', 'subject-required'].includes(message.type)) finish(new Error(message.message || '教室端拒绝退出请求'));
      };
      ws.onerror = () => finish(new Error('无法连接教室端，退出操作尚未完成'));
      ws.onclose = () => { if (!finished) finish(new Error('教室连接已断开，退出操作尚未完成')); };
    });
  }

  async function removeRoom(roomInput) {
    if (state.leavingRoomCode) return;
    const room = roomInput && typeof roomInput === 'object' ? roomInput : state.rooms.find(item => item.connectionCode === roomInput);
    if (!room || !state.account) return;
    const code = room.transport === 'cloud' ? room.cloudClassroomId : room.connectionCode;
    const homeroomWarning = state.currentRoom && state.currentRoom.id === room.id && isHomeroomTeacher()
      ? '\n\n你是该教室的班主任。退出后教室端会重新进入班主任绑定引导，但班级资料不会被删除。'
      : '';
    if (!confirm(`确定退出“${room.name}”吗？\n\n教室端会同时删除你的教师记录；以后需要重新扫码或输入连接码加入。${homeroomWarning}`)) return;
    state.leavingRoomCode = code;
    try {
      await requestClassroomLeave(room);
    } catch (error) {
      reportClientError('无法退出教室', error, { context:'退出教室', message:'无法通知教室端，本次没有删除本地教室，以避免两端记录不一致。', suggestions:[room.transport === 'cloud' ? '检查云服务连接后重试' : '确认教室端已启动，且两台电脑位于同一局域网'] });
      return;
    } finally {
      state.leavingRoomCode = '';
    }
    if (state.currentRoom && state.currentRoom.id === room.id) disconnect();
    state.rooms = state.rooms.filter(r => r.id !== room.id);
    renderRooms();
    await saveToDisk();
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
    setConnectRoomState('', false, false);
    closeConnectRoomModal();
    switchMainTab('overview');
    renderOverview();
  }

  function openConnectRoomModal() {
    const modal = document.getElementById('connectRoomModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    setTimeout(() => connectionCodeInput && connectionCodeInput.focus(), 0);
  }

  function closeConnectRoomModal() {
    document.getElementById('connectRoomModal')?.classList.add('hidden');
  }

  function setConnectRoomState(message, isError, busy) {
    const status = document.getElementById('connectRoomStatus');
    if (status) {
      status.textContent = message || '';
      status.classList.toggle('is-error', !!isError);
      status.classList.toggle('is-success', !isError && !!message && !busy);
    }
    if (connectBtn) {
      connectBtn.disabled = !!busy;
      connectBtn.textContent = busy ? '正在连接…' : '连接教室';
    }
  }

  function setAnimatedText(element, value) {
    if (!element) return;
    const next = String(value);
    if (element.textContent === next) return;
    element.textContent = next;
    element.classList.remove('value-updated');
    requestAnimationFrame(() => element.classList.add('value-updated'));
  }

  function renderOverview() {
    const studentCountEl = document.getElementById('overviewStudentCount');
    const homeworkCountEl = document.getElementById('overviewHomeworkCount');
    const presentCountEl = document.getElementById('overviewPresentCount');
    const subjectCountEl = document.getElementById('overviewSubjectCount');
    const subjectHintEl = document.getElementById('overviewSubjectHint');
    const completionRateEl = document.getElementById('overviewCompletionRate');
    const completionHintEl = document.getElementById('overviewCompletionHint');
    const attendanceHintEl = document.getElementById('overviewAttendanceHint');
    const roleBadgeEl = document.getElementById('overviewRoleBadge');
    const subjectTextEl = document.getElementById('overviewSubjectText');
    const subjectProgressEl = document.getElementById('overviewSubjectProgress');
    const greetingEl = document.getElementById('overviewGreeting');
    const summaryEl = document.getElementById('overviewSummary');
    const todayListEl = document.getElementById('overviewTodayList');
    if (!studentCountEl || !homeworkCountEl || !presentCountEl || !subjectProgressEl || !todayListEl) return;

    const students = state.students || [];
    const assignments = state.assignments || [];
    const teacherSubjects = Array.from(new Set(((state.teacherStatus && state.teacherStatus.subjects) || [])
      .map(subject => String(subject || '').trim()).filter(Boolean)));
    const subjectSet = new Set(teacherSubjects);
    const scopedItems = assignments.filter(item => subjectSet.has(String(item.subject || '').trim()));
    const activeItems = scopedItems
      .filter(item => homeworkView.stageOf(item) === 'pending')
      .sort((a, b) => String(a.deadline || '').localeCompare(String(b.deadline || '')));
    const activeHomework = activeItems.filter(item => homeworkView.typeOf(item) === 'homework');
    const presentIds = new Set((state.faceDetections || []).filter(face => face.isRecognized && face.studentId).map(face => face.studentId));
    const recentBoundary = Date.now() - 30 * 86400000;
    const recentClosedHomework = scopedItems.filter(item => {
      if (homeworkView.typeOf(item) !== 'homework' || homeworkView.stageOf(item) !== 'closed') return false;
      const deadline = homeworkView.parseLocalDateTime(item.deadline);
      return deadline && deadline.getTime() >= recentBoundary;
    });
    const recentTotals = recentClosedHomework.reduce((totals, item) => {
      const summary = homeworkView.submissionSummary(item, students);
      totals.completed += summary.completed;
      totals.required += Math.max(0, summary.total - summary.exempt);
      return totals;
    }, { completed: 0, required: 0 });
    const recentRate = recentTotals.required ? Math.round(recentTotals.completed / recentTotals.required * 100) : null;
    const hour = new Date().getHours();
    const period = hour < 11 ? '上午好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';

    setAnimatedText(studentCountEl, students.length);
    setAnimatedText(homeworkCountEl, activeHomework.length);
    setAnimatedText(presentCountEl, presentIds.size);
    setAnimatedText(subjectCountEl, teacherSubjects.length);
    if (subjectHintEl) subjectHintEl.textContent = teacherSubjects.length ? teacherSubjects.join('、') : '等待科目授权';
    setAnimatedText(completionRateEl, recentRate === null ? '--' : `${recentRate}%`);
    if (completionHintEl) completionHintEl.textContent = recentClosedHomework.length ? `近 30 天 ${recentClosedHomework.length} 项已截止作业` : '暂无已截止作业';
    if (attendanceHintEl) attendanceHintEl.textContent = students.length ? `${Math.max(0, students.length - presentIds.size)} 人当前未到` : '等待学生名单同步';
    if (roleBadgeEl) roleBadgeEl.textContent = isHomeroomTeacher() ? '班主任' : '任课教师';
    if (subjectTextEl) subjectTextEl.textContent = teacherSubjects.length ? teacherSubjects.join(' · ') : '暂未设置授课科目';
    if (greetingEl) greetingEl.textContent = `${period}，${state.account && state.account.name ? state.account.name : '老师'}`;
    if (summaryEl) {
      const notices = activeItems.filter(item => homeworkView.typeOf(item) === 'notice').length;
      summaryEl.textContent = !teacherSubjects.length
        ? '请先完成授课科目设置，工作台将自动生成与你相关的教学数据。'
        : activeHomework.length || notices
          ? `你的学科当前有 ${activeHomework.length} 项待提交作业${notices ? `，${notices} 条生效中通知` : ''}。`
          : '你的学科当前没有待处理内容，可以开始课堂教学。';
    }

    if (!teacherSubjects.length) {
      subjectProgressEl.innerHTML = '<div class="dashboard-empty"><span>科</span><div><strong>尚未设置授课科目</strong><small>完成科目设置后，这里会按学科展示作业数量和完成率。</small></div></div>';
    } else {
      subjectProgressEl.innerHTML = teacherSubjects.map(subject => {
        const subjectHomework = scopedItems.filter(item => item.subject === subject && homeworkView.typeOf(item) === 'homework');
        const pending = subjectHomework.filter(item => homeworkView.stageOf(item) === 'pending').length;
        const closed = subjectHomework.filter(item => homeworkView.stageOf(item) === 'closed');
        const totals = closed.reduce((result, item) => {
          const summary = homeworkView.submissionSummary(item, students);
          result.completed += summary.completed;
          result.required += Math.max(0, summary.total - summary.exempt);
          return result;
        }, { completed: 0, required: 0 });
        const rate = totals.required ? Math.round(totals.completed / totals.required * 100) : null;
        const progress = rate === null ? 0 : rate;
        return `<button class="subject-progress-item" type="button" data-open-tab="homework" data-dashboard-subject="${esc(subject)}"><span class="subject-progress-badge">${esc(subject.slice(0, 1))}</span><span class="subject-progress-main"><span><strong>${esc(subject)}</strong><small>${pending} 项待提交 · ${closed.length} 项已统计</small></span><span class="subject-progress-track"><i style="width:${progress}%"></i></span></span><b>${rate === null ? '--' : `${rate}%`}</b></button>`;
      }).join('');
    }

    if (!activeItems.length) {
      todayListEl.innerHTML = '<div class="dashboard-empty is-success"><span>✓</span><div><strong>暂无待处理内容</strong><small>与你授课科目相关的新作业和通知会显示在这里。</small></div></div>';
      return;
    }
    todayListEl.innerHTML = activeItems.slice(0, 4).map(item => {
      const isNotice = homeworkView.typeOf(item) === 'notice';
      return `<div class="overview-list-item"><span>${isNotice ? '通' : '作'}</span><div><strong>${esc(item.title)}</strong><small>${esc(item.subject || (isNotice ? '班级通知' : '未设置学科'))}</small></div><time>${item.deadline ? esc(formatDeadline(item.deadline)) : '未设置时间'}</time></div>`;
    }).join('');
  }

  function isHomeroomTeacher() { return !!(state.teacherStatus && state.teacherStatus.role === '班主任'); }
  function canModifySubject(_subject) { return isHomeroomTeacher(); }

  function applyTeacherPermissions() {
    const homeroom = isHomeroomTeacher();
    document.getElementById('overviewTabBtn')?.classList.remove('hidden');
    document.getElementById('callTabBtn')?.classList.toggle('hidden', !homeroom);
    if (classroomTabBtn) classroomTabBtn.classList.toggle('hidden', !homeroom);
    document.querySelectorAll('[data-permission="homeroom"]').forEach(element => element.classList.toggle('hidden', !homeroom));
    document.querySelector('.workspace-tool-grid')?.classList.toggle('is-teacher-view', !homeroom);
    if (addAssignmentBtn2) addAssignmentBtn2.classList.toggle('hidden', !homeroom);
    if (publishNoticeBtn) publishNoticeBtn.classList.toggle('hidden', !homeroom);
    document.getElementById('homeworkReadOnlyNote')?.classList.toggle('hidden', homeroom);
    const unknownFaceTab = document.querySelector('.face-subtab[data-subtab="unknown"]');
    const registeredFaceTab = document.querySelector('.face-subtab[data-subtab="registered"]');
    if (unknownFaceTab) unknownFaceTab.classList.toggle('hidden', !homeroom);
    if (!homeroom && unknownFaceTab?.classList.contains('active') && registeredFaceTab) registeredFaceTab.click();
    const activeTab = document.querySelector('.main-tab.active')?.dataset.tab;
    if (!homeroom && !['overview', 'homework', 'attendance'].includes(activeTab)) switchMainTab('overview');
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
    state.ws.send(JSON.stringify({ type: 'update-classroom', classroom: { className, students: parsed.students, subjects:(state.teacherStatus && state.teacherStatus.subjects) || [] } }));
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
        <div class="teacher-manage-actions">${homeroom ? `<button class="btn" data-teacher-action="edit" data-id="${esc(teacher.connection_id)}">设置科目</button>` : `<button class="btn" data-teacher-action="edit" data-id="${esc(teacher.connection_id)}">科目授权</button><button class="btn btn-transfer-text" data-teacher-action="transfer" data-id="${esc(teacher.connection_id)}">转让班主任</button><button class="btn btn-danger-text" data-teacher-action="remove" data-id="${esc(teacher.connection_id)}">移除</button>`}</div>
      </div>`;
    }).join('') : '<div class="teacher-manage-empty">暂无已加入教师</div>';
  }

  function sendTeacherManagement(action, connectionId, subjects) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) { alert('教室连接已断开'); return; }
    state.ws.send(JSON.stringify({ type: 'manage-teacher', action, connectionId, subjects: subjects || [] }));
  }

  function hideRoomUI() {
    multiCallMode = false;
    selectedCallStudentIds.clear();
    updateCallBatchUI();
    // 离线状态始终回到概览，不能停留在上一教室的作业/出勤页面。
    switchMainTab('overview');
    if (mainTabs)   mainTabs.classList.add('hidden');
    if (roomHeader) roomHeader.classList.add('hidden');
    if (msgRow)     msgRow.classList.add('hidden');
    if (searchRow)  searchRow.classList.add('hidden');
    if (callFlow)   callFlow.classList.add('hidden');
    if (emptyState) emptyState.style.display = '';
    if (roomTitle)  roomTitle.textContent = '';
    renderOverview();
  }

  function renderStudents() {
    if (!studentGrid) return;
    studentGrid.innerHTML = '';
    if (studentCount) studentCount.textContent = '';
    if (searchResult) searchResult.textContent = '';

    if (!state.currentRoom || state.students.length === 0) { updateCallBatchUI(); renderOverview(); return; }

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
      const selected = selectedCallStudentIds.has(s.id);
      card.className = `student-card${selected ? ' selected' : ''}`;
      card.innerHTML = `<div class="stu-name">${esc(s.name)}</div>`;

      const btn = document.createElement('button');
      btn.className = 'call-btn';
      btn.textContent = multiCallMode ? (selected ? '✓ 已选择' : '选择') : '呼叫';
      btn.addEventListener('click', () => multiCallMode ? toggleCallStudent(s.id) : callStudent(s, btn));
      card.appendChild(btn);
      studentGrid.appendChild(card);
    });
    updateCallBatchUI();
    renderOverview();
  }

  // ═══════════════════════════════════
  //  呼叫
  // ═══════════════════════════════════

  function callStudent(student, btnEl) {
    if (!sendCallToStudents([student])) return;
    btnEl.classList.add('called');
    btnEl.textContent = '✓ 已发送';
    clearTimeout(state.callTimers[student.name]);
    state.callTimers[student.name] = setTimeout(() => {
      btnEl.classList.remove('called');
      btnEl.textContent = '呼叫';
    }, 5000);
  }

  function formatCallTarget(students) {
    const base = students.map(student => student.name).join('、');
    return { base, display:base };
  }

  function sendCallToStudents(students) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      alert('未连接到教室，请先输入连接码并连接');
      return false;
    }
    if (!students.length) return false;

    const callId = genId();
    const rawMsg = (callMessageInp && callMessageInp.value.trim()) || '{name}同学，请到办公室';
    const target = formatCallTarget(students);
    const studentName = target.display;
    const studentNames = students.map(student => student.name);
    const msg = rawMsg.replace(/\{name\}同学/g, `${target.base}同学`).replace(/\{name\}/g, studentName);

    state.ws.send(JSON.stringify({
      type: 'call', callId,
      studentName,
      studentNames,
      className: state.className,
      message: msg,
    }));

    state.callHistory.unshift({
      id: callId,
      roomName: state.className || (state.currentRoom ? state.currentRoom.name : ''),
      studentName,
      time: new Date().toISOString(),
      status: 'sent',
    });
    if (state.callHistory.length > MAX_HISTORY) state.callHistory.length = MAX_HISTORY;
    renderHistory();
    saveToDisk();
    return true;
  }

  function updateCallBatchUI() {
    if (multiCallToggle) {
      multiCallToggle.classList.toggle('active', multiCallMode);
      multiCallToggle.textContent = multiCallMode ? '取消多选' : '多选呼叫';
    }
    if (callSelectionHint) callSelectionHint.textContent = multiCallMode ? '勾选多名学生后统一发送' : '点击学生卡片中的呼叫按钮即可发送';
    if (callBatchBar) callBatchBar.classList.toggle('hidden', !multiCallMode);
    if (callBatchCount) callBatchCount.textContent = `已选 ${selectedCallStudentIds.size} 人`;
    if (sendBatchCall) sendBatchCall.disabled = selectedCallStudentIds.size === 0;
    if (clearCallSelection) clearCallSelection.disabled = selectedCallStudentIds.size === 0;
  }

  function toggleCallMultiMode() {
    multiCallMode = !multiCallMode;
    if (!multiCallMode) selectedCallStudentIds.clear();
    renderStudents();
  }

  function toggleCallStudent(studentId) {
    if (selectedCallStudentIds.has(studentId)) selectedCallStudentIds.delete(studentId);
    else selectedCallStudentIds.add(studentId);
    renderStudents();
  }

  function clearSelectedCallStudents() {
    selectedCallStudentIds.clear();
    renderStudents();
  }

  function sendSelectedCallStudents() {
    const students = state.students.filter(student => selectedCallStudentIds.has(student.id));
    if (!students.length || !sendCallToStudents(students)) return;
    selectedCallStudentIds.clear();
    multiCallMode = false;
    renderStudents();
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
    const attendanceTotalCount = document.getElementById('attendanceTotalCount');
    const attendancePresentCount = document.getElementById('attendancePresentCount');
    const attendanceAbsentCount = document.getElementById('attendanceAbsentCount');
    const attendancePendingCount = document.getElementById('attendancePendingCount');

    if (!faceGridUnknown || !faceGridRegistered) return;

    const detections = state.faceDetections || [];
    const students = state.students || [];
    if (faceRoomName) faceRoomName.textContent = state.className ? `${state.className}出勤` : '班级出勤';

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
    const absentCount = Math.max(0, totalRegistered - presentCount);
    setAnimatedText(attendanceTotalCount, totalRegistered);
    setAnimatedText(attendancePresentCount, presentCount);
    setAnimatedText(attendanceAbsentCount, absentCount);
    setAnimatedText(attendancePendingCount, unknownCards.length);
    if (faceSummary) {
      if (totalRegistered > 0) {
        faceSummary.textContent = `实时更新 · ${presentCount}/${totalRegistered} 已到`;
      } else if (unknownCards.length > 0) {
        faceSummary.textContent = `${unknownCards.length} 张人脸待处理`;
      } else {
        faceSummary.textContent = '等待教室端同步';
      }
    }

    console.log('[teacher] rendered', unknownCards.length, 'unknown +', registeredCards.length, 'registered');

    // ═══════════════════════════════════════
    //  渲染「未标注」网格
    // ═══════════════════════════════════════
    if (unknownCards.length === 0) {
      faceGridUnknown.innerHTML = '<div class="attendance-empty is-success"><span>✓</span><strong>没有待匹配人脸</strong><small>新面孔出现后会自动显示在这里</small></div>';
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
      faceGridRegistered.innerHTML = '<div class="attendance-empty"><span>人</span><strong>暂无学生出勤数据</strong><small>先完成学生名单，并在“待匹配”中关联人脸</small></div>';
    } else {
      registeredCards.sort((a, b) => Number(b.isPresent) - Number(a.isPresent) || String(a.name).localeCompare(String(b.name), 'zh-CN'));
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
    renderOverview();
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
    const faceTransport = state.faceLanWs && state.faceLanWs.readyState === WebSocket.OPEN ? state.faceLanWs : state.ws;
    if (faceTransport && faceTransport.readyState === WebSocket.OPEN) {
      faceTransport.send(JSON.stringify({
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
    if (mainTabs) {
      mainTabs.classList.toggle('is-overview', name === 'overview');
      mainTabs.classList.toggle('is-detail', name !== 'overview');
    }
    if (name === 'overview') renderOverview();
  }

  function handleTabKeydown(event, buttons) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const buttonList = Array.from(buttons).filter(button => !button.classList.contains('hidden'));
    const current = buttonList.indexOf(event.currentTarget);
    const offset = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
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
      if (connectSubjectDrop && !document.getElementById('connectSubjectPicker')?.contains(e.target)) closeSubjectPicker(document.getElementById('connectSubjectInput'), connectSubjectDrop);
      if (teacherEditSubjectDrop && !document.getElementById('teacherEditSubjectPicker')?.contains(e.target)) closeSubjectPicker(teacherEditSubjects, teacherEditSubjectDrop);
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
    bindSubjectPicker(document.getElementById('connectSubjectInput'), connectSubjectDrop, () => connectSubjectSelection, value => { connectSubjectSelection = value; setConnectRoomState('', false, false); });
    bindSubjectPicker(teacherEditSubjects, teacherEditSubjectDrop, () => teacherEditSubjectSelection, value => { teacherEditSubjectSelection = value; });
  }

  function subjectOptionsWith(selected = []) { return Array.from(new Set([...SUBJECT_OPTIONS, ...selected.filter(Boolean)])); }

  function subjectPickerLabel(selected) {
    if (!selected.length) return '请选择授课科目 ▾';
    return selected.length <= 2 ? `${selected.join('、')} ▾` : `已选择 ${selected.length} 个科目 ▾`;
  }

  function closeSubjectPicker(button, drop) {
    drop?.classList.add('hidden');
    button?.classList.remove('open');
    button?.setAttribute('aria-expanded', 'false');
  }

  function renderSubjectPicker(button, drop, selected, onChange) {
    if (!button || !drop) return;
    button.textContent = subjectPickerLabel(selected);
    drop.innerHTML = subjectOptionsWith(selected).map(subject => `<label><input type="checkbox" value="${esc(subject)}" ${selected.includes(subject) ? 'checked' : ''}> ${esc(subject)}</label>`).join('') + '<div class="ms-actions"><button type="button" data-subject-action="clear">清除选择</button></div>';
    drop.querySelectorAll('input[type="checkbox"]').forEach(input => input.addEventListener('change', () => {
      const next = Array.from(drop.querySelectorAll('input[type="checkbox"]:checked')).map(item => item.value);
      onChange(next);
      button.textContent = subjectPickerLabel(next);
    }));
    drop.querySelector('[data-subject-action="clear"]')?.addEventListener('click', () => { onChange([]); renderSubjectPicker(button, drop, [], onChange); });
  }

  function bindSubjectPicker(button, drop, getSelected, onChange) {
    if (!button || !drop) return;
    button.addEventListener('click', event => {
      event.stopPropagation();
      const opening = drop.classList.contains('hidden');
      document.querySelectorAll('.subject-picker-drop').forEach(item => item.classList.add('hidden'));
      document.querySelectorAll('.subject-picker-button').forEach(item => { item.classList.remove('open'); item.setAttribute('aria-expanded','false'); });
      if (!opening) return;
      renderSubjectPicker(button, drop, getSelected(), onChange);
      drop.classList.remove('hidden'); button.classList.add('open'); button.setAttribute('aria-expanded','true');
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
    let hws = state.assignments.filter(a => homeworkView.typeOf(a) === homeworkContentType && homeworkView.stageOf(a) === homeworkStage);
    const from = hwDateFrom ? hwDateFrom.value : '';
    const to = hwDateTo ? hwDateTo.value : '';
    if (from) hws = hws.filter(a => homeworkView.dateKey(a.deadline) >= from);
    if (to) hws = hws.filter(a => homeworkView.dateKey(a.deadline) <= to);
    if (selectedSubjects.length > 0) hws = hws.filter(a => selectedSubjects.includes(a.subject));
    hws.sort((a, b) => homeworkView.dateKey(a.deadline).localeCompare(homeworkView.dateKey(b.deadline)));
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
    const hws = state.assignments.filter(a => homeworkView.typeOf(a) === homeworkContentType && homeworkView.stageOf(a) === homeworkStage);
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
    updateHomeworkStageBar();

    buildSubjectDrop();
    updateSubjectBtn();
    buildAssignDrop();
    updateAssignBtn();

    if (selectedAssigns.length === 1) {
      renderSingleAssignment(selectedAssigns[0]);
    } else {
      renderHomeworkList(null);
    }
    renderOverview();
  }

  // ── 辅助函数 ──

  function updateHomeworkStageBar() {
    const currentItems = state.assignments.filter(a => homeworkView.typeOf(a) === homeworkContentType);
    const pending = currentItems.filter(a => homeworkView.stageOf(a) === 'pending').length;
    const closed = currentItems.length - pending;
    if (hwPendingCount) hwPendingCount.textContent = pending;
    if (hwClosedCount) hwClosedCount.textContent = closed;
    [[hwStagePending, 'pending'], [hwStageClosed, 'closed']].forEach(([button, stage]) => {
      if (!button) return;
      const active = stage === homeworkStage;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    if (hwPendingLabel) hwPendingLabel.textContent = homeworkContentType === 'notice' ? '生效中通知' : '待提交作业';
    if (hwClosedLabel) hwClosedLabel.textContent = homeworkContentType === 'notice' ? '历史通知' : '提交统计';
    if (hwPendingHint) hwPendingHint.textContent = homeworkContentType === 'notice' ? '尚未到结束时间' : '尚未到截止时间';
    if (hwClosedHint) hwClosedHint.textContent = homeworkContentType === 'notice' ? '已到结束时间' : '已到截止时间';
    [[hwContentHomework, 'homework'], [hwContentNotice, 'notice']].forEach(([button, type]) => {
      if (button) button.classList.toggle('active', type === homeworkContentType);
    });
    if (hwStatusFilter) hwStatusFilter.classList.toggle('hidden', homeworkContentType === 'notice');
    if (exportHomeworkBtn) exportHomeworkBtn.classList.toggle('hidden', homeworkContentType === 'notice');
    if (aiHomeworkBtn) aiHomeworkBtn.classList.toggle('hidden', homeworkContentType === 'notice');
  }

  function setHomeworkContentType(type) {
    if (type !== 'homework' && type !== 'notice') return;
    homeworkContentType = type; homeworkStage = 'pending'; selectedAssigns = [];
    renderHomework();
  }

  function setHomeworkStage(stage) {
    if (stage !== 'pending' && stage !== 'closed') return;
    homeworkStage = stage;
    selectedAssigns = [];
    updateHomeworkStageBar();
    buildAssignDrop();
    updateAssignBtn();
    renderHomeworkList(null);
  }

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
    const summary = homeworkView.submissionSummary(a, state.students);
    let html = `<div class="hw-single-summary"><button class="hw-back-overview" type="button">← 返回${homeworkContentType === 'notice' ? (homeworkStage === 'pending' ? '生效中通知' : '历史通知') : (homeworkStage === 'pending' ? '待提交作业' : '提交统计')}</button><div><span>${esc(a.subject)} · ${homeworkContentType === 'notice' ? '班级通知' : '作业'}</span><strong>${esc(a.title)}</strong><small>${a.deadline ? `${homeworkContentType === 'notice' ? '结束' : '截止'} ${esc(formatDeadline(a.deadline))}` : '未设置时间'}</small></div>${homeworkContentType === 'notice' ? '<div class="notice-state-badge">' + (homeworkStage === 'pending' ? '生效中' : '已结束') + '</div>' : `<div class="hw-summary-numbers"><b>${summary.submitted}<small>已提交</small></b><b>${summary.pending}<small>待提交</small></b><b>${summary.late}<small>迟交</small></b><b>${summary.rate}%<small>完成率</small></b></div>`}</div>`;
    if (homeworkContentType === 'notice') {
      html += `<div class="notice-detail"><span>通知内容</span><p>${esc(a.title)}</p>${canModifySubject(a.subject) ? `<div><button class="btn" data-edit-hw="${a.id}">编辑通知</button><button class="btn btn-danger-outline" data-del-hw="${a.id}">删除通知</button></div>` : ''}</div>`;
      hwContent.innerHTML = html;
      const back = hwContent.querySelector('.hw-back-overview'); if (back) back.addEventListener('click', () => { selectedAssigns = []; renderHomeworkList(null); });
      bindHwEvents(); return;
    }
    html += '<div class="hw-table-wrap"><table class="hw-matrix"><thead><tr>';
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
    const back = hwContent.querySelector('.hw-back-overview');
    if (back) back.addEventListener('click', () => { selectedAssigns = []; updateAssignBtn(); buildAssignDrop(); renderHomeworkList(null); });
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
    let hws = [...state.assignments];
    hws = hws.filter(a => homeworkView.typeOf(a) === homeworkContentType);
    hws = hws.filter(a => homeworkView.stageOf(a) === homeworkStage);
    if (subject) hws = hws.filter(a => a.subject === subject);
    if (selectedSubjects.length > 0) hws = hws.filter(a => selectedSubjects.includes(a.subject));
    if (selectedAssigns.length > 0) hws = hws.filter(a => selectedAssigns.includes(a.id));
    const from = hwDateFrom ? hwDateFrom.value : '';
    const to   = hwDateTo   ? hwDateTo.value   : '';
    if (from) hws = hws.filter(a => homeworkView.dateKey(a.deadline) >= from);
    if (to)   hws = hws.filter(a => homeworkView.dateKey(a.deadline) <= to);
    hws.sort((a, b) => {
      const result = homeworkView.dateKey(a.deadline).localeCompare(homeworkView.dateKey(b.deadline));
      return homeworkStage === 'closed' ? -result : result;
    });
    return hws;
  }

  async function exportHomeworkStatistics() {
    if (!api.exportHomework) {
      alert('当前版本不支持导出表格，请更新教师端');
      return;
    }
    const assignments = getFilteredAssignments(null);
    if (!assignments.length) {
      alert('当前筛选范围内没有可导出的作业');
      return;
    }
    const status = hwStatusFilter ? hwStatusFilter.value : '';
    const students = state.students.filter(student => {
      if (!status) return true;
      return assignments.some(assignment => ((assignment.submissions && assignment.submissions[student.id]) || '未提交') === status);
    });
    const selectedAssignmentNames = selectedAssigns.map(id => {
      const assignment = state.assignments.find(item => item.id === id);
      return assignment ? `${assignment.subject} - ${assignment.title}` : '';
    }).filter(Boolean);
    const payload = {
      className: state.className || (state.currentRoom && state.currentRoom.name) || '教室',
      teacherName: state.account && state.account.name ? state.account.name : '教师',
      exportedAt: new Date().toISOString(),
      filters: {
        stage: homeworkStage,
        subjects: selectedSubjects.length && selectedSubjects.length < state.subjects.length ? [...selectedSubjects] : [],
        assignments: selectedAssignmentNames,
        status,
        dateFrom: hwDateFrom ? hwDateFrom.value : '',
        dateTo: hwDateTo ? hwDateTo.value : '',
      },
      students: students.map(student => ({ id: student.id, name: student.name })),
      assignments: assignments.map(assignment => ({
        id: assignment.id,
        subject: assignment.subject,
        title: assignment.title,
        date: assignment.date,
        deadline: assignment.deadline,
        type: homeworkView.typeOf(assignment),
        submissions: assignment.submissions || {},
      })),
    };
    const originalText = exportHomeworkBtn ? exportHomeworkBtn.textContent : '';
    if (exportHomeworkBtn) {
      exportHomeworkBtn.disabled = true;
      exportHomeworkBtn.textContent = '正在导出…';
    }
    try {
      const result = await api.exportHomework(payload);
      if (!result || !result.ok) reportClientError('作业统计导出失败', new Error((result && result.message) || '导出表格失败'), { context:'导出作业统计', suggestions:['确认目标目录可写且磁盘空间充足', '关闭正在占用同名文件的表格软件'] });
      else if (!result.canceled) alert(`作业统计已导出：\n${result.filePath}`);
    } catch (error) {
      reportClientError('作业统计导出失败', error, { context:'导出作业统计', suggestions:['确认目标目录可写且磁盘空间充足', '关闭正在占用同名文件的表格软件'] });
    } finally {
      if (exportHomeworkBtn) {
        exportHomeworkBtn.disabled = false;
        exportHomeworkBtn.textContent = originalText || '导出表格';
      }
    }
  }

  function aiAssignmentsForScope() {
    const subject = aiSubject ? aiSubject.value : '';
    const stage = aiStage ? aiStage.value : 'all';
    const from = aiDateFrom ? aiDateFrom.value : '';
    const to = aiDateTo ? aiDateTo.value : '';
    return state.assignments.filter(assignment => {
      if (homeworkView.typeOf(assignment) !== 'homework') return false;
      if (subject && assignment.subject !== subject) return false;
      if (stage !== 'all' && homeworkView.stageOf(assignment) !== stage) return false;
      const date = homeworkView.dateKey(assignment.date || assignment.deadline);
      if (from && date < from) return false;
      if (to && date > to) return false;
      return true;
    });
  }

  function setAiStatus(message, success = false) {
    if (!aiAnalysisStatus) return;
    aiAnalysisStatus.textContent = message || '';
    aiAnalysisStatus.classList.toggle('is-success', !!success);
  }

  function reportSection(title, content, className = '') {
    if (!content) return '';
    return `<section class="ai-report-section ${className}"><h5>${esc(title)}</h5>${content}</section>`;
  }

  function studentChips(students) {
    return students && students.length ? `<div class="ai-student-chips">${students.map(name => `<span>${esc(name)}</span>`).join('')}</div>` : '';
  }

  function renderAiReport(result) {
    const report = result.report || {};
    const metadata = result.metadata || {};
    const evidence = (report.evidence || []).map(item => `<div class="ai-evidence-card"><strong>${esc(item.value)}</strong><span>${esc(item.metric)}</span><p>${esc(item.interpretation)}</p></div>`).join('');
    const issues = (report.learningIssues || []).map(item => `<div class="ai-report-card"><div class="ai-report-card-head"><span class="ai-report-badge ${item.severity === '优先' ? 'is-priority' : ''}">${esc(item.severity || '关注')}</span><strong>${esc(item.title)}</strong></div><p>${esc(item.evidence)}</p>${studentChips(item.affectedStudents)}</div>`).join('');
    const groups = (report.studentGroups || []).map(item => `<div class="ai-report-card"><div class="ai-report-card-head"><strong>${esc(item.group)}</strong></div><p>${esc(item.basis)}</p>${studentChips(item.students)}<div class="ai-action-line"><strong>建议：</strong>${esc(item.action)}</div></div>`).join('');
    const suggestions = (report.teachingSuggestions || []).map(item => `<div class="ai-report-card"><div class="ai-report-card-head"><span class="ai-report-badge ${item.priority === '高' ? 'is-high' : ''}">${esc(item.priority || '中')}优先级</span><strong>${esc(item.title)}</strong></div><p>${esc(item.reason)}</p><div class="ai-action-line">${esc(item.action)}</div></div>`).join('');
    const followUp = (report.followUpPlan || []).map(item => `<div class="ai-report-card"><div class="ai-report-card-head"><span class="ai-report-badge">${esc(item.timeframe)}</span><strong>${esc(item.action)}</strong></div><p>检查指标：${esc(item.successMetric)}</p></div>`).join('');
    const limitations = (report.limitations || []).length ? `<ul class="ai-limitations">${report.limitations.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '';
    const scope = metadata.scope || {};
    const scopeText = `${scope.subject || '全部授权学科'} · ${scope.dateFrom || '不限日期'} 至 ${scope.dateTo || '不限日期'} · ${metadata.assignmentCount || 0} 项作业 / ${metadata.studentCount || 0} 名学生`;
    aiReportContent.innerHTML = `<div class="ai-report-toolbar"><div><h4>学情分析报告</h4><p>${esc(scopeText)} · ${metadata.anonymized ? '已匿名传输' : '包含学生姓名'}</p></div><button id="copyAiReportBtn" class="btn btn-sm" type="button">复制报告</button></div><div class="ai-report-summary">${esc(report.summary)}</div>${evidence ? reportSection('关键数据证据', `<div class="ai-evidence-grid">${evidence}</div>`, 'ai-evidence-section') : ''}${issues ? reportSection('需要关注的问题', `<div class="ai-report-list">${issues}</div>`) : ''}${groups ? reportSection('学生分层支持', `<div class="ai-report-list">${groups}</div>`) : ''}${suggestions ? reportSection('教学建议', `<div class="ai-report-list">${suggestions}</div>`) : ''}${followUp ? reportSection('后续行动计划', `<div class="ai-report-list">${followUp}</div>`) : ''}${limitations ? reportSection('数据限制', limitations) : ''}`;
    aiReportEmpty.classList.add('hidden');
    aiReportLoading.classList.add('hidden');
    aiReportContent.classList.remove('hidden');
    document.getElementById('copyAiReportBtn')?.addEventListener('click', copyAiReport);
  }

  function aiReportAsText() {
    if (!lastAiAnalysis) return '';
    const report = lastAiAnalysis.report || {};
    const lines = ['AI 学情分析报告', '', `整体结论：${report.summary || ''}`];
    const appendObjects = (title, items, formatter) => {
      if (!items || !items.length) return;
      lines.push('', title); items.forEach((item, index) => lines.push(`${index + 1}. ${formatter(item)}`));
    };
    appendObjects('关键数据证据', report.evidence, item => `${item.metric}：${item.value}。${item.interpretation}`);
    appendObjects('需要关注的问题', report.learningIssues, item => `${item.title}（${item.severity}）：${item.evidence}${item.affectedStudents?.length ? `；涉及：${item.affectedStudents.join('、')}` : ''}`);
    appendObjects('学生分层支持', report.studentGroups, item => `${item.group}：${item.basis}；建议：${item.action}${item.students?.length ? `；学生：${item.students.join('、')}` : ''}`);
    appendObjects('教学建议', report.teachingSuggestions, item => `[${item.priority}] ${item.title}：${item.action}（${item.reason}）`);
    appendObjects('后续行动计划', report.followUpPlan, item => `${item.timeframe}：${item.action}；检查指标：${item.successMetric}`);
    if (report.limitations?.length) lines.push('', '数据限制', ...report.limitations.map((item, index) => `${index + 1}. ${item}`));
    return lines.join('\n');
  }

  async function copyAiReport() {
    const text = aiReportAsText();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); setAiStatus('报告已复制到剪贴板', true); }
    catch (_error) { setAiStatus('无法复制报告，请手动选择内容'); }
  }

  async function openAiHomeworkAnalysis() {
    if (!aiHomeworkModal || !api.analyzeHomework || !api.getHomeworkAiSettings) {
      alert('当前版本不支持 AI 学情分析，请更新教师端');
      return;
    }
    const subjects = Array.from(new Set(state.assignments.filter(item => homeworkView.typeOf(item) === 'homework').map(item => item.subject).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    aiSubject.innerHTML = '<option value="">全部授权学科</option>' + subjects.map(subject => `<option value="${esc(subject)}">${esc(subject)}</option>`).join('');
    if (selectedSubjects.length === 1 && subjects.includes(selectedSubjects[0])) aiSubject.value = selectedSubjects[0];
    aiStage.value = homeworkStage === 'pending' || homeworkStage === 'closed' ? homeworkStage : 'all';
    aiDateFrom.value = hwDateFrom ? hwDateFrom.value : '';
    aiDateTo.value = hwDateTo ? hwDateTo.value : '';
    setAiStatus('');
    aiHomeworkModal.classList.remove('hidden');
    const settings = await loadHomeworkAiSettings();
    if (settings && !(settings.endpoint && settings.model)) setAiStatus('请先在教师端设置中配置 AI 服务');
  }

  function closeAiHomeworkAnalysis() { aiHomeworkModal?.classList.add('hidden'); }

  async function runAiHomeworkAnalysis() {
    if (aiDateFrom.value && aiDateTo.value && aiDateFrom.value > aiDateTo.value) { setAiStatus('开始日期不能晚于结束日期'); return; }
    const assignments = aiAssignmentsForScope();
    if (!assignments.length) { setAiStatus('所选范围内没有可分析的作业'); return; }
    const settings = await loadHomeworkAiSettings();
    if (!settings || !settings.endpoint || !settings.model) { setAiStatus('请先在教师端设置中配置 API 地址和模型'); return; }
    aiAnalyzeBtn.disabled = true;
    aiAnalyzeBtn.innerHTML = '<span aria-hidden="true">✦</span> 正在分析…';
    aiReportEmpty.classList.add('hidden');
    aiReportContent.classList.add('hidden');
    aiReportLoading.classList.remove('hidden');
    setAiStatus(`正在分析 ${assignments.length} 项作业…`, true);
    const payload = {
      className:state.className || state.currentRoom?.name || '教室',
      teacherName:state.account?.name || '教师',
      scope:{ subject:aiSubject.value || '全部授权学科', stage:aiStage.value, dateFrom:aiDateFrom.value, dateTo:aiDateTo.value },
      focus:aiFocus.value,
      anonymize:aiAnonymize.checked,
      students:state.students.map(student => ({ id:student.id, name:student.name })),
      assignments:assignments.map(assignment => ({ id:assignment.id, subject:assignment.subject, title:assignment.title, date:assignment.date, deadline:assignment.deadline, type:homeworkView.typeOf(assignment), submissions:assignment.submissions || {} })),
    };
    try {
      const result = await api.analyzeHomework(payload);
      if (!result || !result.ok) throw new Error((result && result.message) || 'AI 学情分析失败');
      lastAiAnalysis = result;
      renderAiReport(result);
      setAiStatus('分析完成。建议结合课堂观察和作业内容进行人工判断。', true);
    } catch (error) {
      aiReportLoading.classList.add('hidden');
      aiReportEmpty.classList.remove('hidden');
      setAiStatus(error.message || 'AI 学情分析失败');
      reportClientError('AI 学情分析失败', error, { context:'AI 作业分析', suggestions:['检查 API 地址、模型名称和密钥', '确认网络可以访问所配置的 AI 服务', '如果使用本地模型，请确认模型服务已经启动'] });
    } finally {
      aiAnalyzeBtn.disabled = false;
      aiAnalyzeBtn.innerHTML = '<span aria-hidden="true">✦</span> 开始分析';
    }
  }

  function renderHomeworkList(subject) {
    if (!hwContent) return;
    const hws = getFilteredAssignments(subject);
    updateStatusFilter();

    if (hws.length === 0) {
      const emptyTitle = homeworkContentType === 'notice' ? (homeworkStage === 'pending' ? '当前没有生效中的通知' : '当前没有历史通知') : (homeworkStage === 'pending' ? '当前没有待提交作业' : '当前没有已截止作业');
      const emptyHint = homeworkContentType === 'notice' ? (homeworkStage === 'pending' ? '教师发布的通知会在结束时间前显示在这里。' : '通知到达结束时间后会自动进入这里。') : (homeworkStage === 'pending' ? '新布置且未到截止时间的作业会显示在这里。' : '作业到达截止时间后会自动进入这里。');
      hwContent.innerHTML = `<div class="hw-empty-state"><span>${homeworkStage === 'pending' ? '✓' : '◷'}</span><strong>${emptyTitle}</strong><small>${selectedSubjects.length || hwDateFrom.value || hwDateTo.value ? '可以调整上方筛选条件查看其他内容。' : emptyHint}</small></div>`;
      return;
    }

    const builtin = ['已提交', '未提交', '迟交', '免交'];
    const customs = getHwCustomStatuses();
    const filterStatus = hwStatusFilter ? hwStatusFilter.value : '';

    const deadlineGroups = homeworkView.groupByDeadline(hws, homeworkStage);
    let html = '<div class="hw-deadline-groups">';
    deadlineGroups.forEach(group => {
      html += `<section class="hw-deadline-group"><div class="hw-deadline-head"><strong>${esc(group.label)}</strong><span>${group.assignments.length} ${homeworkContentType === 'notice' ? '条通知' : '项作业'}</span></div><div class="hw-overview-grid">`;
      group.assignments.forEach(a => {
        const stats = homeworkView.submissionSummary(a, state.students);
        html += `<button class="hw-overview-card ${homeworkContentType === 'notice' ? 'notice-card' : ''}" type="button" data-view-hw="${esc(a.id)}"><span class="hw-overview-subject">${esc(a.subject)}${a.source === 'student' ? ' · 学生补录' : ''}</span><strong>${esc(a.title)}</strong><small>${a.deadline ? `${homeworkContentType === 'notice' ? '结束' : '截止'} ${esc(formatDeadline(a.deadline))}` : '未设置时间'}</small>${homeworkContentType === 'notice' ? `<div class="notice-card-footer"><span>${homeworkStage === 'pending' ? '生效中' : '已结束'}</span><em>查看通知 ›</em></div>` : `<div class="hw-progress"><i style="width:${stats.rate}%"></i></div><div class="hw-overview-stats"><span><b>${stats.submitted}</b> 已提交</span><span class="pending"><b>${stats.pending}</b> 待提交</span>${stats.late ? `<span class="late"><b>${stats.late}</b> 迟交</span>` : ''}<em>${stats.rate}%</em></div>`}</button>`;
      });
      html += '</div></section>';
    });
    if (homeworkContentType === 'notice') {
      html += '</div>'; hwContent.innerHTML = html;
      hwContent.querySelectorAll('[data-view-hw]').forEach(button => button.addEventListener('click', () => { selectedAssigns = [button.dataset.viewHw]; renderSingleAssignment(button.dataset.viewHw); }));
      return;
    }
    html += '</div><div class="hw-detail-heading"><div><strong>学生提交明细</strong><small>按截止日期分组，可直接修改每名学生的提交状态</small></div></div>';
    html += '<div class="hw-table-wrap"><table class="hw-matrix"><thead><tr class="hw-deadline-row">';
    html += '<th class="hw-matrix-name" rowspan="2">姓名</th>';
    deadlineGroups.forEach(group => { html += `<th colspan="${group.assignments.length}">${esc(group.label)}<small>${group.assignments.length} 项</small></th>`; });
    html += '</tr><tr>';
    hws.forEach(a => {
      const editable = canModifySubject(a.subject);
      html += `<th class="hw-matrix-hw">`;
      html += `<div class="hw-matrix-hw-title" title="${esc(a.title)}">${esc(a.title)}</div>`;
      if (a.source === 'student') html += '<div class="hw-matrix-hw-date">学生补录</div>';
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
    hwContent.querySelectorAll('[data-view-hw]').forEach(button => {
      button.addEventListener('click', () => { selectedAssigns = [button.dataset.viewHw]; updateAssignBtn(); buildAssignDrop(); renderSingleAssignment(button.dataset.viewHw); });
    });
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

  function updatePublishType(type) {
    if (state.editingAssignmentId) {
      const editing = state.assignments.find(item => item.id === state.editingAssignmentId);
      type = homeworkView.typeOf(editing);
    }
    publishType = type === 'notice' ? 'notice' : 'homework';
    [[publishTypeHomework, 'homework'], [publishTypeNotice, 'notice']].forEach(([button, value]) => { if (button) button.classList.toggle('active', value === publishType); });
    if (publishTypeHomework) publishTypeHomework.disabled = !!state.editingAssignmentId;
    if (publishTypeNotice) publishTypeNotice.disabled = !!state.editingAssignmentId;
    if (hwModalTitleLabel) hwModalTitleLabel.textContent = state.editingAssignmentId ? (publishType === 'notice' ? '编辑通知' : '编辑作业') : (publishType === 'notice' ? '发布通知' : '布置作业');
    if (publishContentLabel) publishContentLabel.textContent = publishType === 'notice' ? '通知内容' : '作业内容';
    if (publishDeadlineLabel) publishDeadlineLabel.textContent = publishType === 'notice' ? '通知结束时间' : '提交截止时间';
    if (publishHint) publishHint.textContent = publishType === 'notice' ? '通知将在结束时间前显示在教室端和小程序端，到期后自动进入历史通知。' : '截止前会显示在学生的桌面组件中；到达该时间后自动进入课代表提交统计。';
    if (hwModalTitle) hwModalTitle.placeholder = publishType === 'notice' ? '例如：明天下午第二节课调至实验室' : '例如：完成练习册第 12—14 页';
  }

  function openAddHw(type = 'homework') {
    if (state.subjects.filter(canModifySubject).length === 0) { alert('你没有可布置作业的授权学科，请联系班主任'); return; }
    state.editingAssignmentId = null;
    if (publishTypeHomework) publishTypeHomework.disabled = false;
    if (publishTypeNotice) publishTypeNotice.disabled = false;
    updatePublishType(type);
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
    updatePublishType(homeworkView.typeOf(a));
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
    if (!deadline) { alert(publishType === 'notice' ? '请设置通知结束时间' : '请设置提交截止时间'); return; }

    const isEdit = !!state.editingAssignmentId;
    if (isEdit) {
      const a = state.assignments.find(x => x.id === state.editingAssignmentId);
      if (a) { a.subject = subject; a.title = title; a.date = date; a.deadline = deadline; a.type = publishType; if (publishType === 'notice') a.submissions = {}; }
    } else {
      const subs = {};
      if (publishType === 'homework') state.students.forEach(s => { subs[s.id] = '未提交'; });
      state.assignments.push({ id: genId(), subject, title, date, deadline, type:publishType, submissions: subs });
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

    const savedAssignment = isEdit
      ? state.assignments.find(x => x.id === savedId)
      : state.assignments[state.assignments.length - 1];
    homeworkContentType = publishType;
    homeworkStage = homeworkView.stageOf(savedAssignment);
    selectedAssigns = [];
    renderHomework();
  }

  function deleteHw(aid) {
    const a = state.assignments.find(x => x.id === aid);
    if (!a) return;
    if (!confirm(`确定删除${homeworkView.typeOf(a) === 'notice' ? '通知' : '作业'}「${a.title}」吗？`)) return;
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
    if (connectBtn) connectBtn.addEventListener('click', () => connect(connectionCodeInput ? connectionCodeInput.value : ''));
    document.getElementById('openConnectModalBtn')?.addEventListener('click', openConnectRoomModal);
    document.getElementById('emptyAddRoomBtn')?.addEventListener('click', openConnectRoomModal);
    document.getElementById('closeConnectModalBtn')?.addEventListener('click', closeConnectRoomModal);
    const connectRoomModal = document.getElementById('connectRoomModal');
    if (connectRoomModal) connectRoomModal.addEventListener('click', event => { if (event.target === connectRoomModal) closeConnectRoomModal(); });
    if (connectionCodeInput) connectionCodeInput.addEventListener('input', () => {
      connectionCodeInput.value = connectionCode.format(connectionCodeInput.value);
      setConnectRoomState('', false, false);
    });
    if (connectionCodeInput) connectionCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') connect(connectionCodeInput.value);
    });
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        state.searchQuery = searchInput.value.trim().toLowerCase();
        renderStudents();
      });
    }
    if (multiCallToggle) multiCallToggle.addEventListener('click', toggleCallMultiMode);
    if (clearCallSelection) clearCallSelection.addEventListener('click', clearSelectedCallStudents);
    if (sendBatchCall) sendBatchCall.addEventListener('click', sendSelectedCallStudents);

    initEditor();

    // Tab 切换
    mainTabBtns.forEach(btn => {
      btn.addEventListener('click', () => switchMainTab(btn.dataset.tab));
      btn.addEventListener('keydown', event => handleTabKeydown(event, mainTabBtns));
    });
    document.querySelectorAll('[data-open-tab]').forEach(button => {
      button.addEventListener('click', () => {
        switchMainTab(button.dataset.openTab);
        if (button.dataset.dashboardSubject) {
          selectedSubjects = [button.dataset.dashboardSubject];
          selectedAssigns = [];
          buildSubjectDrop();
          updateSubjectBtn();
          buildAssignDrop();
          updateAssignBtn();
          applyFilters();
        }
        if (button.dataset.overviewAction === 'publish-homework') openAddHw('homework');
      });
    });
    document.addEventListener('click', event => {
      const subjectButton = event.target.closest('[data-dashboard-subject]');
      if (!subjectButton) return;
      switchMainTab('homework');
      selectedSubjects = [subjectButton.dataset.dashboardSubject];
      selectedAssigns = [];
      buildSubjectDrop();
      updateSubjectBtn();
      buildAssignDrop();
      updateAssignBtn();
      applyFilters();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && connectRoomModal && !connectRoomModal.classList.contains('hidden')) closeConnectRoomModal();
      if (event.key === 'Escape' && aiHomeworkModal && !aiHomeworkModal.classList.contains('hidden')) closeAiHomeworkAnalysis();
    });

    // 多选组件初始化
    initMultiSelects();

    // 状态筛选
    if (hwStatusFilter) hwStatusFilter.addEventListener('change', () => {
      if (selectedAssigns.length === 1) renderSingleAssignment(selectedAssigns[0]);
      else renderHomeworkList(null);
    });
    if (hwStagePending) hwStagePending.addEventListener('click', () => setHomeworkStage('pending'));
    if (hwStageClosed) hwStageClosed.addEventListener('click', () => setHomeworkStage('closed'));
    if (hwContentHomework) hwContentHomework.addEventListener('click', () => setHomeworkContentType('homework'));
    if (hwContentNotice) hwContentNotice.addEventListener('click', () => setHomeworkContentType('notice'));

    // 日期筛选
    const onDateChange = () => {
      buildAssignDrop(); updateAssignBtn();
      if (selectedAssigns.length === 1) renderSingleAssignment(selectedAssigns[0]);
      else renderHomeworkList(null);
    };
    if (hwDateFrom) hwDateFrom.addEventListener('change', onDateChange);
    if (hwDateTo)   hwDateTo.addEventListener('change', onDateChange);

    // 学科按钮
    if (exportHomeworkBtn) exportHomeworkBtn.addEventListener('click', exportHomeworkStatistics);
    if (aiHomeworkBtn) aiHomeworkBtn.addEventListener('click', openAiHomeworkAnalysis);
    if (aiHomeworkClose) aiHomeworkClose.addEventListener('click', closeAiHomeworkAnalysis);
    if (aiAnalyzeBtn) aiAnalyzeBtn.addEventListener('click', runAiHomeworkAnalysis);
    if (openAiSettingsBtn) openAiSettingsBtn.addEventListener('click', openGlobalAiSettings);
    if (aiHomeworkModal) aiHomeworkModal.addEventListener('click', event => { if (event.target === aiHomeworkModal) closeAiHomeworkAnalysis(); });
    if (addAssignmentBtn2) addAssignmentBtn2.addEventListener('click', () => openAddHw('homework'));
    if (publishNoticeBtn) publishNoticeBtn.addEventListener('click', () => openAddHw('notice'));
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
        teacherEditSubjectSelection = [...(teacher.subjects || [])];
        renderSubjectPicker(teacherEditSubjects, teacherEditSubjectDrop, teacherEditSubjectSelection, value => { teacherEditSubjectSelection = value; });
        teacherEditModal.classList.remove('hidden');
        teacherEditSubjects.focus();
      } else if (action === 'transfer') {
        const teacher = (state.teachers.approved || []).find(item => item.connection_id === connectionId);
        if (!teacher || !confirm(`确认将班主任身份转让给“${teacher.name}”吗？\n\n转让后，对方将获得全部班级管理权限；你会变为普通任课教师并保留当前授课科目。`)) return;
        sendTeacherManagement(action, connectionId);
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
      const subjects = [...teacherEditSubjectSelection];
      if (!subjects.length) { alert('请至少选择一个授课科目'); teacherEditSubjects.focus(); return; }
      sendTeacherManagement('update', editingTeacherId, subjects);
      teacherEditModal.classList.add('hidden');
    });
    if (teacherEditModal) teacherEditModal.addEventListener('click', event => { if (event.target === teacherEditModal) teacherEditModal.classList.add('hidden'); });

    // 作业弹窗
    if (hwModalCancel)  hwModalCancel.addEventListener('click', () => hwModal && hwModal.classList.add('hidden'));
    if (hwModalConfirm) hwModalConfirm.addEventListener('click', confirmHw);
    if (publishTypeHomework) publishTypeHomework.addEventListener('click', () => updatePublishType('homework'));
    if (publishTypeNotice) publishTypeNotice.addEventListener('click', () => updatePublishType('notice'));
    if (hwModalTitle) {
      hwModalTitle.addEventListener('keydown', (e) => {
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

    const refreshTeacherLoginQr = document.getElementById('refreshTeacherLoginQr');
    if (refreshTeacherLoginQr) refreshTeacherLoginQr.addEventListener('click', handleTeacherLoginQr);
    document.querySelectorAll('.mode-switch-btn').forEach(button => button.addEventListener('click', () => setTeacherLoginMode(button.dataset.mode)));
    document.getElementById('personalStartBtn')?.addEventListener('click', startPersonalSession);
    document.getElementById('organizationLoginBtn')?.addEventListener('click', loginOrganization);
    const saveTeacherDirectUrl = document.getElementById('saveTeacherDirectUrl');
    if (saveTeacherDirectUrl) saveTeacherDirectUrl.addEventListener('click', async () => {
      const input = document.getElementById('teacherDirectBaseUrl');
      const status = document.getElementById('teacherDirectStatus');
      saveTeacherDirectUrl.disabled = true;
      if (status) status.textContent = '正在保存…';
      try {
        const result = await api.setWechatDirectLinkSettings(input && input.value || '');
        if (!result || !result.ok) throw new Error(result && result.message || '保存失败');
        if (input) input.value = result.baseUrl || '';
        if (status) status.textContent = result.enabled ? '已启用微信直接扫码。' : '已关闭，继续使用小程序内扫码。';
        await handleTeacherLoginQr();
      } catch (error) { if (status) status.textContent = error.message || '保存失败'; }
      finally { saveTeacherDirectUrl.disabled = false; }
    });
    const generateMiniProgramQrBtn = document.getElementById('generateMiniProgramQrBtn');
    if (generateMiniProgramQrBtn) generateMiniProgramQrBtn.addEventListener('click', handleGenerateMiniProgramQr);
    if (accountMenuBtn) accountMenuBtn.addEventListener('click', openAccountModal);
    document.getElementById('chooseAccountAvatar')?.addEventListener('click', chooseAccountAvatar);
    document.getElementById('saveAccountProfile')?.addEventListener('click', saveAccountProfile);
    const accountModalClose = document.getElementById('accountModalClose');
    const logoutBtn = document.getElementById('logoutBtn');
    if (accountModalClose) accountModalClose.addEventListener('click', () => accountModal && accountModal.classList.add('hidden'));
    document.getElementById('accountCloudConnectBtn')?.addEventListener('click', enrollTeacherCloud);
    document.getElementById('accountCloudRefreshBtn')?.addEventListener('click', refreshCloudRooms);
    if (saveAccountAiSettings) saveAccountAiSettings.addEventListener('click', saveHomeworkAiSettings);
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    if (accountModal) accountModal.addEventListener('click', event => {
      if (event.target === accountModal) accountModal.classList.add('hidden');
    });
    const approvalRetryBtn = document.getElementById('approvalRetryBtn');
    const approvalCancelBtn = document.getElementById('approvalCancelBtn');
    if (approvalRetryBtn) approvalRetryBtn.addEventListener('click', () => {
      const code = state.pendingRoomCode || (state.currentRoom && state.currentRoom.connectionCode);
      if (code) connect(code);
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
    const homeworkPanel = document.getElementById('tab-homework');
    if (homeworkPanel && !homeworkPanel.classList.contains('hidden') && state.assignments.length) renderHomework();
  }, 30000);

  // ═══════════════════════════════════
  //  启动
  // ═══════════════════════════════════

  function onReady() {
    connectionCodeInput = document.getElementById('connectionCodeInput');
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
    multiCallToggle = document.getElementById('multiCallToggle');
    callBatchBar = document.getElementById('callBatchBar');
    callBatchCount = document.getElementById('callBatchCount');
    clearCallSelection = document.getElementById('clearCallSelection');
    sendBatchCall = document.getElementById('sendBatchCall');
    callSelectionHint = document.getElementById('callSelectionHint');
    historyTbody   = document.querySelector('#historyTable tbody');
    noHistory      = document.getElementById('noHistory');

    accountOverlay = document.getElementById('accountOverlay');
    accountTitle   = document.getElementById('accountTitle');
    accountDesc    = document.getElementById('accountDesc');
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
    hwContentHomework    = document.getElementById('hwContentHomework');
    hwContentNotice      = document.getElementById('hwContentNotice');
    hwStagePending       = document.getElementById('hwStagePending');
    hwStageClosed        = document.getElementById('hwStageClosed');
    hwPendingCount       = document.getElementById('hwPendingCount');
    hwClosedCount        = document.getElementById('hwClosedCount');
    hwPendingLabel       = document.getElementById('hwPendingLabel');
    hwClosedLabel        = document.getElementById('hwClosedLabel');
    hwPendingHint        = document.getElementById('hwPendingHint');
    hwClosedHint         = document.getElementById('hwClosedHint');
    hwDateFrom           = document.getElementById('hwDateFrom');
    hwDateTo             = document.getElementById('hwDateTo');
    addAssignmentBtn2    = document.getElementById('addAssignmentBtn2');
    publishNoticeBtn     = document.getElementById('publishNoticeBtn');
    exportHomeworkBtn    = document.getElementById('exportHomeworkBtn');
    aiHomeworkBtn        = document.getElementById('aiHomeworkBtn');
    aiHomeworkModal      = document.getElementById('aiHomeworkModal');
    aiHomeworkClose      = document.getElementById('aiHomeworkClose');
    aiSubject            = document.getElementById('aiSubject');
    aiStage              = document.getElementById('aiStage');
    aiDateFrom           = document.getElementById('aiDateFrom');
    aiDateTo             = document.getElementById('aiDateTo');
    aiFocus              = document.getElementById('aiFocus');
    aiAnonymize          = document.getElementById('aiAnonymize');
    aiProviderStatus     = document.getElementById('aiProviderStatus');
    openAiSettingsBtn    = document.getElementById('openAiSettingsBtn');
    accountAiSettings    = document.getElementById('accountAiSettings');
    accountAiEndpoint    = document.getElementById('accountAiEndpoint');
    accountAiModel       = document.getElementById('accountAiModel');
    accountAiApiKey      = document.getElementById('accountAiApiKey');
    accountAiStatus      = document.getElementById('accountAiStatus');
    saveAccountAiSettings = document.getElementById('saveAccountAiSettings');
    aiAnalysisStatus     = document.getElementById('aiAnalysisStatus');
    aiAnalyzeBtn         = document.getElementById('aiAnalyzeBtn');
    aiReportEmpty        = document.getElementById('aiReportEmpty');
    aiReportLoading      = document.getElementById('aiReportLoading');
    aiReportContent      = document.getElementById('aiReportContent');
    hwContent            = document.getElementById('hwContent');
    hwModal               = document.getElementById('hwModal');
    hwModalTitleLabel     = document.getElementById('hwModalTitleLabel');
    hwModalSubject        = document.getElementById('hwModalSubject');
    hwModalTitle          = document.getElementById('hwModalTitle');
    hwModalDate           = document.getElementById('hwModalDate');
    hwModalDeadline       = document.getElementById('hwModalDeadline');
    hwModalCancel         = document.getElementById('hwModalCancel');
    hwModalConfirm        = document.getElementById('hwModalConfirm');
    publishTypeHomework   = document.getElementById('publishTypeHomework');
    publishTypeNotice     = document.getElementById('publishTypeNotice');
    publishContentLabel   = document.getElementById('publishContentLabel');
    publishDeadlineLabel  = document.getElementById('publishDeadlineLabel');
    publishHint           = document.getElementById('publishHint');
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
    connectSubjectDrop    = document.getElementById('connectSubjectDrop');
    teacherEditSubjectDrop = document.getElementById('teacherEditSubjectDrop');
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
    document.getElementById('retryFaceLanBtn')?.addEventListener('click', () => startFaceLan(state.currentRoom));
    loadFromDisk().then(data => {
      state.rooms       = data.rooms;
      state.callHistory = data.callHistory;
      state.cloud       = data.cloud || null;
      renderRooms();
      renderHistory();
      if (data.account) {
        if (state.cloud?.mustChangePassword) {
          showAccountOverlay();
          setTeacherLoginMode('tob');
          const server = document.getElementById('organizationServer');
          const loginName = document.getElementById('organizationLoginName');
          if (server) server.value = state.cloud.serverUrl || '';
          if (loginName) loginName.value = state.cloud.loginName || '';
          document.getElementById('organizationProfileFields')?.classList.remove('hidden');
          const status = document.getElementById('organizationLoginStatus');
          if (status) status.textContent = '请完成首次资料设置并修改默认密码。';
        } else {
          setSignedInAccount(data.account);
          if (state.cloud) refreshCloudRooms({ silent:true });
        }
      } else showAccountOverlay();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
