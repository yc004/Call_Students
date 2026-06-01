/* ══════════════════════════════════════════
   作业看板 — 悬浮窗逻辑
   ══════════════════════════════════════════ */

(function () {
  'use strict';
  const api = window.api || {};

  let boardBar, boardInfo;
  let boardSubjectFilter, boardAssignFilter, boardStatusFilter;
  let addHwBtn, refreshBtn, closeBtn;
  let boardEmpty, boardTableWrap, addFirstBtn;
  let addModal, addSubject, addTitle, addCancel, addConfirm;
  let cachedData = null;

  // ── 拖拽 ──
  let dragging = false, dragX = 0, dragY = 0;
  function initDrag() {
    if (!boardBar) return;
    boardBar.addEventListener('mousedown', (e) => {
      if (e.target.closest('button') || e.target.closest('select')) return;
      dragging = true; dragX = e.screenX; dragY = e.screenY;
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.screenX - dragX, dy = e.screenY - dragY;
      dragX = e.screenX; dragY = e.screenY;
      if (api.moveBoard) api.moveBoard(dx, dy);
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  }

  // ═══════════════════════════════
  //  加载 + 渲染
  // ═══════════════════════════════

  async function refresh() {
    if (!api.getData) return;
    const data = await api.getData();
    if (!data) return;
    cachedData = data;
    render(data);
  }

  function render(data) {
    const today = new Date().toISOString().slice(0, 10);
    const todayHws = (data.assignments || []).filter(a => a.date === today);
    const builtin = ['已提交', '未提交', '迟交', '免交'];
    const customs = getCustoms(data.assignments, builtin);
    const students = data.students || [];
    const subjects = data.subjects || [];

    // 更新筛选下拉
    if (boardSubjectFilter) {
      const cur = boardSubjectFilter.value;
      boardSubjectFilter.innerHTML = '<option value="">全部学科</option>';
      subjects.forEach(s => { boardSubjectFilter.innerHTML += '<option value="' + esc(s) + '" ' + (cur === s ? 'selected' : '') + '>' + esc(s) + '</option>'; });
    }
    if (boardAssignFilter) {
      const cur = boardAssignFilter.value;
      const subj = boardSubjectFilter ? boardSubjectFilter.value : '';
      boardAssignFilter.innerHTML = '<option value="">全部作业</option>';
      todayHws.filter(a => !subj || a.subject === subj).forEach(a => {
        boardAssignFilter.innerHTML += '<option value="' + a.id + '" ' + (cur === a.id ? 'selected' : '') + '>' + esc(a.subject) + ' - ' + esc(a.title) + '</option>';
      });
    }
    if (boardStatusFilter) {
      const cur = boardStatusFilter.value;
      boardStatusFilter.innerHTML = '<option value="">全部状态</option>';
      [...builtin, ...customs].forEach(st => {
        boardStatusFilter.innerHTML += '<option value="' + esc(st) + '" ' + (cur === st ? 'selected' : '') + '>' + esc(st) + '</option>';
      });
    }

    const filterSubj = boardSubjectFilter ? boardSubjectFilter.value : '';
    const filterAid = boardAssignFilter ? boardAssignFilter.value : '';
    const filterSt  = boardStatusFilter ? boardStatusFilter.value : '';

    let hws = todayHws;
    if (filterSubj) hws = hws.filter(a => a.subject === filterSubj);
    if (filterAid) hws = hws.filter(a => a.id === filterAid);

    if (boardInfo) boardInfo.textContent = (data.className || '未命名班级') + ' · ' + today;

    if (hws.length === 0) {
      if (boardEmpty) boardEmpty.style.display = '';
      if (boardTableWrap) boardTableWrap.classList.add('hidden');
      return;
    }
    if (boardEmpty) boardEmpty.style.display = 'none';
    if (boardTableWrap) boardTableWrap.classList.remove('hidden');

    let html = '<table class="b-table"><thead><tr><th class="b-name-th">姓名</th>';
    hws.forEach(a => {
      const done = students.filter(s => { const st = a.submissions[s.id]; return st === '已提交' || st === '迟交'; }).length;
      html += '<th><div class="b-hw-title">' + esc(a.title) + '</div>';
      html += '<div class="b-hw-subj">' + esc(a.subject) + '</div>';
      html += '<div class="b-hw-cnt">' + done + '/' + students.length + '</div>';
      html += '<select class="b-batch-sel" data-batch-aid="' + a.id + '">';
      html += '<option value="">批量▼</option><option value="已提交">全部已提交</option>';
      html += '<option value="未提交">全部未提交</option><option value="迟交">全部迟交</option>';
      html += '<option value="免交">全部免交</option></select></th>';
    });
    html += '</tr></thead><tbody>';
    students.forEach(s => {
      if (filterSt) {
        const has = hws.some(a => { const st = (a.submissions && a.submissions[s.id]) || '未提交'; return st === filterSt; });
        if (!has) return;
      }
      html += '<tr><td class="b-name-td">' + esc(s.name) + '</td>';
      hws.forEach(a => {
        const status = (a.submissions && a.submissions[s.id]) || '未提交';
        html += '<td class="b-cell"><select class="b-sel ' + statusCls(status) + '" data-aid="' + a.id + '" data-sid="' + s.id + '" data-prev="' + esc(status) + '">';
        builtin.forEach(st => { html += '<option value="' + st + '" ' + (status === st ? 'selected' : '') + '>' + st + '</option>'; });
        if (customs.length > 0) {
          html += '<optgroup label="自定义">';
          customs.forEach(st => { html += '<option value="' + esc(st) + '" ' + (status === st ? 'selected' : '') + '>' + esc(st) + '</option>'; });
          html += '</optgroup>';
        }
        if (status && !builtin.includes(status) && !customs.includes(status)) html += '<option value="' + esc(status) + '" selected>' + esc(status) + '</option>';
        html += '<option value="__custom__">✏️ 自定义...</option></select></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    boardTableWrap.innerHTML = html;

    // 批量
    boardTableWrap.querySelectorAll('.b-batch-sel').forEach(sel => {
      sel.addEventListener('change', () => {
        const aid = sel.dataset.batchAid, status = sel.value;
        if (!status) return;
        const a = (cachedData.assignments || []).find(x => x.id === aid);
        if (a) { (cachedData.students || []).forEach(s => { a.submissions[s.id] = status; }); if (api.saveData) api.saveData(cachedData); }
        sel.value = ''; refresh();
      });
    });
    // 状态变更
    boardTableWrap.querySelectorAll('.b-sel').forEach(sel => {
      sel.addEventListener('change', () => {
        const aid = sel.dataset.aid, sid = sel.dataset.sid;
        const a = (cachedData.assignments || []).find(x => x.id === aid);
        if (!a) return;
        if (sel.value === '__custom__') {
          const custom = prompt('请输入自定义状态：');
          if (!custom || !custom.trim()) { sel.value = sel.dataset.prev; return; }
          const val = custom.trim(); a.submissions[sid] = val; sel.dataset.prev = val;
        } else { a.submissions[sid] = sel.value; sel.dataset.prev = sel.value; }
        sel.className = 'b-sel ' + statusCls(a.submissions[sid]);
        if (api.saveData) api.saveData(cachedData);
        if (!builtin.includes(a.submissions[sid])) refresh();
      });
    });
  }

  // ── 添加作业 ──
  function openAddModal() {
    if (!addModal || !addSubject) return;
    const data = cachedData;
    if (!data || (data.subjects || []).length === 0) { alert('请先在管理窗口中添加学科'); return; }
    if ((data.students || []).length === 0) { alert('请先在管理窗口中添加学生'); return; }
    addSubject.innerHTML = '';
    (data.subjects || []).forEach(s => { addSubject.innerHTML += '<option value="' + esc(s) + '">' + esc(s) + '</option>'; });
    addTitle.value = ''; addModal.classList.remove('hidden'); addTitle.focus();
  }
  function confirmAdd() {
    if (!addTitle || !addSubject || !addModal) return;
    const subject = addSubject.value, title = addTitle.value.trim();
    if (!title) { addTitle.focus(); return; }
    const today = new Date().toISOString().slice(0, 10);
    const data = cachedData, submissions = {};
    (data.students || []).forEach(s => { submissions[s.id] = '未提交'; });
    data.assignments.push({ id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), subject, title, date: today, submissions });
    if (api.saveData) api.saveData(data);
    addModal.classList.add('hidden'); refresh();
  }
  function closeAddModal() { if (addModal) addModal.classList.add('hidden'); }

  // ── 工具 ──
  function getCustoms(assignments, builtin) {
    const set = new Set();
    assignments.forEach(a => { Object.values(a.submissions || {}).forEach(v => { if (v && !builtin.includes(v)) set.add(v); }); });
    return Array.from(set).sort();
  }
  function statusCls(s) {
    switch (s) { case '已提交': return 'st-ok'; case '迟交': return 'st-late'; case '免交': return 'st-exempt'; default: return 'st-miss'; }
  }
  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

  // ── 事件 ──
  function bindEvents() {
    if (closeBtn) closeBtn.addEventListener('click', () => { if (api.closeBoard) api.closeBoard(); });
    if (refreshBtn) refreshBtn.addEventListener('click', refresh);
    if (boardSubjectFilter) boardSubjectFilter.addEventListener('change', () => { if (cachedData) render(cachedData); });
    if (boardAssignFilter)  boardAssignFilter.addEventListener('change', () => { if (cachedData) render(cachedData); });
    if (boardStatusFilter)  boardStatusFilter.addEventListener('change', () => { if (cachedData) render(cachedData); });
    if (addHwBtn) addHwBtn.addEventListener('click', openAddModal);
    if (addFirstBtn) addFirstBtn.addEventListener('click', openAddModal);
    if (addCancel) addCancel.addEventListener('click', closeAddModal);
    if (addConfirm) addConfirm.addEventListener('click', confirmAdd);
    if (addTitle) addTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmAdd(); if (e.key === 'Escape') closeAddModal(); });
    if (addModal) addModal.addEventListener('click', (e) => { if (e.target === addModal) closeAddModal(); });
    if (api.onDataChanged) api.onDataChanged(() => refresh());
  }

  setInterval(refresh, 30000);

  function onReady() {
    boardBar           = document.getElementById('boardBar');
    boardInfo          = document.getElementById('boardInfo');
    boardSubjectFilter = document.getElementById('boardSubjectFilter');
    boardAssignFilter  = document.getElementById('boardAssignFilter');
    boardStatusFilter  = document.getElementById('boardStatusFilter');
    addHwBtn = document.getElementById('addHwBtn'); refreshBtn = document.getElementById('refreshBtn'); closeBtn = document.getElementById('closeBtn');
    boardEmpty = document.getElementById('boardEmpty'); addFirstBtn = document.getElementById('addFirstBtn');
    boardTableWrap = document.getElementById('boardTableWrap');
    addModal = document.getElementById('addModal'); addSubject = document.getElementById('addSubject');
    addTitle = document.getElementById('addTitle'); addCancel = document.getElementById('addCancel'); addConfirm = document.getElementById('addConfirm');
    initDrag(); bindEvents(); refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();
})();
