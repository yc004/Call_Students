/* ══════════════════════════════════════════
   密码验证窗口 — 逻辑
   ══════════════════════════════════════════ */

(function () {
  'use strict';

  const api = window.api || {};

  // ── DOM ──
  const passwordInput = document.getElementById('passwordInput');
  const errorMsg     = document.getElementById('errorMsg');
  const confirmBtn   = document.getElementById('confirmBtn');
  const cancelBtn    = document.getElementById('cancelBtn');

  // ── 获取 URL 参数中的目标窗口 ──
  const params = new URLSearchParams(window.location.search);
  const target = params.get('target') || 'manage'; // 'manage' | 'board'

  // ── 事件 ──
  confirmBtn.addEventListener('click', async () => {
    const pwd = passwordInput.value;
    if (!pwd) { passwordInput.focus(); return; }

    errorMsg.classList.add('hidden');
    try {
      const ok = await api.verifyPassword(pwd);
      if (ok) {
        // 密码正确 → 通知主进程打开目标窗口
        api.passwordOk(target);
      } else {
        errorMsg.classList.remove('hidden');
        passwordInput.value = '';
        passwordInput.focus();
      }
    } catch (e) {
      errorMsg.classList.remove('hidden');
      passwordInput.value = '';
      passwordInput.focus();
    }
  });

  cancelBtn.addEventListener('click', () => {
    api.closePassword();
  });

  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmBtn.click();
    if (e.key === 'Escape') cancelBtn.click();
  });

  // 自动聚焦
  setTimeout(() => passwordInput.focus(), 100);
})();
