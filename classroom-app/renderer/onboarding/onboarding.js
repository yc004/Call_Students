(function () {
  'use strict';

  const api = window.api || {};
  const addressList = document.getElementById('addressList');
  const candidateList = document.getElementById('candidateList');
  const refreshBtn = document.getElementById('refreshBtn');
  const bindBtn = document.getElementById('bindBtn');
  const errorText = document.getElementById('errorText');
  const successOverlay = document.getElementById('successOverlay');
  const successDesc = document.getElementById('successDesc');
  const enterBtn = document.getElementById('enterBtn');
  let selectedId = '';
  let refreshing = false;

  function esc(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function setError(message) {
    errorText.textContent = message || '';
    errorText.classList.toggle('hidden', !message);
  }

  function renderAddresses(status) {
    const addresses = status.addresses || [];
    addressList.innerHTML = addresses.length
      ? addresses.map(address => `<code>${esc(address)}</code>`).join('')
      : '<code>未检测到局域网地址</code>';
  }

  function renderCandidates(candidates) {
    if (!candidates.length) {
      selectedId = '';
      candidateList.innerHTML = '<div class="waiting"><div><strong>正在等待班主任连接…</strong><small>连接后会自动出现在这里，无需重启教室端。</small></div></div>';
      bindBtn.disabled = true;
      return;
    }
    if (!candidates.some(item => item.connection_id === selectedId)) selectedId = candidates.length === 1 ? candidates[0].connection_id : '';
    candidateList.innerHTML = candidates.map(item => {
      const selected = item.connection_id === selectedId;
      const subjects = (item.subjects || []).join('、') || '尚未设置授课科目';
      return `<label class="candidate${selected ? ' selected' : ''}">
        <input type="radio" name="candidate" value="${esc(item.connection_id)}"${selected ? ' checked' : ''}>
        <span><strong>${esc(item.name)}</strong><small>${esc(subjects)}</small></span>
        <span class="candidate-tag">${item.source === 'approved' ? '已加入' : '新请求'}</span>
      </label>`;
    }).join('');
    bindBtn.disabled = !selectedId;
  }

  async function refresh() {
    if (refreshing || !api.getOnboardingStatus) return;
    refreshing = true;
    refreshBtn.disabled = true;
    try {
      const status = await api.getOnboardingStatus();
      if (status.bound) {
        successDesc.textContent = `已绑定班主任 ${status.homeroom.name}。`;
        successOverlay.classList.remove('hidden');
        return;
      }
      renderAddresses(status);
      renderCandidates(status.candidates || []);
    } catch (_) {
      setError('暂时无法读取绑定状态，请稍后重试');
    } finally {
      refreshing = false;
      refreshBtn.disabled = false;
    }
  }

  candidateList.addEventListener('change', event => {
    const radio = event.target.closest('input[type="radio"]');
    if (!radio) return;
    selectedId = radio.value;
    candidateList.querySelectorAll('.candidate').forEach(item => item.classList.toggle('selected', item.contains(radio)));
    bindBtn.disabled = !selectedId;
    setError('');
  });

  refreshBtn.addEventListener('click', refresh);
  bindBtn.addEventListener('click', async () => {
    if (!selectedId) { setError('请先选择需要绑定的班主任账户'); return; }
    bindBtn.disabled = true;
    bindBtn.textContent = '正在绑定…';
    try {
      const result = await api.bindHomeroomTeacher(selectedId);
      if (!result || !result.success) {
        setError(result && result.message ? result.message : '绑定失败，请重试');
        return;
      }
      successDesc.textContent = `已绑定班主任 ${result.teacher.name}。`;
      successOverlay.classList.remove('hidden');
    } catch (_) {
      setError('绑定服务暂时不可用，请重试');
    } finally {
      bindBtn.textContent = '确认绑定班主任';
      bindBtn.disabled = !selectedId;
    }
  });

  enterBtn.addEventListener('click', () => api.finishOnboarding && api.finishOnboarding());
  if (api.onOnboardingChanged) api.onOnboardingChanged(refresh);
  if (!api.getOnboardingStatus) {
    addressList.innerHTML = '<code>192.168.x.x</code>';
    renderCandidates([]);
  }
  refresh();
  setInterval(refresh, 2500);
})();
