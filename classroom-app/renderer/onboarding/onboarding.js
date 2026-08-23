(function () {
  'use strict';

  const api = window.api || {};
  const addressList = document.getElementById('addressList');
  const classroomQrImage = document.getElementById('classroomQrImage');
  const qrPlaceholder = document.getElementById('qrPlaceholder');
  const candidateList = document.getElementById('candidateList');
  const refreshBtn = document.getElementById('refreshBtn');
  const bindBtn = document.getElementById('bindBtn');
  const errorText = document.getElementById('errorText');
  const successOverlay = document.getElementById('successOverlay');
  const successDesc = document.getElementById('successDesc');
  const enterBtn = document.getElementById('enterBtn');
  const networkInterface = document.getElementById('networkInterface');
  const networkDetail = document.getElementById('networkDetail');
  let selectedId = '';
  let refreshing = false;

  function reportError(title, error, context, suggestions) {
    if (window.clientErrors) window.clientErrors.show({ title, error, context, suggestions:suggestions || ['稍后重试刚才的操作', '如果仍然失败，请复制错误信息提交管理员'] });
  }

  function esc(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function setError(message) {
    errorText.textContent = message || '';
    errorText.classList.toggle('hidden', !message);
  }

  function renderAddresses(status) {
    const codes = status.connectionCodes || [];
    addressList.innerHTML = codes.length
      ? codes.map(code => `<code>${esc(code)}</code>`).join('')
      : '<code>未检测到可用的教室连接码</code>';
  }

  function renderNetworks(network) {
    if (!network) return;
    networkInterface.innerHTML = '<option value="">自动选择（推荐）</option>' + (network.interfaces || []).map(item => `<option value="${esc(item.name)}">${esc(item.name)} · ${esc(item.address)}${item.isVirtual?' · 虚拟网卡':''}</option>`).join('');
    networkInterface.value = network.mode === 'manual' ? network.preferredName : '';
    if (network.unavailable) networkDetail.textContent = `已选网卡 ${network.preferredName} 当前不可用，请重新选择`;
    else if (network.selected) networkDetail.textContent = `当前使用 ${network.selected.name} · ${network.selected.address}`;
    else networkDetail.textContent = '未检测到可用的 IPv4 网卡';
  }

  async function renderClassroomQr() {
    if (!api.getClassroomQr) return;
    try {
      const result = await api.getClassroomQr();
      if (!result || !result.success) throw new Error(result && result.message);
      classroomQrImage.src = result.qrDataUrl;
      classroomQrImage.classList.add('visible');
      qrPlaceholder.classList.add('hidden');
    } catch (_) {
      classroomQrImage.classList.remove('visible');
      qrPlaceholder.textContent = '连接网络后将显示二维码';
      qrPlaceholder.classList.remove('hidden');
    }
  }

  function renderCandidates(candidates) {
    if (!candidates.length) {
      selectedId = '';
      candidateList.innerHTML = '<div class="waiting"><div><strong>正在等待班主任连接…</strong><small>连接后会自动出现在这里，无需重启教室端。</small></div></div>';
      bindBtn.disabled = true;
      return;
    }
    const selectable = candidates.filter(item => (item.subjects || []).length > 0);
    if (!selectable.some(item => item.connection_id === selectedId)) selectedId = selectable.length === 1 ? selectable[0].connection_id : '';
    candidateList.innerHTML = candidates.map(item => {
      const selected = item.connection_id === selectedId;
      const subjects = (item.subjects || []).join('、') || '尚未设置授课科目';
      const canBind = (item.subjects || []).length > 0;
      return `<label class="candidate${selected ? ' selected' : ''}">
        <input type="radio" name="candidate" value="${esc(item.connection_id)}"${selected ? ' checked' : ''}${canBind ? '' : ' disabled'}>
        <span><strong>${esc(item.name)}</strong><small>${esc(subjects)}</small></span>
        <span class="candidate-tag">${canBind ? (item.source === 'approved' ? '已加入' : '新请求') : '需先设科目'}</span>
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
      if (status && status.bound) {
        successDesc.textContent = `已绑定班主任 ${status.homeroom.name}。`;
        successOverlay.classList.remove('hidden');
        return;
      }
      const candidates = (status && status.candidates) || [];
      successOverlay.classList.add('hidden');
      renderAddresses(status);
      renderNetworks(status.network);
      renderClassroomQr();
      renderCandidates(candidates);
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
  networkInterface.addEventListener('change', async () => {
    networkInterface.disabled = true;
    try {
      const result = await api.setNetworkInterface(networkInterface.value);
      if (!result || !result.success) throw new Error(result && result.message || '网卡设置失败');
      renderNetworks(result);
      await refresh();
    } catch (error) {
      setError(error.message || '网卡设置失败');
      reportError('网卡设置失败', error, '首次设置－选择网卡', ['确认所选网卡当前可用并已连接局域网', '尝试恢复自动选择后重试']);
    }
    finally { networkInterface.disabled = false; }
  });
  bindBtn.addEventListener('click', async () => {
    if (!selectedId) { setError('请先选择需要绑定的班主任账户'); return; }
    bindBtn.disabled = true;
    bindBtn.textContent = '正在绑定…';
    try {
      const result = await api.bindHomeroomTeacher(selectedId);
      if (!result || !result.success) {
        throw new Error(result && result.message ? result.message : '绑定失败，请重试');
      }
      successDesc.textContent = `已绑定班主任 ${result.teacher.name}。`;
      successOverlay.classList.remove('hidden');
    } catch (error) {
      setError('绑定服务暂时不可用，请重试');
      reportError('绑定班主任失败', error, '首次设置－教师身份确认');
    } finally {
      bindBtn.textContent = '确认绑定班主任';
      bindBtn.disabled = !selectedId;
    }
  });

  enterBtn.addEventListener('click', () => api.finishOnboarding && api.finishOnboarding());
  if (api.onOnboardingChanged) api.onOnboardingChanged(refresh);
  if (api.onNetworkInterfaceChanged) api.onNetworkInterfaceChanged(refresh);
  if (!api.getOnboardingStatus) {
    addressList.innerHTML = '<code>192.168.x.x</code>';
    renderCandidates([]);
  }
  refresh();
  setInterval(refresh, 2500);
})();
