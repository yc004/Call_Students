/* ══════════════════════════════════════════
   呼叫弹窗 — 逻辑（系统 TTS 语音）
   ══════════════════════════════════════════ */

(function () {
  'use strict';

  const api = window.api || {};

  // ── DOM ──
  let callClass, callStudent, callMessage, closeBtn, timerBar;

  const DISPLAY_DURATION = 8000;
  let dismissTimer = null;

  // ═══════════════════════════════════
  //  语音合成（选最优系统中文语音）
  // ═══════════════════════════════════

  let bestVoice = null;

  function loadVoices() {
    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) return;
    const preferred = [
      'Microsoft Huihui',
      'Ting-Ting',
      'Google 普通话',
      'Microsoft Kangkang',
    ];
    for (const name of preferred) {
      const v = voices.find(v => v.name.includes(name));
      if (v) { bestVoice = v; return; }
    }
    bestVoice = voices.find(v => v.lang.startsWith('zh-CN')) ||
                voices.find(v => v.lang.startsWith('zh')) ||
                null;
  }

  if ('speechSynthesis' in window) {
    speechSynthesis.addEventListener('voiceschanged', loadVoices);
    loadVoices();
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    if (!bestVoice) loadVoices();
    const u = new SpeechSynthesisUtterance(text);
    u.lang   = 'zh-CN';
    u.rate   = 0.9;
    u.pitch  = 1.0;
    u.volume = 1;
    if (bestVoice) u.voice = bestVoice;
    window.speechSynthesis.speak(u);
  }

  // ═══════════════════════════════════
  //  展示呼叫
  // ═══════════════════════════════════

  function showCall(call) {
    if (!call) return;

    if (callClass)   callClass.textContent   = call.className || '';
    const studentNames = Array.isArray(call.studentNames) ? call.studentNames.filter(Boolean) : [];
    if (callStudent) {
      callStudent.textContent = call.studentName || '';
      callStudent.classList.toggle('batch', studentNames.length > 1);
    }
    if (callMessage) callMessage.textContent = call.message || '办公室';

    // 倒计时条
    if (timerBar) {
      timerBar.style.animation = 'none';
      void timerBar.offsetWidth;
      timerBar.style.animation = `shrink ${DISPLAY_DURATION}ms linear forwards`;
    }

    // 朗读（教师端已拼好完整消息）
    speak(call.message || `${call.studentName || ''}同学，请到办公室`);

    // ack
    if (call.callId && api.callAck) {
      api.callAck(call.callId);
    }

    // 自动关闭
    clearTimeout(dismissTimer);
    dismissTimer = setTimeout(() => {
      if (api.closePopup) api.closePopup();
    }, DISPLAY_DURATION);
  }

  function close() {
    clearTimeout(dismissTimer);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (api.closePopup) api.closePopup();
  }

  // ═══════════════════════════════════
  //  事件绑定
  // ═══════════════════════════════════

  function bindEvents() {
    if (api.onShowCall) api.onShowCall(showCall);

    if (closeBtn) closeBtn.addEventListener('click', close);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });

    const container = document.querySelector('.popup-container');
    if (container) {
      container.addEventListener('click', (e) => {
        if (e.target === container) close();
      });
    }
  }

  // ═══════════════════════════════════
  //  启动
  // ═══════════════════════════════════

  function onReady() {
    callClass   = document.getElementById('callClass');
    callStudent = document.getElementById('callStudent');
    callMessage = document.getElementById('callMessage');
    closeBtn    = document.getElementById('closeBtn');
    timerBar    = document.getElementById('timerBar');
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
