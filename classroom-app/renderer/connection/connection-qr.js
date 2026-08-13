(function () {
  'use strict';
  const api = window.api || {};
  const image = document.getElementById('qrImage');
  const placeholder = document.getElementById('placeholder');
  const roomName = document.getElementById('roomName');
  const code = document.getElementById('connectionCode');
  const retry = document.getElementById('retryBtn');
  const networkInterface = document.getElementById('networkInterface');
  const networkDetail = document.getElementById('networkDetail');
  function esc(value) { return String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
  function renderNetworks(network) {
    const previous = networkInterface.value;
    networkInterface.innerHTML = '<option value="">自动选择（推荐）</option>' + (network.interfaces || []).map(item => `<option value="${esc(item.name)}">${esc(item.name)} · ${esc(item.address)}${item.isVirtual?' · 虚拟网卡':''}</option>`).join('');
    networkInterface.value = network.mode === 'manual' ? network.preferredName : '';
    if (network.unavailable) networkDetail.textContent = `已选网卡 ${network.preferredName} 当前不可用，请重新选择`;
    else if (network.selected) networkDetail.textContent = `当前使用 ${network.selected.name} · ${network.selected.address}${network.selected.isVirtual?' · 注意：这可能是虚拟网卡':''}`;
    else networkDetail.textContent = '未检测到可用的 IPv4 网卡';
    if (previous && !networkInterface.value && network.mode === 'manual') networkInterface.value = previous;
  }
  async function load() {
    retry.disabled = true;
    placeholder.textContent = '正在生成二维码…';
    image.classList.remove('visible');
    try {
      const result = await api.getClassroomQr();
      if (result && result.network) renderNetworks(result.network);
      if (!result || !result.success) throw new Error(result && result.message || '暂无局域网连接');
      roomName.textContent = result.name;
      code.textContent = result.connectionCode;
      image.src = result.qrDataUrl;
      image.classList.add('visible');
      placeholder.textContent = '';
    } catch (error) {
      placeholder.textContent = error.message || '二维码生成失败，请检查网络';
      code.textContent = '暂无可用连接码';
    } finally { retry.disabled = false; }
  }
  networkInterface.addEventListener('change', async () => {
    networkInterface.disabled = true;
    try {
      const result = await api.setNetworkInterface(networkInterface.value);
      if (!result || !result.success) throw new Error(result && result.message || '网卡设置失败');
      renderNetworks(result);
      await load();
    } catch (error) { networkDetail.textContent = error.message || '网卡设置失败'; }
    finally { networkInterface.disabled = false; }
  });
  retry.addEventListener('click', load);
  if (api.onNetworkInterfaceChanged) api.onNetworkInterfaceChanged(load);
  load();
})();
