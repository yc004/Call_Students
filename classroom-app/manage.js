/* ══════════════════════════════════════════
   教室管理页 — 逻辑（学生 + 作业）
   ══════════════════════════════════════════ */

(function () {
  'use strict';

  const api = window.api || {};

  // ── DOM 引用 ──
  let classNameInp, studentTbody, emptyHint, addBtn, saveBtn, saveStatus;
  let modal, modalTitle, studentNameInp, modalCancel, modalConfirm;
  let importBtn, importModal, importText, importCancel, importConfirm;
  // 作业 DOM
  let tabBtns, tabContents;
  let subjectTags, addSubjectBtn;
  let subjectModal, subjectNameInp, subjectModalCancel, subjectModalConfirm;
  let assignmentList, addAssignmentBtn;
  let assignmentModal, assignmentModalTitle, assignmentSubject, assignmentTitle, assignmentDate;
  let assignmentModalCancel, assignmentModalConfirm;
  let mgStatusFilter, mgDateFrom, mgDateTo;
  let hwSaveBtn, hwSaveStatus;

  // ── 状态 ──
  let students = [];
  let subjects = [];
  let assignments = [];
  let editingIndex = -1;
  let editingAssignmentId = null;

  // ═══════════════════════════════
  //  加载 / 保存
  // ═══════════════════════════════

  async function loadData() {
    if (!api.getData) return;
    try {
      const data = await api.getData();
      if (classNameInp) classNameInp.value = data.className || '';
      students    = data.students || [];
      subjects    = data.subjects || [];
      assignments = data.assignments || [];
      renderTable();
      renderSubjects();
      renderAssignments();
    } catch (e) { console.error('loadData failed:', e); }
  }

  async function save() {
    if (!api.saveData) return;
    try {
      await api.saveData({
        className: classNameInp ? classNameInp.value.trim() : '',
        students,
        subjects,
        assignments,
      });
      showSaved(saveStatus || hwSaveStatus);
    } catch (e) { console.error('saveData failed:', e); }
  }

  function showSaved(el) {
    if (!el) return;
    el.textContent = '已保存';
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2000);
  }

  // ═══════════════════════════════
  //  Tab 切换
  // ═══════════════════════════════

  function switchTab(name) {
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    tabContents.forEach(c => c.classList.toggle('hidden', c.id !== 'tab-' + name));
  }

  // ═══════════════════════════════
  //  学生渲染
  // ═══════════════════════════════

  function renderTable() {
    if (!studentTbody || !emptyHint) return;
    studentTbody.innerHTML = '';
    const table = document.getElementById('studentTable');
    if (!table) return;

    if (students.length === 0) {
      emptyHint.style.display = 'block';
      table.style.display = 'none';
      return;
    }
    emptyHint.style.display = 'none';
    table.style.display = '';

    students.forEach((s, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td>${i + 1}</td>` +
        `<td>${esc(s.name)}</td>` +
        `<td>` +
          `<button class="btn btn-sm" data-edit="${i}">编辑</button> ` +
          `<button class="btn btn-sm btn-danger" data-del="${i}">删除</button>` +
        `</td>`;
      studentTbody.appendChild(tr);
    });
    studentTbody.querySelectorAll('[data-edit]').forEach(btn =>
      btn.addEventListener('click', () => openEdit(parseInt(btn.dataset.edit))));
    studentTbody.querySelectorAll('[data-del]').forEach(btn =>
      btn.addEventListener('click', () => deleteStudent(parseInt(btn.dataset.del))));
  }

  // ═══════════════════════════════
  //  学生 CRUD
  // ═══════════════════════════════

  function openAdd() {
    if (!modal || !modalTitle || !studentNameInp) return;
    editingIndex = -1;
    modalTitle.textContent = '添加学生';
    studentNameInp.value = '';
    modal.classList.remove('hidden');
    studentNameInp.focus();
  }

  function openEdit(index) {
    if (!modal || !modalTitle || !studentNameInp) return;
    if (index < 0 || index >= students.length) return;
    editingIndex = index;
    modalTitle.textContent = '编辑学生';
    studentNameInp.value = students[index].name;
    modal.classList.remove('hidden');
    studentNameInp.focus();
    studentNameInp.select();
  }

  function deleteStudent(index) {
    if (index < 0 || index >= students.length) return;
    const sid = students[index].id;
    if (!confirm(`确定删除「${students[index].name}」吗？`)) return;
    students.splice(index, 1);
    assignments.forEach(a => { delete a.submissions[sid]; });
    renderTable();
    renderAssignments();
  }

  function confirmModal() {
    if (!studentNameInp || !modal) return;
    const name = studentNameInp.value.trim();
    if (!name) { studentNameInp.focus(); return; }
    if (editingIndex >= 0) {
      students[editingIndex].name = name;
    } else {
      students.push({ id: genId(), name });
    }
    modal.classList.add('hidden');
    renderTable();
    renderAssignments();
  }

  // ═══════════════════════════════
  //  批量导入
  // ═══════════════════════════════

  function openImport() {
    if (!importModal || !importText) return;
    importText.value = '';
    importModal.classList.remove('hidden');
    importText.focus();
  }

  function confirmImport() {
    if (!importText || !importModal) return;
    const raw = importText.value.trim();
    if (!raw) return;
    const names = raw.split(/[\n,，、\s;；]+/).map(s => s.trim()).filter(s => s.length > 0);
    if (names.length === 0) return;
    let added = 0;
    for (const name of names) {
      if (students.some(s => s.name === name)) continue;
      students.push({ id: genId(), name });
      added++;
    }
    importModal.classList.add('hidden');
    renderTable();
    renderAssignments();
    if (saveStatus) {
      saveStatus.textContent = `已导入 ${added} 人` + (names.length - added > 0 ? `，跳过 ${names.length - added} 个重名` : '');
      saveStatus.classList.add('show');
      setTimeout(() => { saveStatus.classList.remove('show'); saveStatus.textContent = '已保存'; }, 2500);
    }
  }

  // ═══════════════════════════════
  //  学科管理
  // ═══════════════════════════════

  function renderSubjects() {
    if (!subjectTags) return;
    subjectTags.innerHTML = '';
    if (subjects.length === 0) {
      subjectTags.innerHTML = '<span class="empty-hint">暂无学科，请先添加</span>';
      updateSubjectSelect();
      return;
    }
    subjects.forEach((sub, i) => {
      const tag = document.createElement('span');
      tag.className = 'subject-tag';
      tag.innerHTML = `${esc(sub)} <button class="subject-tag-del" data-idx="${i}" title="删除">×</button>`;
      subjectTags.appendChild(tag);
    });
    subjectTags.querySelectorAll('.subject-tag-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeSubject(parseInt(btn.dataset.idx));
      });
    });
    updateSubjectSelect();
  }

  function updateSubjectSelect() {
    if (!assignmentSubject) return;
    assignmentSubject.innerHTML = '';
    if (subjects.length === 0) {
      assignmentSubject.innerHTML = '<option value="">-- 请先添加学科 --</option>';
      return;
    }
    subjects.forEach(sub => {
      const opt = document.createElement('option');
      opt.value = sub; opt.textContent = sub;
      assignmentSubject.appendChild(opt);
    });
  }

  function openAddSubject() {
    if (!subjectModal || !subjectNameInp) return;
    subjectNameInp.value = '';
    subjectModal.classList.remove('hidden');
    subjectNameInp.focus();
  }

  function confirmAddSubject() {
    if (!subjectNameInp || !subjectModal) return;
    const name = subjectNameInp.value.trim();
    if (!name) { subjectNameInp.focus(); return; }
    if (subjects.includes(name)) { alert('该学科已存在'); return; }
    subjects.push(name);
    subjects.sort();
    subjectModal.classList.add('hidden');
    renderSubjects();
  }

  function removeSubject(index) {
    if (index < 0 || index >= subjects.length) return;
    const sub = subjects[index];
    const cnt = assignments.filter(a => a.subject === sub).length;
    const msg = cnt ? `学科「${sub}」下有 ${cnt} 项作业，删除学科将同时删除这些作业，确定吗？` : `确定删除学科「${sub}」吗？`;
    if (!confirm(msg)) return;
    subjects.splice(index, 1);
    assignments = assignments.filter(a => a.subject !== sub);
    renderSubjects();
    renderAssignments();
  }

  // ═══════════════════════════════
  //  作业管理
  // ═══════════════════════════════

  function getFilteredAssignments() {
    let list = assignments.slice();
    const from = mgDateFrom ? mgDateFrom.value : '';
    const to   = mgDateTo   ? mgDateTo.value   : '';
    if (from) list = list.filter(a => a.date >= from);
    if (to)   list = list.filter(a => a.date <= to);
    list.sort((a, b) => a.date.localeCompare(b.date));
    return list;
  }

  function renderAssignments() {
    if (!assignmentList) return;
    if (assignments.length === 0) {
      assignmentList.innerHTML = '<span class="empty-hint">暂无作业</span>';
      return;
    }

    const builtin = ['已提交', '未提交', '迟交', '免交'];
    const customs = getCustomStatuses();

    // 更新状态筛选下拉
    if (mgStatusFilter) {
      const cur = mgStatusFilter.value;
      mgStatusFilter.innerHTML = '<option value="">全部状态</option>';
      [...builtin, ...customs].forEach(st => {
        mgStatusFilter.innerHTML += `<option value="${esc(st)}" ${cur === st ? 'selected' : ''}>${esc(st)}</option>`;
      });
    }
    const filterStatus = mgStatusFilter ? mgStatusFilter.value : '';

    // 按学科分组
    const grouped = {};
    subjects.forEach(s => { grouped[s] = []; });
    const filtered = getFilteredAssignments();
    filtered.forEach(a => {
      if (!grouped[a.subject]) grouped[a.subject] = [];
      grouped[a.subject].push(a);
    });

    let html = '';
    for (const [subject, hws] of Object.entries(grouped)) {
      if (hws.length === 0) continue;
      html += `<div class="hw-group">`;
      html += `<div class="hw-group-title">${esc(subject)} <span class="hw-count">${hws.length} 项</span></div>`;
      html += '<div class="hw-table-wrap"><table class="hw-matrix"><thead><tr>';
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

      students.forEach(s => {
        if (filterStatus) {
          const hasStatus = hws.some(a => {
            const st = a.submissions[s.id] || '未提交';
            return st === filterStatus;
          });
          if (!hasStatus) return;
        }
        html += '<tr>';
        html += `<td class="hw-matrix-name">${esc(s.name)}</td>`;
        hws.forEach(a => {
          const status = a.submissions[s.id] || '未提交';
          html += `<td class="hw-matrix-cell">`;
          html += `<select class="sub-status-select ${statusCls(status)}" data-aid="${a.id}" data-sid="${s.id}" data-prev="${esc(status)}">`;
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
      html += `</div>`;
    }
    assignmentList.innerHTML = html;

    // 批量操作
    assignmentList.querySelectorAll('.hw-batch-sel').forEach(sel => {
      sel.addEventListener('change', (e) => {
        e.stopPropagation();
        const aid = sel.dataset.batchAid;
        const status = sel.value;
        if (!status) return;
        const a = assignments.find(x => x.id === aid);
        if (a) { students.forEach(s => { a.submissions[s.id] = status; }); }
        sel.value = '';
        renderAssignments();
      });
    });

    // 编辑/删除作业
    assignmentList.querySelectorAll('[data-edit-hw]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); openEditAssignment(btn.dataset.editHw); });
    });
    assignmentList.querySelectorAll('[data-del-hw]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); deleteAssignment(btn.dataset.delHw); });
    });
    // 状态切换
    assignmentList.querySelectorAll('.sub-status-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        e.stopPropagation();
        handleStatusChange(sel);
      });
      sel.addEventListener('click', (e) => e.stopPropagation());
    });
  }

  function getCustomStatuses() {
    const set = new Set();
    const builtin = ['已提交', '未提交', '迟交', '免交'];
    assignments.forEach(a => {
      Object.values(a.submissions).forEach(v => {
        if (v && !builtin.includes(v)) set.add(v);
      });
    });
    return Array.from(set).sort();
  }

  function renderSubGrid(assignment) {
    if (students.length === 0) return '<span class="muted-note" style="padding:8px 0">暂无学生</span>';
    const builtin = ['已提交', '未提交', '迟交', '免交'];
    const customs = getCustomStatuses();
    let html = '<table class="sub-table"><thead><tr><th>学生</th><th>状态</th></tr></thead><tbody>';
    students.forEach(s => {
      const status = assignment.submissions[s.id] || '未提交';
      const cls = statusCls(status);
      html += `<tr><td class="sub-student-name">${esc(s.name)}</td><td>`;
      html += `<select class="sub-status-select ${cls}" data-aid="${assignment.id}" data-sid="${s.id}" data-prev="${esc(status)}">`;
      builtin.forEach(st => {
        html += `<option value="${st}" ${status === st ? 'selected' : ''}>${st}</option>`;
      });
      if (customs.length > 0) {
        html += `<optgroup label="自定义">`;
        customs.forEach(st => {
          html += `<option value="${esc(st)}" ${status === st ? 'selected' : ''}>${esc(st)}</option>`;
        });
        html += `</optgroup>`;
      }
      // 当前状态如果是自定义且不在列表中，也显示
      if (status && !builtin.includes(status) && !customs.includes(status)) {
        html += `<option value="${esc(status)}" selected>${esc(status)}</option>`;
      }
      html += `<option value="__custom__">✏️ 自定义...</option>`;
      html += `</select>`;
      html += `</td></tr>`;
    });
    html += '</tbody></table>';
    return html;
  }

  function statusCls(s) {
    switch (s) {
      case '已提交': return 'st-ok';
      case '迟交':   return 'st-late';
      case '免交':   return 'st-exempt';
      default:       return 'st-miss';
    }
  }

  function handleStatusChange(sel) {
    const aid = sel.dataset.aid;
    const sid = sel.dataset.sid;
    const a = assignments.find(x => x.id === aid);
    if (!a) return;

    if (sel.value === '__custom__') {
      const custom = prompt('请输入自定义状态（例如：已补交、请假等）：');
      if (!custom || !custom.trim()) {
        // 取消 → 恢复之前的值
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

    // 更新下拉框样式
    sel.className = 'sub-status-select ' + statusCls(a.submissions[sid]);

    // 更新计数
    const item = sel.closest('.hw-item');
    if (item) {
      const meta = item.querySelector('.hw-item-meta');
      if (meta) {
        const done = students.filter(s => { const st = a.submissions[s.id]; return st === '已提交' || st === '迟交'; }).length;
        meta.textContent = `${a.date} · ${done}/${students.length} 已交`;
      }
    }

    // 如果有新的自定义状态，重新渲染以更新下拉选项
    const builtin = ['已提交', '未提交', '迟交', '免交'];
    if (!builtin.includes(a.submissions[sid])) {
      renderAssignments();
    }
  }

  function openAddAssignment() {
    if (subjects.length === 0) { alert('请先添加学科'); return; }
    if (students.length === 0) { alert('请先在「学生名单」中添加学生'); return; }
    editingAssignmentId = null;
    if (assignmentModalTitle) assignmentModalTitle.textContent = '添加作业';
    if (assignmentTitle) assignmentTitle.value = '';
    if (assignmentDate) assignmentDate.value = new Date().toISOString().slice(0, 10);
    updateSubjectSelect();
    assignmentModal.classList.remove('hidden');
    if (assignmentTitle) assignmentTitle.focus();
  }

  function openEditAssignment(aid) {
    const a = assignments.find(x => x.id === aid);
    if (!a) return;
    editingAssignmentId = aid;
    if (assignmentModalTitle) assignmentModalTitle.textContent = '编辑作业';
    updateSubjectSelect();
    if (assignmentSubject) assignmentSubject.value = a.subject;
    if (assignmentTitle) assignmentTitle.value = a.title;
    if (assignmentDate) assignmentDate.value = a.date;
    assignmentModal.classList.remove('hidden');
    if (assignmentTitle) assignmentTitle.focus();
  }

  function confirmAssignment() {
    if (!assignmentTitle || !assignmentSubject || !assignmentDate || !assignmentModal) return;
    const subject = assignmentSubject.value;
    if (!subject) { alert('请选择学科'); return; }
    const title = assignmentTitle.value.trim();
    if (!title) { assignmentTitle.focus(); return; }
    const date = assignmentDate.value || new Date().toISOString().slice(0, 10);

    if (editingAssignmentId) {
      const a = assignments.find(x => x.id === editingAssignmentId);
      if (a) { a.subject = subject; a.title = title; a.date = date; }
    } else {
      const subs = {};
      students.forEach(s => { subs[s.id] = '未提交'; });
      assignments.push({ id: genId(), subject, title, date, submissions: subs });
    }
    editingAssignmentId = null;
    assignmentModal.classList.add('hidden');
    renderAssignments();
  }

  function deleteAssignment(aid) {
    const a = assignments.find(x => x.id === aid);
    if (!a) return;
    if (!confirm(`确定删除作业「${a.title}」吗？`)) return;
    assignments = assignments.filter(x => x.id !== aid);
    renderAssignments();
  }

  // ═══════════════════════════════
  //  工具
  // ═══════════════════════════════

  function genId() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // ═══════════════════════════════
  //  事件绑定
  // ═══════════════════════════════

  function bindEvents() {
    // Tab
    tabBtns.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

    // 学生
    if (addBtn)       addBtn.addEventListener('click', openAdd);
    if (saveBtn)      saveBtn.addEventListener('click', save);
    if (modalCancel)  modalCancel.addEventListener('click', () => modal.classList.add('hidden'));
    if (modalConfirm) modalConfirm.addEventListener('click', confirmModal);
    if (importBtn)    importBtn.addEventListener('click', openImport);
    if (importCancel) importCancel.addEventListener('click', () => importModal.classList.add('hidden'));
    if (importConfirm) importConfirm.addEventListener('click', confirmImport);
    if (importText) {
      importText.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') confirmImport();
        if (e.key === 'Escape') importModal.classList.add('hidden');
      });
    }
    if (importModal) importModal.addEventListener('click', (e) => { if (e.target === importModal) importModal.classList.add('hidden'); });
    if (studentNameInp) {
      studentNameInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmModal();
        if (e.key === 'Escape') modal.classList.add('hidden');
      });
    }
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

    // 学科
    if (addSubjectBtn)         addSubjectBtn.addEventListener('click', openAddSubject);
    if (subjectModalCancel)    subjectModalCancel.addEventListener('click', () => subjectModal.classList.add('hidden'));
    if (subjectModalConfirm)   subjectModalConfirm.addEventListener('click', confirmAddSubject);
    if (subjectNameInp) {
      subjectNameInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmAddSubject();
        if (e.key === 'Escape') subjectModal.classList.add('hidden');
      });
    }
    if (subjectModal) subjectModal.addEventListener('click', (e) => { if (e.target === subjectModal) subjectModal.classList.add('hidden'); });

    // 作业
    if (addAssignmentBtn)       addAssignmentBtn.addEventListener('click', openAddAssignment);
    if (mgStatusFilter) mgStatusFilter.addEventListener('change', renderAssignments);
    if (mgDateFrom) mgDateFrom.addEventListener('change', renderAssignments);
    if (mgDateTo)   mgDateTo.addEventListener('change', renderAssignments);
    if (assignmentModalCancel)  assignmentModalCancel.addEventListener('click', () => assignmentModal.classList.add('hidden'));
    if (assignmentModalConfirm) assignmentModalConfirm.addEventListener('click', confirmAssignment);
    if (assignmentTitle) {
      assignmentTitle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmAssignment();
        if (e.key === 'Escape') assignmentModal.classList.add('hidden');
      });
    }
    if (assignmentModal) assignmentModal.addEventListener('click', (e) => { if (e.target === assignmentModal) assignmentModal.classList.add('hidden'); });

    // 保存
    if (hwSaveBtn) hwSaveBtn.addEventListener('click', () => save());
  }

  // ═══════════════════════════════
  //  启动
  // ═══════════════════════════════

  function onReady() {
    classNameInp   = document.getElementById('className');
    studentTbody   = document.querySelector('#studentTable tbody');
    emptyHint      = document.getElementById('emptyHint');
    addBtn         = document.getElementById('addBtn');
    saveBtn        = document.getElementById('saveBtn');
    saveStatus     = document.getElementById('saveStatus');
    modal          = document.getElementById('modal');
    modalTitle     = document.getElementById('modalTitle');
    studentNameInp = document.getElementById('studentName');
    modalCancel    = document.getElementById('modalCancel');
    modalConfirm   = document.getElementById('modalConfirm');
    importBtn      = document.getElementById('importBtn');
    importModal    = document.getElementById('importModal');
    importText     = document.getElementById('importText');
    importCancel   = document.getElementById('importCancel');
    importConfirm  = document.getElementById('importConfirm');

    tabBtns        = document.querySelectorAll('.tab');
    tabContents    = document.querySelectorAll('.tab-content');

    subjectTags        = document.getElementById('subjectTags');
    addSubjectBtn      = document.getElementById('addSubjectBtn');
    subjectModal       = document.getElementById('subjectModal');
    subjectNameInp     = document.getElementById('subjectName');
    subjectModalCancel = document.getElementById('subjectModalCancel');
    subjectModalConfirm= document.getElementById('subjectModalConfirm');

    mgStatusFilter   = document.getElementById('mgStatusFilter');
    mgDateFrom       = document.getElementById('mgDateFrom');
    mgDateTo         = document.getElementById('mgDateTo');
    assignmentList          = document.getElementById('assignmentList');
    addAssignmentBtn        = document.getElementById('addAssignmentBtn');
    assignmentModal         = document.getElementById('assignmentModal');
    assignmentModalTitle    = document.getElementById('assignmentModalTitle');
    assignmentSubject       = document.getElementById('assignmentSubject');
    assignmentTitle         = document.getElementById('assignmentTitle');
    assignmentDate          = document.getElementById('assignmentDate');
    assignmentModalCancel   = document.getElementById('assignmentModalCancel');
    assignmentModalConfirm  = document.getElementById('assignmentModalConfirm');

    hwSaveBtn    = document.getElementById('hwSaveBtn');
    hwSaveStatus = document.getElementById('hwSaveStatus');

    bindEvents();
    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
