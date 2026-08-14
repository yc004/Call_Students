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
  const scanGuide = document.getElementById('scanGuide');
  const directBaseUrl = document.getElementById('directBaseUrl');
  const saveDirectBtn = document.getElementById('saveDirectBtn');
  const directStatus = document.getElementById('directStatus');
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
      scanGuide.textContent = result.qrMode === 'wechat-direct'
        ? '打开微信直接扫描，或在小程序内扫码，均可进入教室连接页。'
        : '在微信小程序底部点击“扫码”，选择“添加教室”后扫描。';
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
  async function loadDirectSettings() {
    if (!api.getWechatDirectLinkSettings) return;
    const settings = await api.getWechatDirectLinkSettings();
    directBaseUrl.value = settings && settings.baseUrl || '';
    directStatus.textContent = settings && settings.enabled
      ? '已启用微信直接扫码；链接仍只用于拉起小程序，连接过程在局域网内完成。'
      : '未配置时继续使用小程序内扫码。';
  }
  saveDirectBtn.addEventListener('click', async () => {
    saveDirectBtn.disabled = true;
    directStatus.textContent = '正在保存…';
    try {
      const result = await api.setWechatDirectLinkSettings(directBaseUrl.value);
      if (!result || !result.success) throw new Error(result && result.message || '保存失败');
      directBaseUrl.value = result.baseUrl || '';
      directStatus.textContent = result.enabled ? '已启用微信直接扫码。' : '已关闭，继续使用小程序内扫码。';
      await load();
    } catch (error) { directStatus.textContent = error.message || '保存失败'; }
    finally { saveDirectBtn.disabled = false; }
  });
  retry.addEventListener('click', load);
  if (api.onNetworkInterfaceChanged) api.onNetworkInterfaceChanged(load);
  loadDirectSettings();
  load();
})();
