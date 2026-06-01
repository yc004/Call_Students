const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require('electron');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

app.commandLine.appendSwitch('disable-http-cache');
const zlib = require('zlib');

// ── 常量 ──
const DATA_DIR = app.isPackaged
  ? app.getPath('userData')
  : path.join(__dirname, 'data');
const DB_FILE   = path.join(DATA_DIR, 'data.db');
const JSON_FILE = path.join(DATA_DIR, 'data.json'); // 旧格式，用于迁移
const WS_PORT = 3456;
const POPUP_W = 500;
const POPUP_H = 300;

// ── 状态 ──
let tray = null;
let manageWin = null;
let popupWin = null;
let boardWin = null;
let wss = null;
let heartbeatTimer = null;
const callMap = new Map();
const callQueue = [];
let isPopupBusy = false;
let db = null;

// ═══════════════════════════════════════
//  SQLite 数据库
// ═══════════════════════════════════════

function getDb() {
  if (db) return db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS subjects (name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS assignments (id TEXT PRIMARY KEY, subject TEXT, title TEXT, date TEXT);
    CREATE TABLE IF NOT EXISTS submissions (assignment_id TEXT, student_id TEXT, status TEXT DEFAULT '未提交', PRIMARY KEY (assignment_id, student_id));
  `);
  // 从旧 JSON 文件迁移
  if (fs.existsSync(JSON_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
      const data = { className: raw.className || '', students: raw.students || [], subjects: raw.subjects || [], assignments: raw.assignments || [] };
      saveData(data);
      fs.renameSync(JSON_FILE, JSON_FILE + '.bak');
      console.log('[db] migrated from data.json');
    } catch (e) { console.error('[db] migration failed:', e.message); }
  }
  return db;
}

function loadData() {
  const d = getDb();
  const className = d.prepare("SELECT value FROM meta WHERE key='className'").get()?.value || '';
  const students = d.prepare('SELECT id, name FROM students ORDER BY rowid').all();
  const subjects = d.prepare('SELECT name FROM subjects ORDER BY name').all().map(r => r.name);
  const assignments = d.prepare('SELECT id, subject, title, date FROM assignments ORDER BY date').all();
  for (const a of assignments) {
    a.submissions = {};
    const rows = d.prepare('SELECT student_id, status FROM submissions WHERE assignment_id=?').all(a.id);
    rows.forEach(r => { a.submissions[r.student_id] = r.status; });
  }
  return { className, students, subjects, assignments };
}

function saveData(data) {
  const d = getDb();
  const txn = d.transaction(() => {
    d.prepare("INSERT OR REPLACE INTO meta VALUES ('className', ?)").run(data.className || '');
    // students
    d.prepare('DELETE FROM students').run();
    for (const s of (data.students || [])) {
      d.prepare('INSERT INTO students (id, name) VALUES (?, ?)').run(s.id, s.name);
    }
    // subjects
    d.prepare('DELETE FROM subjects').run();
    for (const s of (data.subjects || [])) {
      d.prepare('INSERT OR IGNORE INTO subjects (name) VALUES (?)').run(s);
    }
    // assignments + submissions
    d.prepare('DELETE FROM assignments').run();
    d.prepare('DELETE FROM submissions').run();
    for (const a of (data.assignments || [])) {
      d.prepare('INSERT INTO assignments (id, subject, title, date) VALUES (?,?,?,?)').run(a.id, a.subject, a.title, a.date);
      for (const [sid, status] of Object.entries(a.submissions || {})) {
        d.prepare('INSERT INTO submissions (assignment_id, student_id, status) VALUES (?,?,?)').run(a.id, sid, status);
      }
    }
  });
  txn();
  notifyBoardDataChanged();
}

// ═══════════════════════════════════════
//  托盘图标生成（纯内存 PNG，零外部依赖）
// ═══════════════════════════════════════

function createTrayIconPNG() {
  const S = 32;
  const raw = Buffer.alloc(S * (S * 4 + 1)); // 每行: 1 字节 filter + S×4 像素
  const cx = S / 2 - 0.5, cy = S / 2 - 0.5;
  const r1 = S / 2 - 2, r2 = S / 2;

  for (let y = 0; y < S; y++) {
    const off = y * (S * 4 + 1);
    raw[off] = 0; // filter: None
    for (let x = 0; x < S; x++) {
      const i = off + 1 + x * 4;
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= r1) {
        raw[i] = 79; raw[i + 1] = 110; raw[i + 2] = 247; raw[i + 3] = 255;
      } else if (d <= r2) {
        const a = Math.round(((r2 - d) / (r2 - r1)) * 255);
        raw[i] = 79; raw[i + 1] = 110; raw[i + 2] = 247; raw[i + 3] = Math.max(0, Math.min(255, a));
      }
    }
  }

  const cmp = zlib.deflateSync(raw);

  function crc32(buf) {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const tb = Buffer.from(type);
    const cd = Buffer.concat([tb, data]);
    const cv = Buffer.alloc(4); cv.writeUInt32BE(crc32(cd));
    return Buffer.concat([len, tb, data, cv]);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', cmp), chunk('IEND', Buffer.alloc(0))]);
}

// ═══════════════════════════════════════
//  托盘
// ═══════════════════════════════════════

function createTray() {
  const icon = nativeImage.createFromBuffer(createTrayIconPNG());
  tray = new Tray(icon);
  tray.setToolTip('教室呼叫系统 - 运行中');

  rebuildTrayMenu();
  tray.on('double-click', () => createManageWindow());
}

function rebuildTrayMenu() {
  const autoLaunch = app.getLoginItemSettings().openAtLogin;
  const menu = Menu.buildFromTemplate([
    { label: '📋 学生管理', click: () => createManageWindow() },
    { label: '📊 作业看板', click: () => createBoardWindow() },
    { type: 'separator' },
    { label: (autoLaunch ? '☑' : '☐') + ' 开机自启',
      click: () => {
        const current = app.getLoginItemSettings().openAtLogin;
        app.setLoginItemSettings({ openAtLogin: !current });
        rebuildTrayMenu();
      }
    },
    { type: 'separator' },
    { label: '❌ 退出', click: () => { if (wss) wss.close(); app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

// ═══════════════════════════════════════
//  管理窗口
// ═══════════════════════════════════════

function createManageWindow() {
  if (manageWin && !manageWin.isDestroyed()) { manageWin.focus(); return; }
  manageWin = new BrowserWindow({
    width: 700,
    height: 600,
    minWidth: 500,
    minHeight: 400,
    title: '教室管理 — 学生名单',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  manageWin.loadFile('manage.html');
  manageWin.on('closed', () => { manageWin = null; });
}

// ═══════════════════════════════════════
//  呼叫弹窗
// ═══════════════════════════════════════

function createPopupWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  popupWin = new BrowserWindow({
    width: POPUP_W,
    height: POPUP_H,
    x: Math.round((sw - POPUP_W) / 2),
    y: Math.round((sh - POPUP_H) / 3),       // 偏上
    frame: false,
    thickFrame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  popupWin.loadFile('popup.html');

  popupWin.webContents.on('did-finish-load', () => {
    // 弹窗就绪 → 从队列取一个呼叫推送过去
    if (callQueue.length > 0) {
      const { call } = callQueue.shift();
      popupWin.webContents.send('show-call', {
        callId:      call.callId,
        studentName: call.studentName,
        className:   call.className,
        message:     call.message,
      });
      isPopupBusy = true;
    }
  });

  popupWin.on('closed', () => {
    popupWin = null;
    isPopupBusy = false;
    // 处理队列中的下一个
    if (callQueue.length > 0) createPopupWindow();
  });
}

function enqueueCall(call, ws) {
  callMap.set(call.callId, ws);
  callQueue.push({ call, ws });
  if (!isPopupBusy && !popupWin) createPopupWindow();
}

// ═══════════════════════════════════════
//  作业看板（悬浮窗，常驻桌面）
// ═══════════════════════════════════════

function createBoardWindow() {
  if (boardWin && !boardWin.isDestroyed()) { boardWin.focus(); return; }
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  boardWin = new BrowserWindow({
    width: 620,
    height: 420,
    x: Math.round((sw - 620) / 2),
    y: Math.round((sh - 420) / 2),
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    transparent: true,
    title: '作业看板 — 当天提交情况',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  boardWin.loadFile('homework-board.html');
  boardWin.on('closed', () => { boardWin = null; });
}

// ═══════════════════════════════════════
//  WebSocket 服务
// ═══════════════════════════════════════

function startWSServer() {
  wss = new WebSocket.Server({ port: WS_PORT, host: '0.0.0.0' });
  console.log(`[WS] listening on 0.0.0.0:${WS_PORT}`);

  wss.on('connection', (ws, req) => {
    const remote = req.socket.remoteAddress;
    console.log(`[WS] teacher connected (${remote})`);
    ws._lastPing = Date.now();

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.type) {

        case 'connect': {
          const data = loadData();
          ws.send(JSON.stringify({ type: 'sync', className: data.className, students: data.students, subjects: data.subjects, assignments: data.assignments }));
          break;
        }

        case 'call': {
          if (!msg.callId || !msg.studentName) return;
          enqueueCall({
            callId: msg.callId,
            studentName: msg.studentName,
            className: msg.className || '',
            message: msg.message || '办公室',
          }, ws);
          break;
        }

        case 'ping': {
          ws._lastPing = Date.now();
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        }

        case 'update-submission': {
          if (!msg.assignmentId || !msg.studentId) return;
          const data = loadData();
          const assignment = data.assignments.find(a => a.id === msg.assignmentId);
          if (assignment) {
            assignment.submissions[msg.studentId] = msg.status || '未提交';
            saveData(data);
            ws.send(JSON.stringify({ type: 'sync', className: data.className, students: data.students, subjects: data.subjects, assignments: data.assignments }));
          }
          break;
        }

        case 'update-assignments': {
          if (!msg.action) return;
          const data = loadData();
          if (msg.action === 'add' && msg.assignment) {
            data.assignments.push(msg.assignment);
          } else if (msg.action === 'delete' && msg.assignment) {
            data.assignments = data.assignments.filter(a => a.id !== msg.assignment.id);
          } else if (msg.action === 'edit' && msg.assignment) {
            const idx = data.assignments.findIndex(a => a.id === msg.assignment.id);
            if (idx >= 0) data.assignments[idx] = msg.assignment;
          }
          saveData(data);
          ws.send(JSON.stringify({ type: 'sync', className: data.className, students: data.students, subjects: data.subjects, assignments: data.assignments }));
          break;
        }

        case 'update-subjects': {
          if (!msg.action) return;
          const data = loadData();
          if (msg.action === 'add' && msg.subject && !data.subjects.includes(msg.subject)) {
            data.subjects.push(msg.subject);
            data.subjects.sort();
          } else if (msg.action === 'delete' && msg.subject) {
            data.subjects = data.subjects.filter(s => s !== msg.subject);
            data.assignments = data.assignments.filter(a => a.subject !== msg.subject);
          }
          saveData(data);
          ws.send(JSON.stringify({ type: 'sync', className: data.className, students: data.students, subjects: data.subjects, assignments: data.assignments }));
          break;
        }
      }
    });

    ws.on('close', () => {
      console.log(`[WS] teacher disconnected (${remote})`);
      for (const [callId, conn] of callMap) if (conn === ws) callMap.delete(callId);
    });

    ws.on('error', (err) => console.error(`[WS] error:`, err.message));
  });

  // 心跳超时检测：每 15s 检查一次，超过 60s 无心跳则断开
  heartbeatTimer = setInterval(() => {
    if (!wss) return;
    const now = Date.now();
    wss.clients.forEach(ws => {
      if (now - (ws._lastPing || 0) > 60000) {
        console.log('[WS] heartbeat timeout, terminating connection');
        ws.terminate();
      }
    });
  }, 15000);
}

// ═══════════════════════════════════════
//  IPC 处理
// ═══════════════════════════════════════

ipcMain.handle('get-data', () => loadData());
ipcMain.handle('save-data', (_, data) => { saveData(data); return true; });
ipcMain.on('open-manage', () => createManageWindow());

// 弹窗展示完毕 → 回传 ack 给教师端
ipcMain.on('call-ack', (_, callId) => {
  const ws = callMap.get(callId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ack', callId, status: 'displayed' }));
  }
  callMap.delete(callId);
});

// 弹窗手动关闭
ipcMain.on('close-popup', () => {
  if (popupWin && !popupWin.isDestroyed()) popupWin.close();
});

// 作业看板：关闭
ipcMain.on('close-board', () => {
  if (boardWin && !boardWin.isDestroyed()) boardWin.close();
});

// 作业看板：拖拽移动
ipcMain.on('move-board', (_, dx, dy) => {
  if (boardWin && !boardWin.isDestroyed()) {
    const [x, y] = boardWin.getPosition();
    boardWin.setPosition(x + dx, y + dy);
  }
});

// 数据变更时通知看板刷新
function notifyBoardDataChanged() {
  if (boardWin && !boardWin.isDestroyed()) {
    boardWin.webContents.send('data-changed');
  }
}

// ═══════════════════════════════════════
//  应用生命周期
// ═══════════════════════════════════════

app.whenReady().then(() => {
  // 隐藏默认菜单栏
  Menu.setApplicationMenu(null);
  // ── 启动日志 ──
  const line = '='.repeat(50);
  console.log(line);
  console.log('  Classroom Call System - Classroom App');
  console.log(line);
  console.log(`  WS Port  : ${WS_PORT}`);
  console.log(`  Database : ${DB_FILE}`);
  console.log(line);

  // 默认开启开机自启（首次运行）
  const loginSettings = app.getLoginItemSettings();
  if (!loginSettings.wasOpenedAtLogin && !loginSettings.openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  startWSServer();
  createTray();
});

// 阻止所有窗口关闭时退出（托盘常驻）
app.on('window-all-closed', () => { /* 什么都不做，保持托盘运行 */ });

app.on('before-quit', () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (wss) wss.close();
});

app.on('activate', () => {
  // macOS dock 点击 → 打开管理
  createManageWindow();
});
