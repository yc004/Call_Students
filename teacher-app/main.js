const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { publicAccount, verifyAccountPassword, makeStoredAccount } = require('./account-auth');

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
// ═══════════════════════════════════════
//  窗口
// ═══════════════════════════════════════

let mainWin = null;

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
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
