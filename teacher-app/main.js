const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

// 禁用磁盘缓存
app.commandLine.appendSwitch('disable-http-cache');

// ── 常量 ──
// 教师端仅存储教室 IP 列表和呼叫记录（JSON 文件，体积小无需 SQLite）
// 作业、学科、提交状态等数据始终从教室端通过 WebSocket 获取，不本地存储
const DATA_FILE = app.isPackaged
  ? path.join(app.getPath('userData'), 'data.json')
  : path.join(__dirname, 'data', 'data.json');

// ═══════════════════════════════════════
//  数据读写（仅 rooms + callHistory）
// ═══════════════════════════════════════

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      return { rooms: raw.rooms || [], callHistory: raw.callHistory || [] };
    }
  } catch (e) { console.error('loadData:', e.message); }
  return { rooms: [], callHistory: [] };
}

function saveData(data) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify({ rooms: data.rooms || [], callHistory: data.callHistory || [] }, null, 2), 'utf-8');
}

ipcMain.handle('get-data', () => loadData());
ipcMain.handle('save-data', (_, data) => { saveData(data); return true; });

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
