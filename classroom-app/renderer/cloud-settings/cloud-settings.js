const serverUrl = document.getElementById('serverUrl');
const connectionKey = document.getElementById('connectionKey');
const message = document.getElementById('message');
const saveBtn = document.getElementById('saveBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const connectedState = document.getElementById('connectedState');
const connectedServer = document.getElementById('connectedServer');

async function load() {
  const config = await window.api.getCloudConfig();
  const connected = !!(config && config.enabled);
  if (connected) serverUrl.value = config.serverUrl || '';
  connectedState.classList.toggle('hidden', !connected);
  disconnectBtn.classList.toggle('hidden', !connected);
  connectedServer.textContent = connected ? config.serverUrl : '';
}
saveBtn.addEventListener('click', async () => {
  message.textContent = '';
  saveBtn.disabled = true; saveBtn.textContent = '正在连接…';
  const result = await window.api.enrollCloud({ serverUrl:serverUrl.value, key:connectionKey.value });
  saveBtn.disabled = false; saveBtn.textContent = '连接云服务';
  if (!result.ok) { message.textContent = result.message || '连接失败'; return; }
  connectionKey.value = ''; message.textContent = ''; await load();
});
disconnectBtn.addEventListener('click', async () => {
  if (!confirm('确定断开云服务？本机班级资料和人脸数据不会删除。')) return;
  await window.api.disconnectCloud(); await load();
});
load();
