(() => {
  'use strict';
  const state = {
    accessToken: sessionStorage.getItem('banda_admin_access') || '',
    refreshToken: localStorage.getItem('banda_admin_refresh') || '',
    activeTab: sessionStorage.getItem('banda_admin_tab') || 'overview',
    classrooms: [],
    users: [],
    enrollmentTargets: { classrooms: [], teachers: [] },
    editingEntity: null,
    currentClassroom: '',
    currentClassroomName: '',
    classroomStudents: [],
    memberClassroomId: '',
    memberUserIds: new Set(),
    lastEnrollment: null,
    selectedClassroomIds: new Set(),
    selectedTeacherIds: new Set(),
  };
  const $ = selector => document.querySelector(selector);
  const views = ['setupView', 'loginView', 'dashboardView'];
  const SUBJECT_OPTIONS = Object.freeze(['语文','数学','英语','物理','化学','生物','道德与法治','历史','地理','科学','信息科技','通用技术','体育与健康','音乐','美术','劳动','综合实践活动','心理健康','班会','日语','俄语']);
  const show = id => views.forEach(view => $(('#' + view)).classList.toggle('hidden', view !== id));
  const message = text => { const el = $('#message'); el.textContent = text; el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 3500); };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const formatTime = value => value ? new Date(value).toLocaleString() : '暂无记录';
  const statusText = value => value === 'active' ? '正常使用' : value === 'disabled' ? '已停用' : String(value || '未知');
  const summaryItem = (label, value, wide = false) => '<div class="summary-item' + (wide ? ' wide' : '') + '"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
  const formData = form => Object.fromEntries(new FormData(form).entries());

  function normalizeSubjects(values = []) {
    return Array.from(new Set((values || []).map(value => String(value || '').trim()).filter(Boolean)));
  }

  function renderSubjectOptions(container, selected = []) {
    const selectedSet = new Set(normalizeSubjects(selected));
    const options = Array.from(new Set([...SUBJECT_OPTIONS, ...selectedSet]));
    container.innerHTML = options.map(subject => '<label><input type="checkbox" value="' + escapeHtml(subject) + '"' + (selectedSet.has(subject) ? ' checked' : '') + '><span>' + escapeHtml(subject) + '</span></label>').join('');
  }

  function selectedSubjects(container) {
    return normalizeSubjects([...container.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value));
  }

  function updateMemberSubjectSummary() {
    const selected = selectedSubjects($('#memberSubjectOptions'));
    $('#memberSubjectSummary').textContent = selected.length ? selected.join('、') : '选择授课科目';
  }

  function openMemberSubjectEditor(target) {
    const selected = String(target.dataset.subjects || '').split(',').filter(Boolean);
    state.editingMember = { id: target.dataset.memberEdit };
    $('#memberSubjectRole').value = target.dataset.role === 'homeroom' ? 'homeroom' : 'teacher';
    renderSubjectOptions($('#memberEditSubjectOptions'), selected);
    $('#memberSubjectDialog').showModal();
  }

  function applyOrganizationBranding(organization = {}) {
    const color = /^#[0-9A-Fa-f]{6}$/.test(String(organization.primaryColor || '')) ? String(organization.primaryColor).toUpperCase() : '#07C160';
    const root = document.documentElement;
    root.style.setProperty('--green', color);
    root.style.setProperty('--green-dark', color);
    root.style.setProperty('--green-soft', color + '1A');
    root.style.setProperty('--brand-color', color);
    const name = String(organization.name || '班达云服务');
    const shortName = String(organization.shortName || name);
    $('#brandName').textContent = shortName;
    $('#brandSubtitle').textContent = name === shortName ? '统一管理中心' : name;
    const mark = $('#brandMark');
    const logo = $('#brandLogo');
    mark.textContent = shortName.slice(0, 1) || '班';
    mark.style.background = `linear-gradient(145deg, ${color}, ${color})`;
    logo.classList.add('hidden');
    logo.onload = () => { mark.classList.add('hidden'); logo.classList.remove('hidden'); };
    logo.onerror = () => { mark.classList.remove('hidden'); logo.classList.add('hidden'); };
    if (organization.logoUrl) logo.src = organization.logoUrl;
    else { logo.removeAttribute('src'); mark.classList.remove('hidden'); }
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (_error) { /* fall through to legacy copy */ }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand('copy'); } catch (_error) { throw new Error('无法复制到剪贴板'); }
    document.body.removeChild(textarea);
  }

  function activateTab(name, focus = false) {
    const button = $('[data-tab="' + name + '"]');
    const page = $('[data-tab-page="' + name + '"]');
    if (!button || !page) return;
    state.activeTab = name;
    sessionStorage.setItem('banda_admin_tab', name);
    document.querySelectorAll('[data-tab]').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('[data-tab-page]').forEach(item => {
      const active = item === page;
      item.classList.toggle('active', active);
      item.classList.toggle('hidden', !active);
    });
    if (focus) button.focus();
  }

  function activateConfigTab(name) {
    document.querySelectorAll('[data-config-tab]').forEach(tab => {
      const active = tab.getAttribute('data-config-tab') === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-config-pane]').forEach(pane => {
      pane.classList.toggle('hidden', pane.getAttribute('data-config-pane') !== name);
    });
    if (name === 'basic') { loadClassroomBasic(); loadClassroomKeys(); }
    if (name === 'students') loadClassroomStudents();
    if (name === 'members') loadMembers();
    if (name === 'content') loadMonitor();
  }

  async function api(path, options = {}) {
    const headers = { 'X-Banda-Client': 'admin-web', 'X-Banda-Protocol': '1', ...(options.headers || {}) };
    if (options.body !== undefined && options.body !== null && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (state.accessToken) headers.Authorization = 'Bearer ' + state.accessToken;
    const response = await fetch(path, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && state.refreshToken && !options._retried && path !== '/api/v1/auth/refresh') {
      const refreshed = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Banda-Client': 'admin-web', 'X-Banda-Protocol': '1' }, body: JSON.stringify({ refreshToken: state.refreshToken }) });
      const session = await refreshed.json().catch(() => ({}));
      if (refreshed.ok) {
        state.accessToken = session.accessToken;
        state.refreshToken = session.refreshToken;
        sessionStorage.setItem('banda_admin_access', state.accessToken);
        localStorage.setItem('banda_admin_refresh', state.refreshToken);
        return api(path, { ...options, _retried: true });
      }
    }
    if (!response.ok) throw new Error(body.message || '请求失败');
    return body;
  }

  async function initialize() {
    const setup = await api('/api/v1/setup/status');
    if (!setup.initialized) { show('setupView'); return; }
    if (!state.accessToken) { show('loginView'); return; }
    try { await loadDashboard(); show('dashboardView'); activateTab(state.activeTab); $('#logoutBtn').classList.remove('hidden'); }
    catch (_error) { logout(false); show('loginView'); }
  }

  async function loadDashboard() {
    const [summary, classrooms, users, organizationResult] = await Promise.all([
      api('/api/v1/admin/summary'),
      api('/api/v1/admin/classrooms'),
      api('/api/v1/admin/users'),
      api('/api/v1/admin/organization'),
    ]);
    state.classrooms = classrooms.classrooms || [];
    state.users = users.users || [];
    const organization = organizationResult.organization || {};
    applyOrganizationBranding(organization);
    $('#organizationName').value = organization.name || '';
    $('#organizationShortName').value = organization.shortName || '';
    $('#organizationLogoUrl').value = organization.logoUrl || '';
    $('#organizationPrimaryColor').value = organization.primaryColor || '#2563EB';
    $('#statClassrooms').textContent = summary.classrooms;
    $('#statUsers').textContent = summary.users;
    $('#statOnline').textContent = summary.onlineDevices;
    $('#statPending').textContent = summary.pendingTargets;
    $('#classroomTabCount').textContent = summary.classrooms;
    $('#teacherTabCount').textContent = summary.users;
    $('#overviewOnlineText').textContent = summary.onlineDevices ? '教室端正在同步数据' : '当前没有在线教室端';
    $('#overviewPendingText').textContent = summary.pendingTargets ? '存在尚未接入的教室或教师账号' : '所有对象均已完成接入';

    $('#classroomList').innerHTML = '<table class="admin-table"><thead><tr><th><input type="checkbox" data-check-all="classroom"></th><th>教室</th><th>状态</th><th>设备</th><th>学生/成员/作业</th><th>操作</th></tr></thead><tbody>' + state.classrooms.map(room => '<tr><td><input type="checkbox" data-check-id="' + room.id + '" data-check-type="classroom" ' + (state.selectedClassroomIds.has(room.id) ? 'checked' : '') + '></td><td><strong>' + escapeHtml(room.name) + '</strong><small>' + escapeHtml(room.lan_connection_code || room.id.slice(0, 8)) + '</small></td><td><span class="status ' + (room.status === 'active' ? '' : 'offline') + '">' + escapeHtml(statusText(room.status)) + '</span></td><td><span class="status ' + (room.device_status === 'online' ? '' : 'offline') + '">' + (room.device_status === 'online' ? '在线' : '离线') + '</span></td><td>' + room.student_count + ' / ' + room.member_count + ' / ' + room.assignment_count + '</td><td><button class="mini-action" data-open-classroom="' + room.id + '" data-name="' + escapeHtml(room.name) + '">配置</button><button class="mini-action danger" data-delete-classroom="' + room.id + '" data-name="' + escapeHtml(room.name) + '">删除</button></td></tr>').join('') + '</tbody></table>';

    $('#userList').innerHTML = '<table class="admin-table"><thead><tr><th><input type="checkbox" data-check-all="teacher"></th><th>教师</th><th>状态</th><th>登录账号</th><th>创建时间</th><th>操作</th></tr></thead><tbody>' + state.users.map(user => '<tr><td><input type="checkbox" data-check-id="' + user.id + '" data-check-type="teacher" ' + (state.selectedTeacherIds.has(user.id) ? 'checked' : '') + '></td><td><strong>' + escapeHtml(user.name) + '</strong><small>' + escapeHtml(user.id.slice(0, 8)) + '</small></td><td><span class="status ' + (user.status === 'active' ? '' : 'offline') + '">' + escapeHtml(statusText(user.status)) + '</span></td><td>' + escapeHtml(user.login_name || '未设置') + '</td><td>' + escapeHtml(formatTime(user.created_at)) + '</td><td><button class="mini-action" data-user-edit="' + user.id + '">详情</button><button class="mini-action danger" data-delete-teacher="' + user.id + '" data-name="' + escapeHtml(user.name) + '">删除</button></td></tr>').join('') + '</tbody></table>';
  }

  function logout(notify = true) {
    state.accessToken = '';
    state.refreshToken = '';
    sessionStorage.removeItem('banda_admin_access');
    localStorage.removeItem('banda_admin_refresh');
    $('#logoutBtn').classList.add('hidden');
    if (notify) message('已退出登录');
  }

  async function openEntityEditor(type, id) {
    const result = await api(type === 'classroom' ? '/api/v1/admin/classrooms/' + id : '/api/v1/admin/users/' + id);
    const entity = type === 'classroom' ? result.classroom : result.teacher;
    state.editingEntity = { type, id, name: entity.name };
    $('#deleteConfirm').classList.add('hidden');
    $('#deleteConfirmName').value = '';
    $('#entityType').value = type;
    $('#entityId').value = id;
    $('#entityName').value = entity.name;
    $('#entityName').maxLength = type === 'classroom' ? 120 : 40;
    $('#entityStatus').value = entity.status;
    $('#teacherCredentialFields').classList.toggle('hidden', type !== 'teacher');
    $('#entityLoginName').value = type === 'teacher' ? (entity.login_name || '') : '';
    $('#entityDefaultPassword').value = '';
    $('#entityEyebrow').textContent = type === 'classroom' ? '教室资料' : '教师资料';
    $('#entityDialogTitle').textContent = entity.name;
    if (type === 'classroom') {
      $('#entityDetailSummary').innerHTML = [summaryItem('学生人数', entity.student_count + ' 人'), summaryItem('教师成员', entity.member_count + ' 人'), summaryItem('作业与通知', entity.assignment_count + ' 项'), summaryItem('教室配置', entity.configured ? '已完成' : '未初始化'), summaryItem('教室端设备', entity.device_name || '尚未绑定'), summaryItem('最近同步', formatTime(entity.last_device_sync_at)), summaryItem('局域网连接码', entity.lan_connection_code || '暂无'), summaryItem('客户端版本', entity.app_version || '暂无'), summaryItem('创建时间', formatTime(entity.created_at))].join('');
    } else {
      const memberships = result.memberships || [];
      const classes = memberships.map(item => item.classroom_name + '（' + (item.role === 'homeroom' ? '班主任' : '任课教师') + ' · ' + ((item.subjects_json || []).join('、') || '未设科目') + '）').join('；') || '尚未加入教室';
      $('#entityDetailSummary').innerHTML = [summaryItem('账号状态', statusText(entity.status)), summaryItem('首次改密', entity.must_change_password ? '等待教师完成' : '已完成'), summaryItem('登录设备', (entity.device_count || 0) + ' 台'), summaryItem('加入教室', memberships.length + ' 个'), summaryItem('最近在线', formatTime(entity.last_seen_at)), summaryItem('创建时间', formatTime(entity.created_at)), summaryItem('更新时间', formatTime(entity.updated_at)), summaryItem('教室与身份', classes, true)].join('');
    }
    $('#teacherKeyPanel').classList.toggle('hidden', type !== 'teacher');
    if (type === 'teacher') loadTeacherKeys(id).catch(error => message(error.message));
    $('#entityDialog').showModal();
  }

  async function openClassroomConfig(id, name) {
    state.currentClassroom = id;
    state.currentClassroomName = name || '';
    $('#classroomConfigTitle').textContent = name || '教室配置';
    $('#classroomConfigMeta').textContent = '加载中…';
    $('#classroomConfigStatus').textContent = '离线';
    $('#classroomConfigStatus').className = 'status offline';
    $('#classroomOverview').classList.add('hidden');
    $('#classroomConfigPanel').classList.remove('hidden');
    activateConfigTab('basic');
  }

  function closeClassroomConfig() {
    state.currentClassroom = '';
    state.currentClassroomName = '';
    state.classroomStudents = [];
    $('#classroomConfigPanel').classList.add('hidden');
    $('#classroomOverview').classList.remove('hidden');
    loadDashboard();
  }

  async function loadClassroomBasic() {
    if (!state.currentClassroom) return;
    const result = await api('/api/v1/admin/classrooms/' + state.currentClassroom);
    const classroom = result.classroom;
    state.currentClassroomName = classroom.name;
    $('#classroomConfigTitle').textContent = classroom.name;
    $('#classroomConfigMeta').textContent = '学生 ' + classroom.student_count + ' · 成员 ' + classroom.member_count + ' · 作业 ' + classroom.assignment_count;
    $('#classroomBasicName').value = classroom.name;
    $('#classroomBasicStatus').value = classroom.status;
    $('#classroomConfigStatus').textContent = classroom.device_status === 'online' ? '在线' : '离线';
    $('#classroomConfigStatus').className = 'status ' + (classroom.device_status === 'online' ? '' : 'offline');
    $('#classroomDeviceSummary').innerHTML = [summaryItem('教室端设备', classroom.device_name || '尚未绑定'), summaryItem('客户端版本', classroom.app_version || '暂无'), summaryItem('最近同步', formatTime(classroom.last_device_sync_at)), summaryItem('局域网连接码', classroom.lan_connection_code || '暂无'), summaryItem('创建时间', formatTime(classroom.created_at))].join('');
  }

  async function loadClassroomStudents() {
    if (!state.currentClassroom) return;
    const result = await api('/api/v1/admin/classrooms/' + state.currentClassroom + '/snapshot');
    state.classroomStudents = result.students || [];
    $('#classroomStudentsText').value = state.classroomStudents.map(student => student.name).join('\n');
    $('#configStudentCount').textContent = state.classroomStudents.length + ' 名学生';
  }

  async function saveClassroomStudents() {
    if (!state.currentClassroom) return;
    const existing = new Map((state.classroomStudents || []).map(student => [student.name, student.id]));
    const names = [...new Set(String($('#classroomStudentsText').value || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean))];
    const students = names.map(name => {
      const id = existing.get(name);
      return id ? { id, name } : { name };
    });
    if (!students.length) { message('请至少输入一名学生'); return; }
    await api('/api/v1/admin/classrooms/' + state.currentClassroom + '/students', { method: 'PUT', body: JSON.stringify({ students }) });
    message('学生名单已保存');
    await loadClassroomStudents();
    await loadDashboard();
  }

  async function loadMembers() {
    if (!state.currentClassroom) return;
    const result = await api('/api/v1/admin/classrooms/' + state.currentClassroom + '/members');
    state.memberClassroomId = state.currentClassroom;
    state.memberUserIds = new Set((result.members || []).map(item => item.user_id));
    $('#memberPanelTitle').textContent = (state.currentClassroomName || '教室') + ' · 教师成员';
    $('#memberTeacher').innerHTML = '<option value="">选择教师</option>' + state.users.filter(user => user.status === 'active' && !state.memberUserIds.has(user.id)).map(user => '<option value="' + escapeHtml(user.id) + '">' + escapeHtml(user.name) + '</option>').join('');
    $('#memberList').innerHTML = (result.members || []).map(member => '<div class="list-item"><div><strong>' + escapeHtml(member.name) + '</strong><small> · ' + ((member.subjects_json || []).map(escapeHtml).join('、') || '未设科目') + '</small></div><div><span>' + (member.role === 'homeroom' ? '班主任' : member.status === 'pending' ? '待审核' : '任课教师') + '</span>' + (member.status === 'pending' ? '<button class="mini-action" data-member-approve="' + member.user_id + '">批准</button>' : '') + '<button class="mini-action" data-member-edit="' + member.user_id + '" data-role="' + member.role + '" data-subjects="' + escapeHtml((member.subjects_json || []).join(',')) + '">编辑</button><button class="mini-action danger" data-member-remove="' + member.user_id + '">移除</button></div></div>').join('') || '<div class="list-item"><span>暂无教师成员</span></div>';
  }

  async function loadMonitor() {
    if (!state.currentClassroom) return;
    const result = await api('/api/v1/admin/classrooms/' + state.currentClassroom + '/snapshot');
    $('#monitorPanelTitle').textContent = (result.classroom && result.classroom.name || state.currentClassroomName || '教室') + ' · 同步数据';
    $('#monitorSummary').innerHTML = '<article><span>学生</span><strong>' + result.students.length + '</strong></article><article><span>教师</span><strong>' + result.members.length + '</strong></article><article><span>作业与通知</span><strong>' + result.assignments.length + '</strong></article><article><span>提交记录</span><strong>' + result.submissions.length + '</strong></article>';
    $('#monitorList').innerHTML = (result.assignments || []).map(item => '<div class="list-item"><div><strong>' + escapeHtml(item.title) + '</strong><small> · ' + escapeHtml(item.subject || '通知') + ' · ' + (item.type === 'notice' ? '通知' : '作业') + '</small></div><span>' + (item.deadline ? new Date(item.deadline).toLocaleString() : '无截止时间') + '</span></div>').join('') || '<div class="list-item"><span>暂无作业或通知</span></div>';
  }

  function keyListHtml(keys) {
    return (keys || []).map(key => {
      const active = !key.revoked_at && key.used_count < key.max_uses;
      const stateText = active ? '有效' : (key.revoked_at ? '已失效' : '已使用/已失效');
      return '<div class="list-item"><div><strong>' + escapeHtml(key.target_name || '已删除对象') + '</strong><small> · ' + stateText + ' · ' + new Date(key.expires_at).toLocaleString() + '</small></div></div>';
    }).join('') || '<div class="list-item"><span>暂无密钥</span></div>';
  }

  function showGeneratedKey(result, keyType) {
    const serverUrl = window.location.origin;
    const keyTypeLabel = keyType === 'classroom' ? '教室接入密钥' : '教师身份密钥';
    state.lastEnrollment = { serverUrl, key: result.key, keyType, keyTypeLabel };
    $('#newKey').innerHTML = '<p style="margin:0 0 8px;font-weight:700">' + keyTypeLabel + '已生成，请立即复制</p><div style="display:flex;align-items:center;gap:8px;margin:8px 0"><span style="color:var(--muted);font-size:12px">服务器地址</span><code style="flex:1;display:inline-block;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(serverUrl) + '</code><button type="button" class="mini-action" data-copy-target="server">复制</button></div><div style="display:flex;align-items:center;gap:8px;margin:8px 0"><span style="color:var(--muted);font-size:12px">接入密钥</span><code style="flex:1;display:inline-block;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(result.key) + '</code><button type="button" class="mini-action" data-copy-target="key">复制</button></div><button type="button" class="settings-button" style="width:100%;margin-top:8px" data-copy-target="all">一键复制连接信息</button>';
    $('#newKey').classList.remove('hidden');
  }

  function renderInlineKey(containerId, result, keyType) {
    const serverUrl = window.location.origin;
    const keyTypeLabel = keyType === 'classroom' ? '教室接入密钥' : '教师身份密钥';
    state.lastEnrollment = { serverUrl, key: result.key, keyType, keyTypeLabel };
    $('#' + containerId).innerHTML = '<p style="margin:0 0 8px;font-weight:700">' + keyTypeLabel + '已生成，请立即复制</p><div style="display:flex;align-items:center;gap:8px;margin:8px 0"><span style="color:var(--muted);font-size:12px">服务器地址</span><code style="flex:1;display:inline-block;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(serverUrl) + '</code><button type="button" class="mini-action" data-copy-target="server">复制</button></div><div style="display:flex;align-items:center;gap:8px;margin:8px 0"><span style="color:var(--muted);font-size:12px">接入密钥</span><code style="flex:1;display:inline-block;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(result.key) + '</code><button type="button" class="mini-action" data-copy-target="key">复制</button></div><button type="button" class="settings-button" style="width:100%;margin-top:8px" data-copy-target="all">一键复制连接信息</button>';
    $('#' + containerId).classList.remove('hidden');
  }

  async function loadClassroomKeys() {
    if (!state.currentClassroom) return;
    const result = await api('/api/v1/admin/enrollment-keys');
    const keys = (result.keys || []).filter(key => key.key_type === 'classroom' && key.target_classroom_id === state.currentClassroom);
    $('#classroomKeyList').innerHTML = keyListHtml(keys);
  }

  async function loadTeacherKeys(userId) {
    if (!userId) return;
    const result = await api('/api/v1/admin/enrollment-keys');
    const keys = (result.keys || []).filter(key => key.key_type === 'teacher' && key.target_user_id === userId);
    $('#teacherKeyList').innerHTML = keyListHtml(keys);
  }

  async function generateClassroomKey() {
    if (!state.currentClassroom) return;
    const result = await api('/api/v1/admin/enrollment-keys', { method: 'POST', body: JSON.stringify({ keyType: 'classroom', targetClassroomId: state.currentClassroom, targetUserId: null, expiresInHours: 24, maxUses: 1 }) });
    renderInlineKey('classroomNewKey', result, 'classroom');
    await loadClassroomKeys();
  }

  async function generateTeacherKey() {
    const editing = state.editingEntity;
    if (!editing || editing.type !== 'teacher') return;
    const result = await api('/api/v1/admin/enrollment-keys', { method: 'POST', body: JSON.stringify({ keyType: 'teacher', targetClassroomId: null, targetUserId: editing.id, expiresInHours: 24, maxUses: 1 }) });
    renderInlineKey('teacherNewKey', result, 'teacher');
    await loadTeacherKeys(editing.id);
  }

  async function deleteClassrooms(ids) {
    const list = [...new Set(ids || [])].filter(Boolean);
    if (!list.length) return;
    if (!confirm('确定删除选中的 ' + list.length + ' 个教室吗？此操作无法恢复。')) return;
    for (const id of list) {
      try { await api('/api/v1/admin/classrooms/' + id, { method:'DELETE' }); }
      catch (error) { message('部分教室删除失败：' + error.message); }
    }
    state.selectedClassroomIds.clear();
    await loadDashboard();
    message('批量删除完成');
  }

  async function deleteTeachers(ids) {
    const list = [...new Set(ids || [])].filter(Boolean);
    if (!list.length) return;
    if (!confirm('确定删除选中的 ' + list.length + ' 个教师账号吗？此操作无法恢复。')) return;
    for (const id of list) {
      try { await api('/api/v1/admin/users/' + id, { method:'DELETE' }); }
      catch (error) { message('部分教师删除失败：' + error.message); }
    }
    state.selectedTeacherIds.clear();
    await loadDashboard();
    message('批量删除完成');
  }

  async function confirmDeleteClassroom() {
    if (!state.currentClassroom) return;
    const classroomName = state.currentClassroomName || '当前教室';
    if (!confirm('确定删除教室“' + classroomName + '”吗？此操作会清理学生、成员、作业、通知和设备凭证，且无法恢复。')) return;
    await api('/api/v1/admin/classrooms/' + state.currentClassroom, { method:'DELETE' });
    closeClassroomConfig();
    message('教室已删除');
  }

  $('#setupForm').addEventListener('submit', async event => { event.preventDefault(); try { await api('/api/v1/setup', { method: 'POST', body: JSON.stringify(formData(event.currentTarget)) }); message('初始化完成，请登录'); show('loginView'); } catch (error) { message(error.message); } });
  $('#loginForm').addEventListener('submit', async event => { event.preventDefault(); try { const result = await api('/api/v1/auth/admin/login', { method: 'POST', body: JSON.stringify({ ...formData(event.currentTarget), deviceName: navigator.platform || 'Web 管理面板' }) }); state.accessToken = result.accessToken; state.refreshToken = result.refreshToken; sessionStorage.setItem('banda_admin_access', state.accessToken); localStorage.setItem('banda_admin_refresh', state.refreshToken); await loadDashboard(); show('dashboardView'); activateTab(state.activeTab); $('#logoutBtn').classList.remove('hidden'); } catch (error) { message(error.message); } });
  $('#classroomForm').addEventListener('submit', async event => { event.preventDefault(); const form=event.currentTarget;try{const created=await api('/api/v1/admin/classrooms',{method:'POST',body:JSON.stringify(formData(form))});form.reset(); await loadDashboard(); activateTab('classrooms'); message('待接入教室已创建，可进入教室配置生成身份密钥'); } catch (error) { message(error.message); } });
  $('#teacherForm').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; try { await api('/api/v1/admin/users', { method: 'POST', body: JSON.stringify(formData(form)) }); form.reset(); await loadDashboard(); activateTab('teachers'); message('教师账号已创建，请安全地将账号和默认密码交给教师'); } catch (error) { message(error.message); } });
  $('#organizationForm').addEventListener('submit', async event => { event.preventDefault(); try { await api('/api/v1/admin/organization', { method:'PATCH', body:JSON.stringify(formData(event.currentTarget)) }); await loadDashboard(); activateTab('organization'); message('组织设置已保存，小程序下次同步时生效'); } catch (error) { message(error.message); } });
  $('#memberAddForm').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; const data = formData(form); const subjects = selectedSubjects($('#memberSubjectOptions')); if (!subjects.length) { message('请至少选择一个授课科目'); return; } try { await api('/api/v1/admin/classrooms/' + state.memberClassroomId + '/members', { method: 'POST', body: JSON.stringify({ userId: data.userId, role: data.role, subjects }) }); form.reset(); renderSubjectOptions($('#memberSubjectOptions')); updateMemberSubjectSummary(); $('#memberSubjectPicker').open = false; await loadMembers(); message('教师成员已添加'); } catch (error) { message(error.message); } });
  $('#memberSubjectOptions').addEventListener('change', updateMemberSubjectSummary);
  $('#memberSubjectForm').addEventListener('submit', async event => { event.preventDefault(); const subjects = selectedSubjects($('#memberEditSubjectOptions')); if (!subjects.length) { message('请至少选择一个授课科目'); return; } try { await api('/api/v1/admin/classrooms/' + state.memberClassroomId + '/members/' + state.editingMember.id, { method:'PATCH', body:JSON.stringify({ role:$('#memberSubjectRole').value, subjects }) }); $('#memberSubjectDialog').close(); await loadMembers(); message('教师成员已更新'); } catch (error) { message(error.message); } });
  $('#closeMemberSubjectDialog').addEventListener('click', () => $('#memberSubjectDialog').close());
  $('#cancelMemberSubjectDialog').addEventListener('click', () => $('#memberSubjectDialog').close());
  $('#classroomBasicForm').addEventListener('submit', async event => { event.preventDefault(); const data = formData(event.currentTarget); try { await api('/api/v1/admin/classrooms/' + state.currentClassroom, { method: 'PATCH', body: JSON.stringify({ name: data.name, status: data.status }) }); message('教室资料已更新'); await loadClassroomBasic(); await loadDashboard(); } catch (error) { message(error.message); } });
  $('#classroomStudentsForm').addEventListener('submit', async event => { event.preventDefault(); try { await saveClassroomStudents(); } catch (error) { message(error.message); } });
  $('#generateClassroomKey').addEventListener('click', () => { generateClassroomKey().catch(error => message(error.message)); });
  $('#generateTeacherKey').addEventListener('click', () => { generateTeacherKey().catch(error => message(error.message)); });
  function bindCopyTarget(selector) {
    $(selector).addEventListener('click', async event => {
      const button = event.target.closest('button[data-copy-target]');
      if (!button || !state.lastEnrollment) return;
      const target = button.getAttribute('data-copy-target');
      let text = '';
      if (target === 'server') text = state.lastEnrollment.serverUrl;
      else if (target === 'key') text = state.lastEnrollment.key;
      else text = '服务器地址：' + state.lastEnrollment.serverUrl + '\n' + state.lastEnrollment.keyTypeLabel + '：' + state.lastEnrollment.key;
      try { await copyText(text); message('已复制到剪贴板'); }
      catch (error) { message(error.message || '复制失败'); }
    });
  }
  bindCopyTarget('#newKey');
  bindCopyTarget('#teacherNewKey');
  bindCopyTarget('#classroomNewKey');
  $('#entityEditForm').addEventListener('submit', async event => { event.preventDefault(); const data = formData(event.currentTarget); const type = data.entityType; const body={ name:data.name, status:data.status }; if(type==='teacher'){body.loginName=data.loginName;if(data.defaultPassword)body.defaultPassword=data.defaultPassword;} try { await api(type === 'classroom' ? '/api/v1/admin/classrooms/' + data.entityId : '/api/v1/admin/users/' + data.entityId, { method: 'PATCH', body: JSON.stringify(body) }); $('#entityDialog').close(); await loadDashboard(); message(type === 'classroom' ? '教室资料已更新' : '教师账号已更新'); } catch (error) { message(error.message); } });
  $('#deleteEntityBtn').addEventListener('click', async () => { const editing = state.editingEntity; if (!editing) return; const label = editing.type === 'classroom' ? '教室' : '教师账号'; if (!confirm('确定删除' + label + '“' + editing.name + '”吗？此操作无法恢复。')) return; try { await api(editing.type === 'classroom' ? '/api/v1/admin/classrooms/' + editing.id : '/api/v1/admin/users/' + editing.id, { method:'DELETE' }); $('#entityDialog').close(); await loadDashboard(); message(label + '已删除'); } catch (error) { message(error.message); } });
  $('#closeEntityDialog').addEventListener('click', () => $('#entityDialog').close());
  $('#cancelEntityEdit').addEventListener('click', () => $('#entityDialog').close());
  $('#logoutBtn').addEventListener('click', () => { logout(); show('loginView'); });
  $('#backToClassrooms').addEventListener('click', closeClassroomConfig);
  $('#deleteConfiguredClassroom').addEventListener('click', () => { confirmDeleteClassroom().catch(error => message(error.message)); });
  $('#deleteClassroomsBatch').addEventListener('click', () => { deleteClassrooms([...state.selectedClassroomIds]).catch(error => message(error.message)); });
  $('#deleteTeachersBatch').addEventListener('click', () => { deleteTeachers([...state.selectedTeacherIds]).catch(error => message(error.message)); });

  $('#dashboardView').addEventListener('click', async event => {
    const tabTarget = event.target.closest('button[data-tab],button[data-open-tab]');
    if (tabTarget) { activateTab(tabTarget.dataset.tab || tabTarget.dataset.openTab); return; }
    if (event.target.closest('button[data-refresh-dashboard]')) { try { await loadDashboard(); message('数据已刷新'); } catch (error) { message(error.message); } return; }
    if (event.target.closest('button[data-open-classroom]')) { const id = event.target.closest('button[data-open-classroom]').dataset.openClassroom; const name = event.target.closest('button[data-open-classroom]').dataset.name; try { await openClassroomConfig(id, name); } catch (error) { message(error.message); } return; }
    if (event.target.matches && event.target.matches('input[data-check-all]')) {
      const type = event.target.getAttribute('data-check-all');
      const set = type === 'classroom' ? state.selectedClassroomIds : state.selectedTeacherIds;
      const ids = type === 'classroom' ? state.classrooms.map(item => item.id) : state.users.map(item => item.id);
      set.clear();
      if (event.target.checked) ids.forEach(id => set.add(id));
      await loadDashboard();
      return;
    }
    if (event.target.matches && event.target.matches('input[data-check-id]')) {
      const type = event.target.getAttribute('data-check-type');
      const id = event.target.getAttribute('data-check-id');
      const set = type === 'classroom' ? state.selectedClassroomIds : state.selectedTeacherIds;
      if (event.target.checked) set.add(id); else set.delete(id);
      await loadDashboard();
      return;
    }
    const target = event.target.closest('button[data-delete-classroom],button[data-delete-teacher],button[data-device-revoke],button[data-member-approve],button[data-member-edit],button[data-member-remove],button[data-entity-edit],button[data-user-edit]');
    if (!target) return;
    try {
      if (target.dataset.deleteClassroom) { if (confirm('确定删除教室“' + target.dataset.name + '”吗？此操作无法恢复。')) { await api('/api/v1/admin/classrooms/' + target.dataset.deleteClassroom, { method:'DELETE' }); state.selectedClassroomIds.delete(target.dataset.deleteClassroom); await loadDashboard(); message('教室已删除'); } return; }
      if (target.dataset.deleteTeacher) { if (confirm('确定删除教师账号“' + target.dataset.name + '”吗？此操作无法恢复。')) { await api('/api/v1/admin/users/' + target.dataset.deleteTeacher, { method:'DELETE' }); state.selectedTeacherIds.delete(target.dataset.deleteTeacher); await loadDashboard(); message('教师已删除'); } return; }
      if (target.dataset.entityEdit) { await openEntityEditor(target.dataset.entityType, target.dataset.entityEdit); return; }
      if (target.dataset.userEdit) { await openEntityEditor('teacher', target.dataset.userEdit); return; }
      if (target.dataset.memberApprove) await api('/api/v1/admin/classrooms/' + state.memberClassroomId + '/members/' + target.dataset.memberApprove, { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) });
      else if (target.dataset.memberEdit) { openMemberSubjectEditor(target); return; }
      else if (target.dataset.memberRemove) await api('/api/v1/admin/classrooms/' + state.memberClassroomId + '/members/' + target.dataset.memberRemove, { method: 'DELETE' });
      else if (target.dataset.deviceRevoke) await api('/api/v1/admin/classroom-devices/' + target.dataset.deviceRevoke, { method: 'DELETE' });
      if (target.dataset.memberApprove || target.dataset.memberEdit || target.dataset.memberRemove) await loadMembers();
      else await loadDashboard();
      message('操作已完成');
    } catch (error) { message(error.message); }
  });

  document.querySelector('.subtabbar').addEventListener('click', event => {
    const tab = event.target.closest('button[data-config-tab]');
    if (!tab) return;
    activateConfigTab(tab.getAttribute('data-config-tab'));
  });

  $('.tabbar').addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const tabs = [...document.querySelectorAll('[data-tab]')]; let index = tabs.indexOf(document.activeElement); if (event.key === 'Home') index = 0; else if (event.key === 'End') index = tabs.length - 1; else index = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; activateTab(tabs[index].dataset.tab, true); });

  renderSubjectOptions($('#memberSubjectOptions'));
  initialize().catch(error => message(error.message));
})();
