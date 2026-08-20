const { app, BrowserWindow, ipcMain, Menu, dialog, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const {
  publicAccount,
  verifyAccountPassword,
  makeStoredAccount,
} = require('./account-auth');
const { startPairingServer } = require('./mini-program-pairing');
const { normalizeWechatDirectBaseUrl, createTeacherPairingDirectLink } = require('./wechat-direct-link');
const { buildHomeworkWorkbookBuffer, normalizePayload, safeFilePart } = require('./homework-export');
const connectionCode = require('./connection-code');
const { normalizeServerUrl, requestJson } = require('./cloud-client');

// 教师端只能有一个运行实例，避免多个窗口同时持有账号和教室连接状态。
// 第二次启动由已运行实例唤醒主窗口后退出。
const HAS_SINGLE_INSTANCE_LOCK = app.requestSingleInstanceLock();
if (!HAS_SINGLE_INSTANCE_LOCK) {
  console.warn('[single-instance] another teacher app instance is already running');
  app.quit();
}

// 禁用磁盘缓存
app.commandLine.appendSwitch('disable-http-cache');

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
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      const settings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {};
      if (settings.cloud && settings.cloud.tokensEncrypted && safeStorage.isEncryptionAvailable()) {
        try { Object.assign(settings.cloud, JSON.parse(safeStorage.decryptString(Buffer.from(settings.cloud.tokensEncrypted, 'base64')))); delete settings.cloud.tokensEncrypted; } catch (_error) { settings.cloud = null; }
      }
      return {
        account: parsed.account || null,
        rooms: parsed.rooms || [],
        callHistory: parsed.callHistory || [],
        settings,
      };
    }
  } catch (e) { console.error('loadAllData error:', e.message); }
  return { account: null, rooms: [], callHistory: [], settings: {} };
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
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2), 'utf-8');
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
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}

async function ensureCloudSession(cloud) {
  if (!cloud) throw new Error('尚未配置云服务');
  const expiresAt = new Date(cloud.accessExpiresAt || 0).getTime();
  if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 60000) return cloud;
  const session = await requestJson(cloud.serverUrl, '/api/v1/auth/refresh', { method:'POST', body:{ refreshToken:cloud.refreshToken } });
  const updated = { ...cloud, ...session };
  const stored = loadAllData();
  saveData({ settings:{ ...stored.settings, cloud:updated } });
  return updated;
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
    const serverUrl = normalizeServerUrl(value && value.serverUrl);
    const accessToken = String(value && value.accessToken || '');
    const refreshToken = String(value && value.refreshToken || '');
    if (!accessToken || !refreshToken) throw new Error('云服务登录凭证不完整，请重新使用小程序扫码登录');
    await requestJson(serverUrl, '/health/live');
    const stored = loadAllData();
    const cloud = { ...value, serverUrl, accessToken, refreshToken };
    saveData({ settings:{ ...stored.settings, cloud } });
    return { ok:true, cloud };
  } catch (error) { return { ok:false, message:error.message || '云服务配置失败' }; }
});
ipcMain.handle('refresh-cloud-classrooms', async () => {
  try {
    const stored = loadAllData();
    const cloud = await ensureCloudSession(stored.settings.cloud);
    const result = await requestJson(cloud.serverUrl, '/api/v1/classrooms', { token:cloud.accessToken });
    const cloudRooms = (result.classrooms || []).map(room => ({
      id:room.id, cloudClassroomId:room.id, transport:'cloud', name:room.name || '云端教室',
      connectionCode:room.lan_connection_code && connectionCode.isValid(room.lan_connection_code) ? connectionCode.format(room.lan_connection_code) : '',
      subjects:Array.isArray(room.subjects_json) ? room.subjects_json : [], role:room.role, cloudStatus:room.device_status || 'offline',
    }));
    const localRooms = stored.rooms.filter(room => room.transport !== 'cloud');
    saveData({ rooms:[...localRooms, ...cloudRooms] });
    return { ok:true, rooms:cloudRooms, cloud };
  } catch (error) { return { ok:false, message:error.message || '无法同步云端教室' }; }
});
ipcMain.handle('enroll-teacher-cloud', async (_, input) => {
  try {
    const stored = loadAllData();
    if (!stored.account) return { ok:false, message:'请先使用小程序扫码登录教师端' };
    if (stored.settings.cloud) return { ok:false, message:'当前教师账号已经接入云服务，请直接刷新教室数据' };
    const serverUrl = normalizeServerUrl(input && input.serverUrl);
    const key = String(input && input.key || '').trim();
    const result = await requestJson(serverUrl, '/api/v1/enrollment/teacher/redeem', { method:'POST', body:{ key, name:stored.account.name, legacyConnectionId:stored.account.connectionId, deviceName:os.hostname() || '教师电脑', deviceType:'teacher-desktop' } });
    const cloud = { version:1, serverUrl, userId:result.user.id, userName:result.user.name, accessToken:result.accessToken, accessExpiresAt:result.accessExpiresAt, refreshToken:result.refreshToken, expiresAt:result.expiresAt };
    saveData({ account:{ ...stored.account, name:result.user.name }, settings:{ ...stored.settings, cloud } });
    const classrooms = await requestJson(serverUrl, '/api/v1/classrooms', { token:cloud.accessToken });
    const cloudRooms = (classrooms.classrooms || []).map(room => ({ id:room.id, cloudClassroomId:room.id, transport:'cloud', name:room.name || '云端教室', connectionCode:room.lan_connection_code && connectionCode.isValid(room.lan_connection_code) ? connectionCode.format(room.lan_connection_code) : '', subjects:Array.isArray(room.subjects_json) ? room.subjects_json : [], role:room.role, cloudStatus:room.device_status || 'offline' }));
    saveData({ rooms:[...stored.rooms.filter(room => room.transport !== 'cloud'), ...cloudRooms] });
    return { ok:true, cloud, rooms:cloudRooms };
  } catch (error) { return { ok:false, message:error.message || '教师端接入云服务失败' }; }
});
ipcMain.handle('clear-teacher-session', async () => {
  const stored = loadAllData();
  if (stored.settings.cloud && stored.settings.cloud.refreshToken) {
    try { await requestJson(stored.settings.cloud.serverUrl, '/api/v1/auth/logout', { method:'POST', body:{ refreshToken:stored.settings.cloud.refreshToken } }); } catch (_error) {}
  }
  saveData({ account:null, rooms:[], callHistory:[], settings:{ ...stored.settings, cloud:null } });
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
    miniProgramLoginResult = null;
    if (activeMiniProgramPairing) await activeMiniProgramPairing.stop();
    activeMiniProgramPairing = await startPairingServer({
      onComplete: result => {
        const previous = loadAllData();
        const accountChanged = !previous.account || previous.account.connectionId !== result.account.connectionId;
        saveData({
          account: result.account,
          rooms: result.rooms,
          callHistory: accountChanged ? [] : previous.callHistory,
          settings:{ ...previous.settings, cloud:result.cloud || null },
        });
        miniProgramLoginResult = {
          ok: true,
          account: publicAccount(result.account),
          rooms: result.rooms,
          cloud:result.cloud || null,
          accountChanged,
          callHistory: accountChanged ? [] : previous.callHistory,
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
