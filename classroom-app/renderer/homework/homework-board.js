(function () {
  'use strict';

  var api = window.api || {};
  var STATUS = [
    { id: '已提交', label: '已提交', hint: '已完成并交给课代表', cls: 'submitted' },
    { id: '未提交', label: '未提交', hint: '尚未交作业', cls: 'missing' },
    { id: '迟交', label: '迟交', hint: '迟交但已收到', cls: 'late' },
    { id: '免交', label: '免交', hint: '本次无需提交', cls: 'exempt' }
  ];
  var state = { data: null, assignmentId: '', markStatus: '已提交', filter: 'all', saving: Promise.resolve(), pendingStudents: new Set() };
  var el = {};
  var toastTimer = null;
  var createReturnFocus = null;

  function reportError(title, error, context, suggestions) {
    if (window.clientErrors) window.clientErrors.show({ title:title, error:error, context:context, suggestions:suggestions || ['点击刷新后重试', '如果问题重复出现，请复制错误信息提交管理员'] });
  }

  function esc(value) { var node = document.createElement('div'); node.textContent = value || ''; return node.innerHTML; }
  function today() { var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function currentDate() { return el.date.value || today(); }
  function isStatisticsPhase(item) {
    // 无截止时间的历史作业兼容原有行为，直接纳入统计。
    return !item.deadline || new Date(item.deadline).getTime() <= Date.now();
  }
  function assignmentList() { return ((state.data && state.data.assignments) || []).filter(function (item) { return item.type !== 'notice' && item.date === currentDate() && isStatisticsPhase(item); }); }
  function selectedAssignment() { return assignmentList().find(function (item) { return item.id === state.assignmentId; }); }
  function statusMeta(status) { return STATUS.find(function (item) { return item.id === status; }) || STATUS[1]; }
  function submission(assignment, studentId) { return (assignment.submissions && assignment.submissions[studentId]) || '未提交'; }
  function statusCount(assignment, status) { return (state.data.students || []).filter(function (student) { return submission(assignment, student.id) === status; }).length; }
  function reportedCount(assignment) { return (state.data.students || []).filter(function (student) { var value = submission(assignment, student.id); return value === '已提交' || value === '迟交' || value === '免交'; }).length; }

  function notify(message, isError) {
    el.toast.textContent = message;
    el.toast.setAttribute('role', isError ? 'alert' : 'status');
    el.toast.classList.toggle('error', !!isError);
    el.toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('visible'); }, isError ? 5000 : 2600);
  }

  async function loadData() {
    if (!api.getData) { notify('当前预览环境未连接教室端数据', true); return; }
    try {
      var data = await api.getData();
      if (!data || !Array.isArray(data.students)) throw new Error('班级数据不可用');
      state.data = data;
      var list = assignmentList();
      if (!list.some(function (item) { return item.id === state.assignmentId; })) state.assignmentId = list[0] ? list[0].id : '';
      render();
    } catch (error) {
      console.error(error);
      notify('读取班级数据失败，请点击刷新重试', true);
      reportError('无法读取班级作业数据', error, '教室大屏－作业上报');
    }
  }

  function render() {
    var data = state.data;
    if (!data) return;
    el.info.textContent = (data.className || '未命名班级') + ' · ' + (data.students || []).length + ' 名学生';
    renderAssignments();
    var assignment = selectedAssignment();
    el.empty.hidden = !!assignment;
    el.report.hidden = !assignment;
    if (assignment) renderReport(assignment);
  }

  function renderAssignments() {
    var list = assignmentList();
    if (!list.length) {
      el.assignmentRail.innerHTML = '<div class="student-grid-empty">当前没有已进入提交统计阶段的作业。作业到达教师设定的截止时间后，会自动出现在这里。</div>';
      return;
    }
    el.assignmentRail.innerHTML = list.map(function (item) {
      var total = state.data.students.length;
      var count = reportedCount(item);
      return '<button class="assignment-card ' + (item.id === state.assignmentId ? 'selected' : '') + '" type="button" data-assignment-id="' + esc(item.id) + '">' +
        '<span class="subject">' + esc(item.subject || '未分类') + (item.source === 'student' ? '<em>学生补录</em>' : '') + '</span><span class="title">' + esc(item.title) + '</span>' +
        '<span class="meta"><span>已上报</span><strong>' + count + ' / ' + total + '</strong></span></button>';
    }).join('');
  }

  function renderReport(assignment) {
    var total = state.data.students.length;
    el.subject.textContent = (assignment.subject || '未分类作业') + (assignment.source === 'student' ? ' · 学生补录' : '');
    el.title.textContent = assignment.title || '未命名作业';
    el.progress.textContent = reportedCount(assignment) + ' / ' + total;
    el.statusActions.innerHTML = STATUS.map(function (item) {
      return '<button class="status-button status-' + item.cls + (state.markStatus === item.id ? ' selected' : '') + '" type="button" data-status="' + item.id + '">' + item.label + '<small>' + item.hint + '</small></button>';
    }).join('');
    el.tapHint.textContent = '当前将标记为「' + state.markStatus + '」';
    renderFilters(assignment);
    renderStudents(assignment);
  }

  function renderFilters(assignment) {
    var choices = [{ id: 'all', label: '全部', count: state.data.students.length }].concat(STATUS.map(function (item) {
      return { id: item.id, label: item.label, count: statusCount(assignment, item.id) };
    }));
    el.filters.innerHTML = choices.map(function (item) {
      return '<button class="filter-button' + (state.filter === item.id ? ' selected' : '') + '" type="button" data-filter="' + item.id + '">' + item.label + '<b>' + item.count + '</b></button>';
    }).join('');
  }

  function renderStudents(assignment) {
    var students = state.data.students.filter(function (student) { return state.filter === 'all' || submission(assignment, student.id) === state.filter; });
    if (!students.length) { el.grid.innerHTML = '<div class="student-grid-empty">没有符合这个状态的学生</div>'; return; }
    el.grid.innerHTML = students.map(function (student) {
      var value = submission(assignment, student.id);
      var meta = statusMeta(value);
      var pending = state.pendingStudents.has(student.id);
      return '<button class="student-card st-' + meta.cls + (pending ? ' is-saving' : '') + '" type="button" data-student-id="' + esc(student.id) + '" aria-label="' + esc(student.name) + '，当前' + value + (pending ? '，正在保存' : '') + '" aria-busy="' + String(pending) + '"' + (pending ? ' disabled' : '') + '>' +
        '<span class="student-name">' + esc(student.name) + '</span><span class="student-status">' + (pending ? '保存中…' : esc(value)) + '</span></button>';
    }).join('');
  }

  function chooseAssignment(id) { state.assignmentId = id; state.filter = 'all'; render(); }
  function chooseStatus(status) { state.markStatus = status; renderReport(selectedAssignment()); }
  function chooseFilter(filter) { state.filter = filter; renderReport(selectedAssignment()); }

  function markStudent(studentId) {
    var assignment = selectedAssignment();
    if (!assignment || !studentId) return;
    if (state.pendingStudents.has(studentId)) return;
    if (!assignment.submissions) assignment.submissions = {};
    var previousValue = submission(assignment, studentId);
    if (previousValue === state.markStatus) return;
    assignment.submissions[studentId] = state.markStatus;
    state.pendingStudents.add(studentId);
    render();
    var student = state.data.students.find(function (item) { return item.id === studentId; });
    notify('正在保存' + (student ? student.name : '该学生') + '的提交状态…');
    persistChange(assignment.id, studentId, state.markStatus, previousValue, student && student.name);
  }

  function persistChange(assignmentId, studentId, value, previousValue, studentName) {
    state.saving = state.saving.then(async function () {
      var latest = await api.getData();
      var target = (latest.assignments || []).find(function (item) { return item.id === assignmentId; });
      if (!target) throw new Error('作业已不存在');
      if (!target.submissions) target.submissions = {};
      target.submissions[studentId] = value;
      await api.saveData(latest);
      state.data = latest;
      state.pendingStudents.delete(studentId);
      render();
      notify((studentName || '该学生') + '已保存为「' + value + '」');
    }).catch(function (error) {
      console.error(error);
      state.pendingStudents.delete(studentId);
      var localAssignment = state.data && (state.data.assignments || []).find(function (item) { return item.id === assignmentId; });
      if (localAssignment) {
        if (!localAssignment.submissions) localAssignment.submissions = {};
        localAssignment.submissions[studentId] = previousValue;
      }
      render();
      notify('保存失败，已恢复原状态，请重试', true);
      reportError('作业提交状态保存失败', error, '教室大屏－作业上报', ['界面已经恢复修改前的状态，可以重新操作', '检查教室端数据目录是否可写']);
    });
  }

  function openCreate() {
    if (!state.data || !state.data.subjects || !state.data.subjects.length) { notify('当前教室还没有可选科目，请联系班主任', true); return; }
    createReturnFocus = document.activeElement;
    el.createSubject.innerHTML = state.data.subjects.map(function (subject) { return '<option value="' + esc(subject) + '">' + esc(subject) + '</option>'; }).join('');
    el.createTitle.value = '';
    el.createDateText.textContent = currentDate();
    el.createModal.hidden = false;
    setTimeout(function () { el.createTitle.focus(); }, 0);
  }
  function closeCreate() { el.createModal.hidden = true; if (createReturnFocus && createReturnFocus.focus) createReturnFocus.focus(); createReturnFocus = null; }
  function handleCreateDialogKeydown(event) {
    if (el.createModal.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closeCreate(); return; }
    if (event.key !== 'Tab') return;
    var focusable = Array.from(el.createModal.querySelectorAll('button:not([disabled]),select:not([disabled]),textarea:not([disabled])'));
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  async function createAssignment(event) {
    event.preventDefault();
    var subject = el.createSubject.value;
    var title = el.createTitle.value.trim();
    if (!subject) { notify('请选择科目', true); return; }
    if (!title) { notify('请填写作业内容', true); el.createTitle.focus(); return; }
    el.confirmCreate.disabled = true;
    el.confirmCreate.textContent = '正在创建…';
    try {
      var result = await api.createStudentAssignment({ subject: subject, title: title, date: currentDate() });
      if (!result || !result.success) throw new Error(result && result.message || '创建失败');
      closeCreate();
      await loadData();
      state.assignmentId = result.assignment.id;
      state.filter = 'all';
      render();
      notify('作业已补录，现在可以上报提交情况');
    } catch (error) { notify(error.message || '创建作业失败', true); reportError('学生补录作业失败', error, '教室大屏－创建作业'); }
    finally { el.confirmCreate.disabled = false; el.confirmCreate.textContent = '创建并开始上报'; }
  }

  function bind() {
    el.refresh.addEventListener('click', loadData);
    el.createButton.addEventListener('click', openCreate);
    el.closeCreate.addEventListener('click', closeCreate);
    el.cancelCreate.addEventListener('click', closeCreate);
    el.createForm.addEventListener('submit', createAssignment);
    el.createModal.addEventListener('click', function (event) { if (event.target === el.createModal) closeCreate(); });
    document.addEventListener('keydown', handleCreateDialogKeydown);
    el.date.addEventListener('change', function () { state.assignmentId = ''; state.filter = 'all'; render(); });
    el.assignmentRail.addEventListener('click', function (event) { var button = event.target.closest('[data-assignment-id]'); if (button) chooseAssignment(button.dataset.assignmentId); });
    el.statusActions.addEventListener('click', function (event) { var button = event.target.closest('[data-status]'); if (button) chooseStatus(button.dataset.status); });
    el.filters.addEventListener('click', function (event) { var button = event.target.closest('[data-filter]'); if (button) chooseFilter(button.dataset.filter); });
    el.grid.addEventListener('click', function (event) { var button = event.target.closest('[data-student-id]'); if (button) markStudent(button.dataset.studentId); });
  }

  function ready() {
    el = { info: document.getElementById('boardInfo'), date: document.getElementById('boardDateFilter'), refresh: document.getElementById('refreshBtn'), createButton:document.getElementById('createAssignmentBtn'), assignmentRail: document.getElementById('assignmentRail'), report: document.getElementById('reportPanel'), empty: document.getElementById('boardEmpty'), subject: document.getElementById('selectedAssignmentSubject'), title: document.getElementById('selectedAssignmentTitle'), progress: document.getElementById('progressCount'), statusActions: document.getElementById('statusActions'), tapHint: document.getElementById('tapHint'), filters: document.getElementById('studentFilters'), grid: document.getElementById('studentGrid'), toast: document.getElementById('boardToast'), createModal:document.getElementById('createAssignmentModal'), createForm:document.getElementById('createAssignmentForm'), createSubject:document.getElementById('createSubject'), createTitle:document.getElementById('createTitle'), createDateText:document.getElementById('createDateText'), closeCreate:document.getElementById('closeCreateBtn'), cancelCreate:document.getElementById('cancelCreateBtn'), confirmCreate:document.getElementById('confirmCreateBtn') };
    el.date.value = today(); bind(); loadData();
    if (api.onDataChanged) api.onDataChanged(function () { loadData(); });
    setInterval(function () {
      if (!state.data) return;
      if (!assignmentList().some(function (item) { return item.id === state.assignmentId; })) state.assignmentId = '';
      render();
    }, 15000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
