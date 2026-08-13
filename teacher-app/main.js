const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const {
  publicAccount,
  verifyAccountPassword,
  makeStoredAccount,
} = require('./account-auth');
const { startPairingServer } = require('./mini-program-pairing');
const { buildHomeworkWorkbookBuffer, normalizePayload, safeFilePart } = require('./homework-export');
const connectionCode = require('./connection-code');

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
      return { account: parsed.account || null, rooms: parsed.rooms || [], callHistory: parsed.callHistory || [] };
    }
  } catch (e) { console.error('loadAllData error:', e.message); }
  return { account: null, rooms: [], callHistory: [] };
}

function loadData() {
  const d = loadAllData();
  const rooms = d.rooms.map(room => {
    const subjects = Array.from(new Set((room.subjects || []).map(value => String(value).trim().slice(0, 30)).filter(Boolean))).slice(0, 20);
    if (room.connectionCode && connectionCode.isValid(room.connectionCode)) {
      return { id: room.id, name: room.name || '教室', connectionCode: connectionCode.format(room.connectionCode), subjects };
    }
    try { return { id: room.id, name: room.name || '教室', connectionCode: connectionCode.encode(room.ip), subjects }; }
    catch (_error) { return null; }
  }).filter(Boolean);
  return { account: publicAccount(d.account), rooms, callHistory: d.callHistory };
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
  };
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}

ipcMain.handle('get-data', () => {
  const rooms = migrateStoredRooms();
  const data = loadData();
  return { ...data, rooms };
});
ipcMain.handle('save-data', (_, data) => { saveData(data); return true; });
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
        });
        miniProgramLoginResult = {
          ok: true,
          account: publicAccount(result.account),
          rooms: result.rooms,
          accountChanged,
          callHistory: accountChanged ? [] : previous.callHistory,
        };
      },
    });
    const qrDataUrl = await QRCode.toDataURL(activeMiniProgramPairing.payload, {
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
