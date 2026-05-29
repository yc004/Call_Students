/* ══════════════════════════════════════════
   教室管理页 — 逻辑
   ══════════════════════════════════════════ */

(function () {
  'use strict';

  const api = window.api || {};

  // ── DOM 引用 ──
  let classNameInp, studentTbody, emptyHint, addBtn, saveBtn, saveStatus;
  let modal, modalTitle, studentNameInp, modalCancel, modalConfirm;
  let importBtn, importModal, importText, importCancel, importConfirm;

  // ── 状态 ──
  let students = [];
  let editingIndex = -1;

  // ═══════════════════════════════
  //  加载 / 保存
  // ═══════════════════════════════

  async function loadData() {
    if (!api.getData) return;
    try {
      const data = await api.getData();
      if (classNameInp) classNameInp.value = data.className || '';
      students = data.students || [];
      renderTable();
    } catch (e) { console.error('loadData failed:', e); }
  }

  async function save() {
    if (!api.saveData) return;
    try {
      await api.saveData({
        className: classNameInp ? classNameInp.value.trim() : '',
        students,
      });
      showSaved();
    } catch (e) { console.error('saveData failed:', e); }
  }

  function showSaved() {
    if (!saveStatus) return;
    saveStatus.classList.add('show');
    setTimeout(() => saveStatus.classList.remove('show'), 2000);
  }

  // ═══════════════════════════════
  //  渲染表格
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
      btn.addEventListener('click', () => openEdit(parseInt(btn.dataset.edit)))
    );
    studentTbody.querySelectorAll('[data-del]').forEach(btn =>
      btn.addEventListener('click', () => deleteStudent(parseInt(btn.dataset.del)))
    );
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
    if (!confirm(`确定删除「${students[index].name}」吗？`)) return;
    students.splice(index, 1);
    renderTable();
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

    // 按换行、逗号、顿号、空格、分号 拆分
    const names = raw
      .split(/[\n,，、\s;；]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (names.length === 0) return;

    let added = 0;
    for (const name of names) {
      // 跳过重名
      if (students.some(s => s.name === name)) continue;
      students.push({ id: genId(), name });
      added++;
    }

    importModal.classList.add('hidden');
    renderTable();

    // 短暂提示
    if (saveStatus) {
      saveStatus.textContent = `已导入 ${added} 人` + (names.length - added > 0 ? `，跳过 ${names.length - added} 个重名` : '');
      saveStatus.classList.add('show');
      setTimeout(() => { saveStatus.classList.remove('show'); saveStatus.textContent = '已保存'; }, 2500);
    }
  }

  // ═══════════════════════════════
  //  事件绑定
  // ═══════════════════════════════

  function bindEvents() {
    if (addBtn)         addBtn.addEventListener('click', openAdd);
    if (saveBtn)        saveBtn.addEventListener('click', save);
    if (modalCancel)    modalCancel.addEventListener('click', () => modal && modal.classList.add('hidden'));
    if (modalConfirm)   modalConfirm.addEventListener('click', confirmModal);

    // 批量导入
    if (importBtn)      importBtn.addEventListener('click', openImport);
    if (importCancel)   importCancel.addEventListener('click', () => importModal && importModal.classList.add('hidden'));
    if (importConfirm)  importConfirm.addEventListener('click', confirmImport);
    if (importText) {
      importText.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') confirmImport();
        if (e.key === 'Escape') importModal && importModal.classList.add('hidden');
      });
    }
    if (importModal) {
      importModal.addEventListener('click', (e) => {
        if (e.target === importModal) importModal.classList.add('hidden');
      });
    }

    if (studentNameInp) {
      studentNameInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmModal();
        if (e.key === 'Escape') modal && modal.classList.add('hidden');
      });
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
      });
    }
  }

  // ═══════════════════════════════
  //  启动
  // ═══════════════════════════════

  function onReady() {
    classNameInp  = document.getElementById('className');
    studentTbody  = document.querySelector('#studentTable tbody');
    emptyHint     = document.getElementById('emptyHint');
    addBtn        = document.getElementById('addBtn');
    saveBtn       = document.getElementById('saveBtn');
    saveStatus    = document.getElementById('saveStatus');
    modal         = document.getElementById('modal');
    modalTitle    = document.getElementById('modalTitle');
    studentNameInp= document.getElementById('studentName');
    modalCancel   = document.getElementById('modalCancel');
    modalConfirm  = document.getElementById('modalConfirm');

    importBtn     = document.getElementById('importBtn');
    importModal   = document.getElementById('importModal');
    importText    = document.getElementById('importText');
    importCancel  = document.getElementById('importCancel');
    importConfirm = document.getElementById('importConfirm');

    bindEvents();
    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
