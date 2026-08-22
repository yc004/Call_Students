const serverUrl = document.getElementById('serverUrl');
const connectionKey = document.getElementById('connectionKey');
const message = document.getElementById('message');
const saveBtn = document.getElementById('saveBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const connectedState = document.getElementById('connectedState');
const connectedServer = document.getElementById('connectedServer');
function reportError(title, error, context) {
  if (window.clientErrors) window.clientErrors.show({ title, error, context, suggestions:['检查服务器地址、连接凭据和网络状态', '确认云服务已经启动；如果仍失败，请复制错误信息提交管理员'] });
}

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
  try {
    const result = await window.api.enrollCloud({ serverUrl:serverUrl.value, key:connectionKey.value });
    if (!result.ok) throw Object.assign(new Error(result.message || '连接失败'), { code:result.code });
    connectionKey.value = ''; message.textContent = ''; await load();
  } catch (error) {
    message.textContent = error.message || '连接失败';
    reportError('教室端无法连接云服务', error, '云服务接入');
  } finally { saveBtn.disabled = false; saveBtn.textContent = '连接云服务'; }
});
disconnectBtn.addEventListener('click', async () => {
  if (!confirm('确定断开云服务？本机班级资料和人脸数据不会删除。')) return;
  try { await window.api.disconnectCloud(); await load(); }
  catch (error) { reportError('无法断开云服务', error, '云服务设置'); }
});
load().catch(error => reportError('无法读取云服务设置', error, '云服务设置'));
