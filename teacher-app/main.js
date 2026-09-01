const { app, BrowserWindow, ipcMain, Menu, dialog, safeStorage, clipboard, session } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const QRCode = require('qrcode');
const {
  publicAccount,
  verifyAccountPassword,
  makeStoredAccount,
} = require('./account-auth');
const { startPairingServer } = require('./mini-program-pairing');
const { normalizeWechatDirectBaseUrl, createTeacherPairingDirectLink } = require('./wechat-direct-link');
const { buildHomeworkWorkbookBuffer, normalizePayload, safeFilePart } = require('./homework-export');
const { analyzeHomework, normalizeEndpoint } = require('./homework-ai');
const connectionCode = require('./connection-code');
const { normalizeServerUrl, requestJson, refreshCloudSession } = require('./cloud-client');

ipcMain.handle('copy-text', (_event, value) => {
  clipboard.writeText(String(value == null ? '' : value));
  return { ok: true };
});

// 教师端只能有一个运行实例，避免多个窗口同时持有账号和教室连接状态。
// 第二次启动由已运行实例唤醒主窗口后退出。
const HAS_SINGLE_INSTANCE_LOCK = app.requestSingleInstanceLock();
if (!HAS_SINGLE_INSTANCE_LOCK) {
  console.warn('[single-instance] another teacher app instance is already running');
  app.quit();
}

// 禁用磁盘缓存
app.commandLine.appendSwitch('disable-http-cache');
app.on('web-contents-created',(_event,contents)=>{
  contents.setWindowOpenHandler(()=>({action:'deny'}));
  contents.on('will-navigate',(event,target)=>{try{const url=new URL(target);if(url.protocol==='file:'&&path.resolve(url.pathname).startsWith(path.resolve(__dirname)))return;}catch(_error){}event.preventDefault();});
});
app.whenReady().then(()=>session.defaultSession.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false)));

// ── 常量 ──
// 教师端存储本机教师账户、教室连接码列表和呼叫记录（JSON 文件，体积小无需 SQLite）
// 作业、学科、提交状态等数据始终从教室端通过 WebSocket 获取，不本地存储
const DATA_FILE = app.isPackaged
  ? path.join(app.getPath('userData'), 'data.json')
  : path.join(__dirname, 'data', 'data.json');

// ═══════════════════════════════════════
//  数据读写（account + rooms + callHistory）
// ═══════════════════════════════════════

function loadAllData() {
  for(const candidate of [DATA_FILE,`${DATA_FILE}.bak`])try {
    if (fs.existsSync(candidate)) {
      const raw = fs.readFileSync(candidate, 'utf-8');
      const parsed = JSON.parse(raw);
      const settings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {};
      if (settings.cloud && settings.cloud.tokensEncrypted && safeStorage.isEncryptionAvailable()) {
        try { Object.assign(settings.cloud, JSON.parse(safeStorage.decryptString(Buffer.from(settings.cloud.tokensEncrypted, 'base64')))); delete settings.cloud.tokensEncrypted; } catch (_error) { settings.cloud = null; }
      }
      if (settings.ai && settings.ai.apiKeyEncrypted) {
        if (safeStorage.isEncryptionAvailable()) {
          try {
            settings.ai.apiKey = safeStorage.decryptString(Buffer.from(settings.ai.apiKeyEncrypted, 'base64'));
            delete settings.ai.apiKeyEncrypted;
          } catch (_error) { settings.ai = { ...settings.ai, apiKey:'' }; delete settings.ai.apiKeyEncrypted; }
        } else {
          settings.ai = { ...settings.ai, apiKey:'' };
          delete settings.ai.apiKeyEncrypted;
        }
      }
      return {
        account: parsed.account || null,
        rooms: parsed.rooms || [],
        callHistory: parsed.callHistory || [],
        settings,
      };
    }
  } catch (e) { console.error(`loadAllData error (${candidate}):`, e.message); }
  return { account: null, rooms: [], callHistory: [], settings: {} };
}

function atomicWriteData(value) {
  const dir=path.dirname(DATA_FILE);
  if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const temporary=`${DATA_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor=fs.openSync(temporary,'wx',0o600);
  try{fs.writeFileSync(descriptor,JSON.stringify(value,null,2),'utf-8');fs.fsyncSync(descriptor);}
  finally{fs.closeSync(descriptor);}
  try{
    if(fs.existsSync(DATA_FILE)){
      try{JSON.parse(fs.readFileSync(DATA_FILE,'utf-8'));fs.copyFileSync(DATA_FILE,`${DATA_FILE}.bak`);}
      catch(_invalidPrimary){fs.copyFileSync(DATA_FILE,`${DATA_FILE}.corrupt`);}
    }
    fs.renameSync(temporary,DATA_FILE);
    const directoryDescriptor=fs.openSync(dir,'r');
    try{fs.fsyncSync(directoryDescriptor);}finally{fs.closeSync(directoryDescriptor);}
  }catch(error){try{fs.unlinkSync(temporary);}catch(_cleanupError){}throw error;}
}

function loadData() {
  const d = loadAllData();
  const rooms = d.rooms.map(room => {
    const subjects = Array.from(new Set((room.subjects || []).map(value => String(value).trim().slice(0, 30)).filter(Boolean))).slice(0, 20);
    if (room.transport === 'cloud' && room.cloudClassroomId) {
      const code = room.connectionCode && connectionCode.isValid(room.connectionCode) ? connectionCode.format(room.connectionCode) : '';
      return { ...room, id:String(room.id || room.cloudClassroomId), cloudClassroomId:String(room.cloudClassroomId), transport:'cloud', name:room.name || '云端教室', connectionCode:code, subjects };
    }
    if (room.connectionCode && connectionCode.isValid(room.connectionCode)) {
      return { id: room.id, name: room.name || '教室', connectionCode: connectionCode.format(room.connectionCode), subjects };
    }
    try { return { id: room.id, name: room.name || '教室', connectionCode: connectionCode.encode(room.ip), subjects }; }
    catch (_error) { return null; }
  }).filter(Boolean);
  return { account: publicAccount(d.account), rooms, callHistory: d.callHistory, cloud:d.settings.cloud || null };
}

function migrateStoredRooms() {
  const stored = loadAllData();
  const normalized = loadData().rooms;
  if (JSON.stringify(stored.rooms) !== JSON.stringify(normalized)) {
    const merged = { ...stored, rooms: normalized };
    atomicWriteData(merged);
  }
  return normalized;
}

function saveData(data) {
  const existing = loadAllData();
  const merged = {
    account: data.account !== undefined ? data.account : existing.account,
    rooms: data.rooms !== undefined ? data.rooms : existing.rooms,
    callHistory: data.callHistory !== undefined ? data.callHistory : existing.callHistory,
    settings: data.settings !== undefined ? data.settings : existing.settings,
  };
  if (merged.settings.cloud && merged.settings.cloud.accessToken) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储不可用，无法保存云服务登录凭证');
    }
    const cloud = { ...merged.settings.cloud };
    const secrets = { accessToken:cloud.accessToken, refreshToken:cloud.refreshToken };
    delete cloud.accessToken; delete cloud.refreshToken;
    cloud.tokensEncrypted = safeStorage.encryptString(JSON.stringify(secrets)).toString('base64');
    merged.settings = { ...merged.settings, cloud };
  }
  if (merged.settings.ai && merged.settings.ai.apiKey) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存 AI API 密钥');
    const ai = { ...merged.settings.ai };
    ai.apiKeyEncrypted = safeStorage.encryptString(String(ai.apiKey)).toString('base64');
    delete ai.apiKey;
    merged.settings = { ...merged.settings, ai };
  }
  atomicWriteData(merged);
}

async function ensureCloudSession(cloud) {
  if (!cloud) throw new Error('尚未配置云服务');
  const expiresAt = new Date(cloud.accessExpiresAt || 0).getTime();
  if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 60000) return cloud;
  const session = await refreshCloudSession(cloud.serverUrl,cloud.refreshToken);
  const updated = { ...cloud, ...session };
  const stored = loadAllData();
  saveData({ settings:{ ...stored.settings, cloud:updated } });
  return updated;
}

function avatarContentType(filePath) {
  const extension = path.extname(String(filePath || '')).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  throw new Error('头像仅支持 PNG、JPEG 或 WebP 图片');
}

function saveLocalTeacherAvatar(filePath) {
  if (!filePath) return '';
  const contentType = avatarContentType(filePath);
  const data = fs.readFileSync(filePath);
  if (!data.length || data.length > 5 * 1024 * 1024) throw new Error('头像文件大小不能超过 5MB');
  const directory = path.join(app.getPath('userData'), 'profile');
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive:true });
  const extension = contentType === 'image/png' ? '.png' : contentType === 'image/webp' ? '.webp' : '.jpg';
  const target = path.join(directory, `avatar-${Date.now()}${extension}`);
  fs.copyFileSync(filePath, target);
  return pathToFileURL(target).toString();
}

function savePairedTeacherAvatar(avatar) {
  if (!avatar) return '';
  const contentType = String(avatar.contentType || '');
  const extension = contentType === 'image/png' ? '.png' : contentType === 'image/webp' ? '.webp' : contentType === 'image/jpeg' ? '.jpg' : '';
  if (!extension) throw new Error('小程序头像格式不受支持');
  const data = Buffer.from(String(avatar.base64 || ''), 'base64');
  if (!data.length || data.length > 2 * 1024 * 1024) throw new Error('小程序头像大小不能超过 2MB');
  const directory = path.join(app.getPath('userData'), 'profile');
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive:true });
  const target = path.join(directory, `avatar-paired-${Date.now()}${extension}`);
  fs.writeFileSync(target, data);
  return pathToFileURL(target).toString();
}

async function uploadTeacherAvatar(cloud, filePath) {
  const contentType = avatarContentType(filePath);
  const data = fs.readFileSync(filePath);
  if (!data.length || data.length > 5 * 1024 * 1024) throw new Error('头像文件大小不能超过 5MB');
  const response = await fetch(new URL('/api/v2/profile/avatar', `${normalizeServerUrl(cloud.serverUrl)}/`), {
    method:'POST',
    headers:{ 'content-type':contentType, 'x-banda-client':'teacher-desktop', 'x-banda-protocol':'2', authorization:`Bearer ${cloud.accessToken}` },
    body:data,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error&&payload.error.message || `头像上传失败（${response.status}）`);
  return String(payload.data&&payload.data.url || '');
}

ipcMain.handle('get-data', () => {
  const rooms = migrateStoredRooms();
  const data = loadData();
  return { ...data, rooms };
});
ipcMain.handle('save-data', (_, data) => { saveData(data); return true; });
ipcMain.handle('get-cloud-settings', () => loadAllData().settings.cloud || null);
ipcMain.handle('set-cloud-settings', async (_, value) => {
  try {
    const serverUrl = normalizeServerUrl(value && value.serverUrl, value && typeof value.useHttps === 'boolean' ? value.useHttps : undefined);
    const accessToken = String(value && value.accessToken || '');
    const refreshToken = String(value && value.refreshToken || '');
    if (!accessToken || !refreshToken) throw new Error('云服务登录凭证不完整，请重新使用小程序扫码登录');
    await requestJson(serverUrl, '/api/v2/system/live');
    const stored = loadAllData();
    const cloud = { ...value, serverUrl, accessToken, refreshToken };
    saveData({ settings:{ ...stored.settings, cloud } });
    return { ok:true, cloud };
  } catch (error) { return { ok:false, message:error.message || '云服务配置失败' }; }
});
ipcMain.handle('create-local-session', async (_, input) => {
  try {
    const name = String(input && input.name || '').trim().slice(0, 40);
    if (!name) throw new Error('请输入你的称呼');
    const stored = loadAllData();
    const existing = stored.account && stored.account.connectionId ? stored.account : null;
    const account = { name, avatarUrl:existing && existing.avatarUrl || '', subjects:[], connectionId:existing ? existing.connectionId : crypto.randomUUID(), mode:'toc' };
    const localRooms = existing ? stored.rooms.filter(room => room.transport !== 'cloud') : [];
    saveData({ account, rooms:localRooms, callHistory:existing ? stored.callHistory : [], settings:{ ...stored.settings, cloud:null } });
    return { ok:true, account:publicAccount(account), rooms:loadData().rooms.filter(room => room.transport !== 'cloud'), cloud:null };
  } catch (error) { return { ok:false, message:error.message || '创建个人会话失败' }; }
});
ipcMain.handle('login-teacher-cloud', async (_, input) => {
  try {
    const serverUrl = normalizeServerUrl(input && input.serverUrl, input && typeof input.useHttps === 'boolean' ? input.useHttps : undefined);
    const organizationSlug = String(input && input.organizationSlug || '').trim();
    const loginName = String(input && input.loginName || '').trim();
    const password = String(input && input.password || '');
    if (!organizationSlug || !loginName || !password) throw new Error('请输入组织标识、用户名和密码');
    const result = await requestJson(serverUrl, '/api/v2/auth/login', { method:'POST', body:{ organizationSlug, loginName, password, deviceName:os.hostname() || '教师端' } });
    const cloud = { version:2, serverUrl, organizationSlug, loginName, userId:result.user && result.user.id, userName:result.user && result.user.name, nickname:result.user && result.user.nickname, avatarUrl:result.user && result.user.avatarUrl, mustChangePassword:!!(result.user && result.user.mustChangePassword), organization:result.organization || null, accessToken:result.accessToken, accessExpiresAt:result.accessExpiresAt, refreshToken:result.refreshToken, expiresAt:result.expiresAt };
    const account = { name:String(result.user && (result.user.nickname || result.user.name) || loginName).trim().slice(0,40), avatarUrl:cloud.avatarUrl || '', subjects:[], connectionId:`cloud-${cloud.userId}` };
    saveData({ account, settings:{ ...loadAllData().settings, cloud } });
    const classrooms = await requestJson(serverUrl, '/api/v2/client/classrooms', { token:cloud.accessToken }).catch(error => {
      if (cloud.mustChangePassword) return [];
      throw error;
    });
    const rooms = (classrooms || []).map(room => ({ id:room.id, cloudClassroomId:room.id, transport:'cloud', name:room.name || '云端教室', connectionCode:room.lan_connection_code && connectionCode.isValid(room.lan_connection_code) ? connectionCode.format(room.lan_connection_code) : '', lanAddresses:Array.isArray(room.lan_addresses_json)?room.lan_addresses_json:[], subjects:Array.isArray(room.subjects_json) ? room.subjects_json : [], role:room.role, cloudStatus:room.device_status || 'offline', publicRelayAvailable:room.public_relay_available===true }));
    saveData({ rooms });
    return { ok:true, account:publicAccount(account), rooms, cloud };
  } catch (error) { return { ok:false, code:error.code, message:error.message || '组织登录失败' }; }
});
ipcMain.handle('complete-teacher-profile', async (_, input) => {
  try {
    const stored = loadAllData();
    const cloud = await ensureCloudSession(stored.settings.cloud);
    const name = String(input && input.name || '').trim();
    const nickname = String(input && input.nickname || '').trim();
    const newPassword = String(input && input.newPassword || '');
    if (!name || !nickname || newPassword.length < 10) throw new Error('请输入用户名，并设置至少 10 位新密码');
    const result = await requestJson(cloud.serverUrl, '/api/v2/profile', { method:'PATCH', token:cloud.accessToken, body:{ name, nickname, newPassword } });
    const updatedCloud = { ...cloud, userName:name, nickname, mustChangePassword:false, organization:result.organization || cloud.organization };
    const account = { ...stored.account, name:nickname || name, avatarUrl:updatedCloud.avatarUrl || stored.account.avatarUrl || '' };
    saveData({ account, settings:{ ...stored.settings, cloud:updatedCloud } });
    return { ok:true, account:publicAccount(account), cloud:updatedCloud };
  } catch (error) { return { ok:false, message:error.message || '资料更新失败' }; }
});
ipcMain.handle('choose-teacher-avatar', async () => {
  const result = await dialog.showOpenDialog({ title:'选择头像', properties:['openFile'], filters:[{ name:'图片', extensions:['png','jpg','jpeg','webp'] }] });
  if (result.canceled || !result.filePaths[0]) return { ok:false, canceled:true };
  const filePath = result.filePaths[0];
  try { avatarContentType(filePath); return { ok:true, filePath, previewUrl:pathToFileURL(filePath).toString() }; }
  catch (error) { return { ok:false, message:error.message }; }
});
ipcMain.handle('update-teacher-profile', async (_, input) => {
  try {
    const stored = loadAllData();
    if (!stored.account) throw new Error('教师账户不存在');
    const name = String(input && input.name || '').trim().slice(0, 40);
    const avatarPath = String(input && input.avatarPath || '');
    const currentPassword = String(input && input.currentPassword || '');
    const newPassword = String(input && input.newPassword || '');
    if (!name) throw new Error('请输入用户名');
    let cloud = stored.settings.cloud || null;
    let avatarUrl = String(stored.account.avatarUrl || cloud && cloud.avatarUrl || '');
    if (cloud) {
      cloud = await ensureCloudSession(cloud);
      if (avatarPath) avatarUrl = await uploadTeacherAvatar(cloud, avatarPath);
      const body = { name, nickname:name };
      if (newPassword) Object.assign(body, { currentPassword, newPassword });
      const result = await requestJson(cloud.serverUrl, '/api/v2/profile', { method:'PATCH', token:cloud.accessToken, body });
      cloud = { ...cloud, userName:result.user.name, nickname:result.user.nickname, avatarUrl:avatarUrl || result.user.avatarUrl || '', mustChangePassword:!!result.user.mustChangePassword, organization:result.organization || cloud.organization };
    } else if (avatarPath) {
      avatarUrl = saveLocalTeacherAvatar(avatarPath);
    }
    const account = { ...stored.account, name, avatarUrl };
    saveData({ account, settings:{ ...stored.settings, cloud } });
    return { ok:true, account:publicAccount(account), cloud };
  } catch (error) { return { ok:false, code:error.code, message:error.message || '个人资料保存失败' }; }
});
ipcMain.handle('refresh-cloud-classrooms', async () => {
  try {
    const stored = loadAllData();
    const cloud = await ensureCloudSession(stored.settings.cloud);
    const profile = await requestJson(cloud.serverUrl, '/api/v2/profile', { token:cloud.accessToken });
    const updatedCloud = { ...cloud, userName:profile.user.name, nickname:profile.user.nickname, avatarUrl:profile.user.avatarUrl || '', mustChangePassword:!!profile.user.mustChangePassword, organization:profile.organization || cloud.organization };
    const account = { ...stored.account, name:profile.user.nickname || profile.user.name, avatarUrl:profile.user.avatarUrl || '' };
    const result = await requestJson(cloud.serverUrl, '/api/v2/client/classrooms', { token:updatedCloud.accessToken });
    const cloudRooms = (result || []).map(room => ({
      id:room.id, cloudClassroomId:room.id, transport:'cloud', name:room.name || '云端教室',
      connectionCode:room.lan_connection_code && connectionCode.isValid(room.lan_connection_code) ? connectionCode.format(room.lan_connection_code) : '',
      lanAddresses:Array.isArray(room.lan_addresses_json)?room.lan_addresses_json:[], subjects:Array.isArray(room.subjects_json) ? room.subjects_json : [], role:room.role, cloudStatus:room.device_status || 'offline', publicRelayAvailable:room.public_relay_available===true,
    }));
    const localRooms = stored.rooms.filter(room => room.transport !== 'cloud');
    saveData({ account, rooms:[...localRooms, ...cloudRooms], settings:{ ...stored.settings, cloud:updatedCloud } });
    return { ok:true, account:publicAccount(account), rooms:cloudRooms, cloud:updatedCloud };
  } catch (error) { return { ok:false, message:error.message || '无法同步云端教室' }; }
});
ipcMain.handle('clear-teacher-session', async () => {
  const stored = loadAllData();
  saveData({ account:null, rooms:[], callHistory:[], settings:{ ...stored.settings, cloud:null } });
  if (stored.settings.cloud && stored.settings.cloud.refreshToken) {
    try { await requestJson(stored.settings.cloud.serverUrl, '/api/v2/auth/logout', { method:'POST', body:{ refreshToken:stored.settings.cloud.refreshToken } }); } catch (_error) {}
  }
  return true;
});
ipcMain.handle('get-wechat-direct-link-settings', () => {
  const baseUrl = String(loadAllData().settings.wechatDirectBaseUrl || '');
  return { enabled:!!baseUrl, baseUrl };
});
ipcMain.handle('set-wechat-direct-link-settings', (_, value) => {
  try {
    const baseUrl = normalizeWechatDirectBaseUrl(value);
    const stored = loadAllData();
    saveData({ settings:{ ...stored.settings, wechatDirectBaseUrl:baseUrl } });
    return { ok:true, enabled:!!baseUrl, baseUrl };
  } catch (error) { return { ok:false, message:error.message }; }
});
ipcMain.handle('generate-mini-program-qr', async () => {
  const stored = loadAllData();
  try {
    if (stored.account) return { ok:false, code:'ALREADY_SIGNED_IN', message:'教师端已经登录。请先退出当前账户，再从登录页使用小程序扫码登录。' };
    miniProgramLoginResult = null;
    if (activeMiniProgramPairing) await activeMiniProgramPairing.stop();
    activeMiniProgramPairing = await startPairingServer({
      canAccept: () => !loadAllData().account,
      onComplete: result => {
        const previous = loadAllData();
        if (previous.account) throw new Error('教师端已经登录，请先退出当前账户后再扫码');
        const avatarUrl = savePairedTeacherAvatar(result.avatar)
          || result.account.avatarUrl
          || result.cloud && result.cloud.avatarUrl
          || '';
        const account = { ...result.account, avatarUrl };
        saveData({
          account,
          rooms: result.rooms,
          callHistory: [],
          settings:{ ...previous.settings, cloud:result.cloud || null },
        });
        miniProgramLoginResult = {
          ok: true,
          account: publicAccount(account),
          rooms: result.rooms,
          cloud:result.cloud || null,
          accountChanged:true,
          callHistory:[],
        };
      },
    });
    const directBaseUrl = String(loadAllData().settings.wechatDirectBaseUrl || '');
    const qrPayload = directBaseUrl
      ? createTeacherPairingDirectLink(directBaseUrl, activeMiniProgramPairing.payload)
      : activeMiniProgramPairing.payload;
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      width: 360,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#172033', light: '#FFFFFF' },
    });
    return {
      ok: true,
      qrDataUrl,
      roomCount: activeMiniProgramPairing.roomCount,
      expiresAt: activeMiniProgramPairing.expiresAt,
      qrMode: directBaseUrl ? 'wechat-direct' : 'mini-program-scan',
    };
  } catch (error) {
    if (activeMiniProgramPairing) activeMiniProgramPairing.stop();
    activeMiniProgramPairing = null;
    return { ok: false, message: error.message || '二维码生成失败' };
  }
});
ipcMain.handle('get-mini-program-login-status', () => {
  const result = miniProgramLoginResult;
  if (result) miniProgramLoginResult = null;
  return result || { ok: false, pending: true };
});
ipcMain.handle('cancel-mini-program-login', async () => {
  const pairing = activeMiniProgramPairing;
  activeMiniProgramPairing = null;
  miniProgramLoginResult = null;
  if (pairing) await pairing.stop();
  return { ok:true };
});
ipcMain.handle('export-homework', async (event, input) => {
  try {
    const data = normalizePayload(input);
    if (!data.assignments.length) return { ok: false, message: '当前筛选范围内没有可导出的作业' };
    const owner = BrowserWindow.fromWebContents(event.sender) || mainWin;
    const datePart = data.exportedAt.toISOString().slice(0, 10);
    const defaultName = `${safeFilePart(data.className)}-作业统计-${datePart}.xlsx`;
    const result = await dialog.showSaveDialog(owner, {
      title: '导出作业统计',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    const buffer = await buildHomeworkWorkbookBuffer(data);
    fs.writeFileSync(result.filePath, Buffer.from(buffer));
    return { ok: true, canceled: false, filePath: result.filePath };
  } catch (error) {
    console.error('export-homework error:', error);
    return { ok: false, message: error.message || '导出表格失败' };
  }
});
ipcMain.handle('get-homework-ai-settings', () => {
  const ai = loadAllData().settings.ai || {};
  return {
    endpoint:String(ai.endpoint || ''),
    model:String(ai.model || ''),
    hasApiKey:!!ai.apiKey,
  };
});
ipcMain.handle('set-homework-ai-settings', (_, input) => {
  try {
    const stored = loadAllData();
    const current = stored.settings.ai || {};
    const endpoint = normalizeEndpoint(input && input.endpoint);
    const model = String(input && input.model || '').trim().slice(0, 120);
    if (!model) throw new Error('请填写 AI 模型名称');
    const requestedKey = String(input && input.apiKey || '').trim();
    const apiKey = input && input.clearApiKey ? '' : (requestedKey || current.apiKey || '');
    const ai = { endpoint, model, apiKey };
    saveData({ settings:{ ...stored.settings, ai } });
    return { ok:true, settings:{ endpoint, model, hasApiKey:!!apiKey } };
  } catch (error) {
    return { ok:false, message:error.message || '保存 AI 设置失败' };
  }
});
ipcMain.handle('analyze-homework', async (event, input) => {
  try {
    const ai = loadAllData().settings.ai || {};
    const runId = String(input && input.runId || '').slice(0, 100);
    const result = await analyzeHomework(ai, input, fetch, activity => {
      if (!event.sender.isDestroyed()) event.sender.send('homework-ai-activity', { runId, ...activity });
    });
    return { ok:true, ...result };
  } catch (error) {
    console.error('analyze-homework error:', error.message);
    return { ok:false, message:error.message || 'AI 学情分析失败' };
  }
});
// ═══════════════════════════════════════
//  窗口
// ═══════════════════════════════════════

let mainWin = null;
let activeMiniProgramPairing = null;
let miniProgramLoginResult = null;
const CI_SMOKE_TEST = process.argv.includes('--ci-smoke-test');

function focusTeacherWindow() {
  if (!mainWin || mainWin.isDestroyed()) {
    if (!CI_SMOKE_TEST) createWindow();
    return;
  }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

if (HAS_SINGLE_INSTANCE_LOCK) {
  app.on('second-instance', () => {
    try { app.focus({ steal: true }); } catch (_) {}
    focusTeacherWindow();
  });
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1120,
    height: 770,
    minWidth: 920,
    minHeight: 620,
    title: '教师端',
    backgroundColor: '#F2F2F7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWin.loadFile('index.html');
}

async function runCISmokeTest() {
  try {
    if (!app.isPackaged) throw new Error('smoke test must run from a packaged application');
    const smokeAccount = makeStoredAccount({ name: 'CI', password: 'smoke-test', subjects: ['测试'] });
    if (!verifyAccountPassword(smokeAccount, 'smoke-test')) throw new Error('account crypto verification failed');
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await win.loadFile('index.html');
    const title = await win.webContents.executeJavaScript('document.title');
    if (!title.includes('教师端')) throw new Error(`unexpected renderer title: ${title}`);
    win.destroy();
    console.log('[smoke] teacher package ready');
    app.exit(0);
  } catch (error) {
    console.error(`[smoke] teacher package failed: ${error.stack || error.message}`);
    app.exit(1);
  }
}

// ── 窗口控制 ──
ipcMain.on('win-minimize', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.minimize();
});
ipcMain.on('win-maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('win-close', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.close();
});

// ═══════════════════════════════════════
//  启动
// ═══════════════════════════════════════

app.whenReady().then(() => {
  if (!HAS_SINGLE_INSTANCE_LOCK) return;
  if (CI_SMOKE_TEST) return runCISmokeTest();
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (activeMiniProgramPairing) activeMiniProgramPairing.stop();
  activeMiniProgramPairing = null;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
