const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const {
  publicAccount,
  verifyAccountPassword,
  makeStoredAccount,
  generateLoginKey,
  parseLoginKey,
  generateMiniProgramLoginPayload,
} = require('./account-auth');

// 禁用磁盘缓存
app.commandLine.appendSwitch('disable-http-cache');

// ── 常量 ──
// 教师端存储本机教师账户、教室 IP 列表和呼叫记录（JSON 文件，体积小无需 SQLite）
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
  return { account: publicAccount(d.account), rooms: d.rooms, callHistory: d.callHistory };
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

ipcMain.handle('get-data', () => loadData());
ipcMain.handle('save-data', (_, data) => { saveData(data); return true; });
ipcMain.handle('register-account', (_, input) => {
  const existing = loadAllData().account;
  if (existing) return { ok: false, message: '本机已有教师账户，请先登录' };
  if (!input || !input.name || !input.name.trim()) return { ok: false, message: '请输入教师姓名' };
  if (!input.password || input.password.length < 6) return { ok: false, message: '密码至少需要 6 位' };
  const account = makeStoredAccount(input);
  saveData({ account });
  return { ok: true, account: publicAccount(account) };
});
ipcMain.handle('login-account', (_, name, password) => {
  const stored = loadAllData().account;
  if (!stored || stored.name !== String(name || '').trim() || !verifyAccountPassword(stored, password || '')) {
    return { ok: false, message: '姓名或密码不正确' };
  }
  if (typeof stored.password === 'string') {
    const migrated = makeStoredAccount({ name: stored.name, password, subjects: stored.subjects || [] }, stored.connectionId);
    saveData({ account: migrated });
    return { ok: true, account: publicAccount(migrated) };
  }
  return { ok: true, account: publicAccount(stored) };
});
ipcMain.handle('generate-login-key', () => {
  const stored = loadAllData().account;
  if (!stored) return { ok: false, message: '请先登录教师账户' };
  try {
    return { ok: true, loginKey: generateLoginKey(stored) };
  } catch (error) {
    return { ok: false, message: error.message || '登录密钥生成失败' };
  }
});
ipcMain.handle('generate-mini-program-qr', async () => {
  const stored = loadAllData();
  if (!stored.account) return { ok: false, message: '请先登录教师账户' };
  try {
    const payload = generateMiniProgramLoginPayload(stored.account, stored.rooms);
    const qrDataUrl = await QRCode.toDataURL(payload, {
      width: 360,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#172033', light: '#FFFFFF' },
    });
    return { ok: true, qrDataUrl, roomCount: stored.rooms.length };
  } catch (error) {
    return { ok: false, message: error.message || '二维码生成失败' };
  }
});
ipcMain.handle('import-login-key', (_, loginKey, replaceExisting = false) => {
  let imported;
  try {
    imported = parseLoginKey(loginKey);
  } catch (error) {
    return { ok: false, message: error.message || '登录密钥无效' };
  }
  const existing = loadAllData().account;
  if (existing && existing.connectionId !== imported.connectionId && !replaceExisting) {
    return {
      ok: false,
      needsReplace: true,
      message: `本机已有“${existing.name || '教师'}”账户，导入将替换本机账户。`,
    };
  }
  saveData({ account: imported });
  return { ok: true, account: publicAccount(imported) };
});
// ═══════════════════════════════════════
//  窗口
// ═══════════════════════════════════════

let mainWin = null;
const CI_SMOKE_TEST = process.argv.includes('--ci-smoke-test');

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
  if (CI_SMOKE_TEST) return runCISmokeTest();
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
