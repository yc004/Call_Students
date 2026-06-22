/* ══════════════════════════════════════════
   作业看板 — 逻辑（无边框 + 下拉菜单版）
   · 工具栏 CSS 拖拽，无 JS 拖拽 IPC
   · 单元格：<select> 下拉切换状态
   · 事件委托 + 增量更新 + CSS 筛选
   ══════════════════════════════════════════ */

(function () {
  'use strict';
  var api = window.api || {};

  var boardInfo, boardDebug, boardDateFilter;
  var boardSubjectFilter, boardAssignFilter, boardStatusFilter;
  var addHwBtn, refreshBtn, closeBtn;
  var boardEmpty, boardTableWrap, addFirstBtn;
  var addModal, addSubject, addTitle, addCancel, addConfirm;

  var BUILTIN = ['已提交', '未提交', '迟交', '免交'];
  var cachedData = null;
  var todayHws = [];
  var _pendingSave = false;

  // ═══════════════════════════════
  //  日志
  // ═══════════════════════════════
  function bLog(tag, msg) {
    var ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    if (api.boardLog) api.boardLog(tag, msg);
    console.log(ts + ' [' + tag + ']', msg);
    if (boardDebug) boardDebug.textContent = ts + ' [' + tag + '] ' + msg;
  }

  function statusCls(s) {
    switch (s) { case '已提交': return 'st-ok'; case '迟交': return 'st-late'; case '免交': return 'st-exempt'; default: return 'st-miss'; }
  }
  function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function selectedDate() {
    return boardDateFilter && boardDateFilter.value ? boardDateFilter.value : todayStr();
  }

  // ═══════════════════════════════
  //  数据加载
  // ═══════════════════════════════

  async function loadAndRender() {
    if (!api.getData) { bLog('err', 'no api'); return; }
    var t0 = performance.now();
    try {
      bLog('load', 'start');
      var data = await api.getData();
      var t1 = performance.now();
      if (!data || !data.students) { bLog('load', 'no data'); return; }

      var prev = cachedData;
      cachedData = data;
      todayHws = (data.assignments || []).filter(function (a) { return a.date === selectedDate(); });

      bLog('load', data.students.length + 's/' + todayHws.length + 'hw IPC=' + (t1 - t0).toFixed(0) + 'ms');
      updateFilters();

      if (!prev || structureChanged(prev, data)) {
        bLog('render', 'buildTable');
        buildTable(data);
        bLog('render', 'done ' + (performance.now() - t1).toFixed(0) + 'ms');
      } else {
        bLog('render', 'diffUpdate');
        diffUpdate(prev, data);
        bLog('render', 'done ' + (performance.now() - t1).toFixed(0) + 'ms');
      }
    } catch (e) { bLog('err', e.message); console.error(e); }
  }

  function structureChanged(prev, cur) {
    if (prev.students.length !== cur.students.length) return true;
    for (var i = 0; i < prev.students.length; i++) {
      if (prev.students[i].id !== cur.students[i].id) return true;
    }
    var prevHw = (prev.assignments || []).filter(function (a) { return a.date === selectedDate(); });
    var curHw  = (cur.assignments || []).filter(function (a) { return a.date === selectedDate(); });
    if (prevHw.length !== curHw.length) return true;
    for (var i = 0; i < prevHw.length; i++) {
      if (prevHw[i].id !== curHw[i].id) return true;
    }
    return false;
  }

  function diffUpdate(prev, cur) {
    if (!boardTableWrap) return;
    var prevHw = (prev.assignments || []).filter(function (a) { return a.date === selectedDate(); });
    var students = cur.students || [];
    prevHw.forEach(function (a) {
      var curA = (cur.assignments || []).find(function (x) { return x.id === a.id; });
      if (!curA || !curA.submissions) return;
      students.forEach(function (s) {
        var oldSt = (a.submissions && a.submissions[s.id]) || '未提交';
        var newSt = curA.submissions[s.id] || '未提交';
        if (oldSt !== newSt) updateCell(a.id, s.id, newSt);
      });
    });
    // 更新计数
    todayHws.forEach(function (a) {
      var el = boardTableWrap.querySelector('[data-done="' + a.id + '"]');
      if (el) {
        var done = students.filter(function (s) { var st = a.submissions[s.id]; return st === '已提交' || st === '迟交'; }).length;
        el.textContent = done + '/' + students.length;
      }
    });
  }

  function updateCell(aid, sid, status) {
    if (!boardTableWrap) return;
    var sel = boardTableWrap.querySelector('[data-cid="' + aid + '|' + sid + '"]');
    if (!sel) return;
    sel.value = status;
    sel.className = 'b-sel ' + statusCls(status);
    sel.dataset.prev = status;
  }

  // ═══════════════════════════════
  //  筛选
  // ═══════════════════════════════

  function updateFilters() {
    var data = cachedData;
    if (!data) return;
    var subjects = data.subjects || [];
    var customs = getCustoms();

    if (boardSubjectFilter) {
      var cur = boardSubjectFilter.value;
      var p = ['<option value="">全部学科</option>'];
      subjects.forEach(function (s) { p.push('<option value="' + esc(s) + '"' + (cur === s ? ' selected' : '') + '>' + esc(s) + '</option>'); });
      boardSubjectFilter.innerHTML = p.join('');
    }
    if (boardAssignFilter) {
      var cur = boardAssignFilter.value;
      var subj = boardSubjectFilter ? boardSubjectFilter.value : '';
      var p = ['<option value="">全部作业</option>'];
      todayHws.filter(function (a) { return !subj || a.subject === subj; }).forEach(function (a) {
        p.push('<option value="' + a.id + '"' + (cur === a.id ? ' selected' : '') + '>' + esc(a.subject) + ' - ' + esc(a.title) + '</option>');
      });
      boardAssignFilter.innerHTML = p.join('');
    }
    if (boardStatusFilter) {
      var cur = boardStatusFilter.value;
      var all = BUILTIN.concat(customs);
      var p = ['<option value="">全部状态</option>'];
      all.forEach(function (st) { p.push('<option value="' + esc(st) + '"' + (cur === st ? ' selected' : '') + '>' + esc(st) + '</option>'); });
      boardStatusFilter.innerHTML = p.join('');
    }
    applyFilters();
  }

  function applyFilters() {
    if (!boardTableWrap) return;
    var subj = boardSubjectFilter ? boardSubjectFilter.value : '';
    var aid  = boardAssignFilter  ? boardAssignFilter.value  : '';
    var st   = boardStatusFilter  ? boardStatusFilter.value  : '';

    var hws = todayHws;
    if (subj) hws = hws.filter(function (a) { return a.subject === subj; });
    if (aid)  hws = hws.filter(function (a) { return a.id === aid; });

    var tbody = boardTableWrap.querySelector('tbody');
    if (!tbody) return;
    var rows = tbody.querySelectorAll('tr');
    rows.forEach(function (row) {
      if (!st) { row.classList.remove('row-hidden'); return; }
      var visible = false;
      hws.forEach(function (a) {
        var sel = row.querySelector('[data-cid^="' + a.id + '|"]');
        if (sel && sel.value === st) visible = true;
      });
      row.classList.toggle('row-hidden', !visible);
    });
  }

  function getCustoms() {
    var set = new Set();
    (cachedData && cachedData.assignments || []).forEach(function (a) {
      Object.values(a.submissions || {}).forEach(function (v) { if (v && BUILTIN.indexOf(v) === -1) set.add(v); });
    });
    return Array.from(set).sort();
  }

  // ═══════════════════════════════
  //  表格构建
  // ═══════════════════════════════

  function buildTable(data) {
    var students = data.students || [];

    if (todayHws.length === 0) {
      if (boardEmpty) boardEmpty.style.display = '';
      if (boardTableWrap) boardTableWrap.innerHTML = '';
      return;
    }
    if (boardEmpty) boardEmpty.style.display = 'none';
    if (boardInfo) boardInfo.textContent = (data.className || '未命名班级') + ' · ' + selectedDate();

    var customs = getCustoms();
    var parts = [];
    parts.push('<table class="b-table"><thead><tr><th>姓名</th>');
    todayHws.forEach(function (a) {
      var done = students.filter(function (s) { var st = a.submissions[s.id]; return st === '已提交' || st === '迟交'; }).length;
      parts.push('<th><div class="b-hw-title">' + esc(a.title) + '</div>');
      parts.push('<div class="b-hw-subj">' + esc(a.subject) + '</div>');
      parts.push('<div class="b-hw-cnt" data-done="' + a.id + '">' + done + '/' + students.length + '</div>');
      parts.push('<select class="b-batch-sel" data-batch-aid="' + a.id + '">');
      parts.push('<option value="">批量▼</option><option value="已提交">全部已提交</option>');
      parts.push('<option value="未提交">全部未提交</option><option value="迟交">全部迟交</option>');
      parts.push('<option value="免交">全部免交</option></select>');
      parts.push('<button class="b-del-hw" data-del-hw="' + a.id + '" title="删除此作业">×</button></th>');
    });
    parts.push('</tr></thead><tbody>');
    students.forEach(function (s) {
      parts.push('<tr><td>' + esc(s.name) + '</td>');
      todayHws.forEach(function (a) {
        var status = (a.submissions && a.submissions[s.id]) || '未提交';
        parts.push('<td><select class="b-sel ' + statusCls(status) + '" data-cid="' + a.id + '|' + s.id + '" data-prev="' + esc(status) + '">');
        BUILTIN.forEach(function (st) { parts.push('<option value="' + st + '"' + (status === st ? ' selected' : '') + '>' + st + '</option>'); });
        if (customs.length > 0) {
          parts.push('<optgroup label="自定义">');
          customs.forEach(function (st) { parts.push('<option value="' + esc(st) + '"' + (status === st ? ' selected' : '') + '>' + esc(st) + '</option>'); });
          parts.push('</optgroup>');
        }
        if (status && BUILTIN.indexOf(status) === -1 && customs.indexOf(status) === -1) {
          parts.push('<option value="' + esc(status) + '" selected>' + esc(status) + '</option>');
        }
        parts.push('<option value="__custom__">✏️ 自定义…</option></select></td>');
      });
      parts.push('</tr>');
    });
    parts.push('</tbody></table>');
    boardTableWrap.innerHTML = parts.join('');
    attachEvents();
    applyFilters();
  }

  // ═══════════════════════════════
  //  事件委托
  // ═══════════════════════════════

  function attachEvents() {
    if (!boardTableWrap) return;

    // 状态下拉变化
    boardTableWrap.addEventListener('change', function (e) {
      // 批量操作
      var batch = e.target.closest('.b-batch-sel');
      if (batch) {
        var aid = batch.dataset.batchAid, status = batch.value;
        if (!status) return;
        var a = (cachedData.assignments || []).find(function (x) { return x.id === aid; });
        if (!a) return;
        (cachedData.students || []).forEach(function (s) { a.submissions[s.id] = status; });
        _pendingSave = true;
        if (api.saveData) api.saveData(cachedData);
        batch.value = '';
        boardTableWrap.querySelectorAll('[data-cid^="' + aid + '|"]').forEach(function (sel) {
          sel.value = status; sel.className = 'b-sel ' + statusCls(status); sel.dataset.prev = status;
        });
        var doneEl = boardTableWrap.querySelector('[data-done="' + aid + '"]');
        if (doneEl) doneEl.textContent = (cachedData.students || []).length + '/' + (cachedData.students || []).length;
        applyFilters();
        return;
      }

      // 单个状态变化
      var sel = e.target.closest('.b-sel');
      if (!sel || !sel.dataset.cid) return;
      var parts = sel.dataset.cid.split('|');
      if (parts.length !== 2) return;
      var aid = parts[0], sid = parts[1];

      if (sel.value === '__custom__') {
        var custom = prompt('请输入自定义状态：');
        if (!custom || !custom.trim()) { sel.value = sel.dataset.prev; return; }
        var val = custom.trim();
        applyStatus(aid, sid, val, sel);
      } else {
        applyStatus(aid, sid, sel.value, sel);
      }
    });

    // 删除作业
    boardTableWrap.addEventListener('click', function (e) {
      var delBtn = e.target.closest('.b-del-hw');
      if (!delBtn) return;
      e.stopPropagation();
      var aid = delBtn.dataset.delHw;
      var a = (cachedData.assignments || []).find(function (x) { return x.id === aid; });
      if (!a) return;
      if (!confirm('确定删除作业「' + a.title + '」吗？')) return;
      cachedData.assignments = (cachedData.assignments || []).filter(function (x) { return x.id !== aid; });
      _pendingSave = true;
      if (api.saveData) api.saveData(cachedData);
      cachedData = null;
      loadAndRender();
    });
  }

  function applyStatus(aid, sid, status, selEl) {
    var a = (cachedData.assignments || []).find(function (x) { return x.id === aid; });
    if (!a) return;
    a.submissions[sid] = status;
    var sel = selEl || (boardTableWrap && boardTableWrap.querySelector('[data-cid="' + aid + '|' + sid + '"]'));
    if (sel) {
      sel.value = status;
      sel.className = 'b-sel ' + statusCls(status);
      sel.dataset.prev = status;
    }
    var students = cachedData.students || [];
    var doneEl = boardTableWrap && boardTableWrap.querySelector('[data-done="' + aid + '"]');
    if (doneEl) {
      var done = students.filter(function (s) { var st = a.submissions[s.id]; return st === '已提交' || st === '迟交'; }).length;
      doneEl.textContent = done + '/' + students.length;
    }
    _pendingSave = true;
    if (api.saveData) api.saveData(cachedData);
    if (BUILTIN.indexOf(status) === -1) updateFilters();
    applyFilters();
  }

  // ═══════════════════════════════
  //  添加作业
  // ═══════════════════════════════

  function openAddModal() {
    if (!addModal || !addSubject) return;
    var data = cachedData;
    if (!data || (data.subjects || []).length === 0) { alert('请先在管理窗口中添加学科'); return; }
    if ((data.students || []).length === 0) { alert('请先在管理窗口中添加学生'); return; }
    var p = [];
    (data.subjects || []).forEach(function (s) { p.push('<option value="' + esc(s) + '">' + esc(s) + '</option>'); });
    addSubject.innerHTML = p.join('');
    addTitle.value = ''; addModal.classList.remove('hidden'); addTitle.focus();
  }

  async function confirmAdd() {
    if (!addTitle || !addSubject) return;
    var subject = addSubject.value, title = addTitle.value.trim();
    if (!title) { addTitle.focus(); return; }
    var td = selectedDate();
    var data = cachedData, submissions = {};
    (data.students || []).forEach(function (s) { submissions[s.id] = '未提交'; });
    data.assignments.push({ id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), subject: subject, title: title, date: td, submissions: submissions });
    _pendingSave = true;
    if (api.saveData) await api.saveData(data);
    addModal.classList.add('hidden');
    cachedData = null;  // 清空引用，强制 loadAndRender 走 buildTable
    loadAndRender();
  }

  // ═══════════════════════════════
  //  生命周期
  // ═══════════════════════════════

  if (api.onDataChanged) api.onDataChanged(function () {
    if (_pendingSave) { bLog('event', 'dc skip(self)'); _pendingSave = false; return; }
    bLog('event', 'data-changed');
    loadAndRender();
  });

  setInterval(function () { _pendingSave = false; loadAndRender(); }, 30000);

  function bindUI() {
    if (closeBtn) closeBtn.addEventListener('click', function () { if (api.closeBoard) api.closeBoard(); });
    if (refreshBtn) refreshBtn.addEventListener('click', loadAndRender);
    if (boardDateFilter)  boardDateFilter.addEventListener('change',  function () {
      // 切换日期：重新过滤 todayHws 并重建表格
      if (!cachedData) { loadAndRender(); return; }
      todayHws = (cachedData.assignments || []).filter(function (a) { return a.date === selectedDate(); });
      updateFilters();
      buildTable(cachedData);
    });
    if (boardSubjectFilter) boardSubjectFilter.addEventListener('change', function () { updateFilters(); });
    if (boardAssignFilter)  boardAssignFilter.addEventListener('change',  function () { updateFilters(); });
    if (boardStatusFilter)  boardStatusFilter.addEventListener('change', function () { applyFilters(); });
    if (addHwBtn) addHwBtn.addEventListener('click', openAddModal);
    if (addFirstBtn) addFirstBtn.addEventListener('click', openAddModal);
    if (addCancel) addCancel.addEventListener('click', function () { addModal.classList.add('hidden'); });
    if (addConfirm) addConfirm.addEventListener('click', confirmAdd);
    if (addTitle) addTitle.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') confirmAdd();
      if (e.key === 'Escape') addModal.classList.add('hidden');
    });
    if (addModal) addModal.addEventListener('click', function (e) { if (e.target === addModal) addModal.classList.add('hidden'); });
  }

  function onReady() {
    boardInfo          = document.getElementById('boardInfo');
    boardDebug         = document.getElementById('boardDebug');
    boardDateFilter    = document.getElementById('boardDateFilter');
    boardSubjectFilter = document.getElementById('boardSubjectFilter');
    boardAssignFilter  = document.getElementById('boardAssignFilter');
    boardStatusFilter  = document.getElementById('boardStatusFilter');
    // 初始化日期为今天
    if (boardDateFilter) boardDateFilter.value = todayStr();
    addHwBtn     = document.getElementById('addHwBtn');
    refreshBtn   = document.getElementById('refreshBtn');
    closeBtn     = document.getElementById('closeBtn');
    boardEmpty   = document.getElementById('boardEmpty');
    boardTableWrap = document.getElementById('boardTableWrap');
    addFirstBtn  = document.getElementById('addFirstBtn');
    addModal     = document.getElementById('addModal');
    addSubject   = document.getElementById('addSubject');
    addTitle     = document.getElementById('addTitle');
    addCancel    = document.getElementById('addCancel');
    addConfirm   = document.getElementById('addConfirm');

    bindUI();
    bLog('init', 'ready, render in 50ms');
    setTimeout(loadAndRender, 50);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();
})();
