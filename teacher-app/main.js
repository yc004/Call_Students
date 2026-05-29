const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

// 禁用磁盘缓存（消除 Chromium cache 权限报错）
app.commandLine.appendSwitch('disable-http-cache');

// ── 常量 ──
const DATA_FILE = app.isPackaged
  ? path.join(app.getPath('userData'), 'data.json')
  : path.join(__dirname, 'data', 'data.json');

// ═══════════════════════════════════════
//  数据读写
// ═══════════════════════════════════════

function loadData() {
  const defaults = { rooms: [], callHistory: [] };
  try {
    if (fs.existsSync(DATA_FILE)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) };
    }
  } catch (e) {
    console.error('loadData error:', e.message);
  }
  return defaults;
}

function saveData(data) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  console.log('[data] saved to', DATA_FILE);
}

// ═══════════════════════════════════════
//  窗口
// ═══════════════════════════════════════

let mainWin = null;

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    title: '教师端 — 教室呼叫系统',
    backgroundColor: '#F8FAFC',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWin.loadFile('index.html');
}

// ═══════════════════════════════════════
//  IPC
// ═══════════════════════════════════════

ipcMain.handle('get-data', () => loadData());
ipcMain.handle('save-data', (_, data) => { saveData(data); return true; });

// ═══════════════════════════════════════
//  启动
// ═══════════════════════════════════════

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  console.log('[data] path:', DATA_FILE);
  createWindow();
});

app.on('window-all-closed', () => {
  // macOS 下不自动退出，保持和其他应用一致
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
