const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require('electron');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

app.commandLine.appendSwitch('disable-http-cache');
const zlib = require('zlib');

// ── 常量 ──
const DATA_DIR = app.isPackaged
  ? app.getPath('userData')
  : path.join(__dirname, 'data');
const DB_FILE   = path.join(DATA_DIR, 'data.db');
const JSON_FILE = path.join(DATA_DIR, 'data.json'); // 旧格式，用于迁移
const LOG_FILE  = path.join(DATA_DIR, 'debug.log');
const WS_PORT = 3456;
const POPUP_W = 500;
const POPUP_H = 300;

// ── 日志 ──
function logToFile(tag, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${tag}] ${msg}\n`;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch (_) { /* 忽略日志写入失败 */ }
  console.log(line.trim());
}
// 启动时清空旧日志
try { fs.writeFileSync(LOG_FILE, '', 'utf-8'); } catch (_) {}

// ── 状态 ──
let tray = null;
let manageWin = null;
let popupWin = null;
let boardWin = null;
let passwordWin = null;
let pendingWindow = null;  // 'manage' | 'board' — 密码验证通过后打开的目标窗口
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
    CREATE TABLE IF NOT EXISTS approved_teachers (connection_id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, subjects TEXT DEFAULT '[]', approved_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pending_requests (connection_id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, subjects TEXT DEFAULT '[]', requested_at TEXT NOT NULL);
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
  const t0 = Date.now();
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
  const took = Date.now() - t0;
  if (took > 50) logToFile('db', `loadData slow: ${took}ms, ${students.length}s/${subjects.length}subj/${assignments.length}hw`);
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
  const t1 = Date.now();
  notifyAllDataChanged(data);
  const t2 = Date.now();
  if (t2 - t1 > 30) logToFile('save', `notifyAllDataChanged slow: ${t2 - t1}ms`);
}

// ═══════════════════════════════════════
//  密码管理（SHA-256 哈希存储）
// ═══════════════════════════════════════

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd).digest('hex');
}

function getPasswordHash() {
  const d = getDb();
  return d.prepare("SELECT value FROM meta WHERE key='password'").get()?.value || '';
}

function verifyPassword(pwd) {
  const stored = getPasswordHash();
  if (!stored) return true;  // 未设置密码 → 允许
  return stored === hashPassword(pwd);
}

function changePassword(oldPwd, newPwd) {
  const stored = getPasswordHash();
  if (stored && stored !== hashPassword(oldPwd)) return false;  // 旧密码不匹配
  const d = getDb();
  if (newPwd) {
    d.prepare("INSERT OR REPLACE INTO meta VALUES ('password', ?)").run(hashPassword(newPwd));
  } else {
    d.prepare("DELETE FROM meta WHERE key='password'").run();
  }
  return true;
}

function hasPassword() {
  return !!getPasswordHash();
}

// ═══════════════════════════════════════
//  教师账号管理
// ═══════════════════════════════════════

function getApprovedTeachers() {
  const d = getDb();
  return d.prepare('SELECT * FROM approved_teachers ORDER BY approved_at').all().map(r => ({
    connection_id: r.connection_id, name: r.name, role: r.role,
    subjects: JSON.parse(r.subjects || '[]'), approved_at: r.approved_at,
  }));
}

function getPendingRequests() {
  const d = getDb();
  return d.prepare('SELECT * FROM pending_requests ORDER BY requested_at').all().map(r => ({
    connection_id: r.connection_id, name: r.name, role: r.role,
    subjects: JSON.parse(r.subjects || '[]'), requested_at: r.requested_at,
  }));
}

function findTeacher(connectionId) {
  const d = getDb();
  let row = d.prepare('SELECT * FROM approved_teachers WHERE connection_id=?').get(connectionId);
  if (row) return { found: true, approved: true, name: row.name, role: row.role, subjects: JSON.parse(row.subjects || '[]') };
  row = d.prepare('SELECT * FROM pending_requests WHERE connection_id=?').get(connectionId);
  if (row) return { found: true, approved: false, name: row.name, role: row.role, subjects: JSON.parse(row.subjects || '[]') };
  return { found: false };
}

function approveTeacher(connectionId) {
  const d = getDb();
  const row = d.prepare('SELECT * FROM pending_requests WHERE connection_id=?').get(connectionId);
  if (!row) return false;
  d.prepare('INSERT INTO approved_teachers (connection_id, name, role, subjects, approved_at) VALUES (?,?,?,?,?)')
    .run(connectionId, row.name, row.role, row.subjects, new Date().toISOString());
  d.prepare('DELETE FROM pending_requests WHERE connection_id=?').run(connectionId);
  return true;
}

function rejectTeacher(connectionId) {
  getDb().prepare('DELETE FROM pending_requests WHERE connection_id=?').run(connectionId);
}

function updateTeacher(connectionId, data) {
  const d = getDb();
  const row = d.prepare('SELECT * FROM approved_teachers WHERE connection_id=?').get(connectionId);
  if (!row) return false;
  d.prepare('UPDATE approved_teachers SET role=?, subjects=? WHERE connection_id=?')
    .run(data.role || row.role, JSON.stringify(data.subjects || []), connectionId);
  return true;
}

function removeTeacher(connectionId) {
  getDb().prepare('DELETE FROM approved_teachers WHERE connection_id=?').run(connectionId);
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
  tray.on('double-click', () => openManageWindow());
}

function rebuildTrayMenu() {
  const autoLaunch = app.getLoginItemSettings().openAtLogin;
  const menu = Menu.buildFromTemplate([
    { label: '📋 学生管理', click: () => openManageWindow() },
    { label: '📊 作业看板', click: () => openBoardWindow() },
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
//  密码验证窗口
// ═══════════════════════════════════════

function createPasswordWindow(target) {
  if (passwordWin && !passwordWin.isDestroyed()) {
    passwordWin.focus();
    return;
  }
  passwordWin = new BrowserWindow({
    width: 380,
    height: 280,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: '密码验证',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  passwordWin.loadFile('password.html', { query: { target } });
  passwordWin.on('closed', () => { passwordWin = null; pendingWindow = null; });
}

// ═══════════════════════════════════════
//  管理窗口（密码保护）
// ═══════════════════════════════════════

function openManageWindow() {
  if (hasPassword()) {
    pendingWindow = 'manage';
    createPasswordWindow('manage');
  } else {
    createManageWindow();
  }
}

function openBoardWindow() {
  createBoardWindow();
}

function createManageWindow() {
  if (manageWin && !manageWin.isDestroyed()) { manageWin.focus(); return; }
  manageWin = new BrowserWindow({
    width: 720,
    height: 620,
    minWidth: 520,
    minHeight: 420,
    frame: false,
    title: '教室管理',
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
//  作业看板（标准窗口，常驻桌面）
// ═══════════════════════════════════════

function createBoardWindow() {
  if (boardWin && !boardWin.isDestroyed()) { boardWin.focus(); return; }
  logToFile('board', 'createBoardWindow start');
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  boardWin = new BrowserWindow({
    width: 700,
    height: 480,
    x: Math.round((sw - 700) / 2),
    y: Math.round((sh - 480) / 2),
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: '#F8FAFC',
    title: '作业看板',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  boardWin.loadFile('homework-board.html');
  boardWin.webContents.on('did-finish-load', () => logToFile('board', 'window did-finish-load'));
  boardWin.webContents.on('render-process-gone', (_, details) => logToFile('board', `RENDER GONE: ${JSON.stringify(details)}`));
  boardWin.on('closed', () => { logToFile('board', 'window closed'); boardWin = null; });
  boardWin.on('unresponsive', () => logToFile('board', 'WINDOW UNRESPONSIVE!'));
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
    ws._authenticated = !hasPassword();  // 未设密码 → 默认已认证

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.type) {

        case 'connect': {
          const pwdSet = hasPassword();
          const data = loadData();
          let teacher = null;

          if (msg.connectionId) {
            const t = findTeacher(msg.connectionId);
            if (t.found && t.approved) {
              // 已批准：以教室端存储的身份为准（管理员可修改角色/学科）
              teacher = { connectionId: msg.connectionId, name: t.name, role: t.role, subjects: t.subjects, status: 'approved' };
              // 若教师端上报的姓名有变化，更新数据库
              if (msg.name && msg.name !== t.name) {
                getDb().prepare('UPDATE approved_teachers SET name=? WHERE connection_id=?').run(msg.name, msg.connectionId);
                teacher.name = msg.name;
              }
            } else if (t.found && !t.approved) {
              // 待审核：更新教师最新上报的身份信息
              const newName = msg.name || t.name;
              const newSubjects = msg.subjects && msg.subjects.length ? msg.subjects : t.subjects;
              getDb().prepare('UPDATE pending_requests SET name=?, subjects=?, requested_at=? WHERE connection_id=?')
                .run(newName, JSON.stringify(newSubjects), new Date().toISOString(), msg.connectionId);
              teacher = { connectionId: msg.connectionId, name: newName, role: t.role, subjects: newSubjects, status: 'pending' };
            } else {
              getDb().prepare('INSERT INTO pending_requests (connection_id, name, role, subjects, requested_at) VALUES (?,?,?,?,?)')
                .run(msg.connectionId, msg.name || '', '授课教师', JSON.stringify(msg.subjects || []), new Date().toISOString());
              teacher = { connectionId: msg.connectionId, name: msg.name || '', role: '授课教师', subjects: msg.subjects || [], status: 'pending' };
            }
          } else {
            // 旧版连接：无 connectionId，视为班主任兼容
            teacher = { connectionId: '', name: '(旧版连接)', role: '班主任', subjects: [], status: 'approved' };
          }
          ws._teacher = teacher;

          ws.send(JSON.stringify({
            type: 'sync',
            className: data.className,
            students: data.students,
            subjects: data.subjects,
            assignments: data.assignments,
            hasPassword: pwdSet,
            teacher: teacher,
          }));
          console.log(`[WS] connect from ${remote}, teacher=${teacher.name}, role=${teacher.role}, status=${teacher.status}`);

          // 通知管理窗口：待审核列表有变化
          if (teacher.status === 'pending') notifyManageTeachersChanged();
          break;
        }

        case 'join-request': {
          // 教师主动发起加入请求
          const jt = ws._teacher;
          if (jt && jt.status === 'pending') {
            getDb().prepare('UPDATE pending_requests SET requested_at=? WHERE connection_id=?')
              .run(new Date().toISOString(), jt.connectionId);
            ws.send(JSON.stringify({ type: 'join-ack', status: 'pending' }));
            logToFile('ws', `join-request from ${jt.name} (${jt.connectionId})`);
            notifyManageTeachersChanged();
          }
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
          if (!checkTeacherPerm(ws, msg)) return;
          if (!msg.assignmentId || !msg.studentId) return;
          const data = loadData();
          const assignment = data.assignments.find(a => a.id === msg.assignmentId);
          if (assignment) {
            assignment.submissions[msg.studentId] = msg.status || '未提交';
            saveData(data);
            broadcastSync(data);
          }
          break;
        }

        case 'update-assignments': {
          if (!checkTeacherPerm(ws, msg)) return;
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
          broadcastSync(data);
          break;
        }

        case 'update-subjects': {
          const t = (ws._teacher || {});
          if (t.role !== '班主任') { ws.send(JSON.stringify({ type: 'auth-required', message: '仅班主任可管理学科' })); return; }
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
          broadcastSync(data);
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

// 权限检查：授课教师只能操作自己学科的作业
function checkTeacherPerm(ws, msg) {
  const t = ws._teacher || {};
  if (!t.status || t.status !== 'approved') {
    ws.send(JSON.stringify({ type: 'auth-required', message: '未获批准，无法修改数据' }));
    return false;
  }
  if (t.role !== '班主任') {
    // 确定涉及的学科
    let subject = null;
    if (msg.assignment && msg.assignment.subject) {
      subject = msg.assignment.subject;
    } else if (msg.assignmentId) {
      const data = loadData();
      const a = data.assignments.find(x => x.id === msg.assignmentId);
      if (a) subject = a.subject;
    }
    if (subject && !(t.subjects || []).includes(subject)) {
      ws.send(JSON.stringify({ type: 'auth-required', message: '无权限修改该学科作业' }));
      return false;
    }
  }
  return true;
}

// 广播同步数据（每个连接带个性化 teacher 信息）
function broadcastSync(data) {
  if (!wss) return;
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN && ws._teacher) {
      ws.send(JSON.stringify({
        type: 'sync',
        className: data.className,
        students: data.students,
        subjects: data.subjects,
        assignments: data.assignments,
        hasPassword: hasPassword(),
        teacher: {
          connectionId: ws._teacher.connectionId,
          name: ws._teacher.name,
          role: ws._teacher.role,
          subjects: ws._teacher.subjects,
          status: ws._teacher.status,
        },
      }));
    }
  });
}

// ═══════════════════════════════════════
//  IPC 处理
// ═══════════════════════════════════════

ipcMain.handle('get-data', () => {
  logToFile('ipc', 'get-data called');
  const t0 = Date.now();
  const r = loadData();
  const t1 = Date.now();
  if (t1 - t0 > 100) logToFile('ipc', `get-data slow: ${t1 - t0}ms`);
  return r;
});
ipcMain.handle('save-data', (_, data) => {
  logToFile('ipc', `save-data called, ${(data.students||[]).length}s/${(data.assignments||[]).length}hw`);
  const t0 = Date.now();
  saveData(data);
  const t1 = Date.now();
  if (t1 - t0 > 100) logToFile('ipc', `save-data slow: ${t1 - t0}ms`);
  return true;
});
ipcMain.on('open-manage', () => openManageWindow());

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

// ── 密码相关 IPC ──

ipcMain.handle('verify-password', (_, pwd) => {
  return verifyPassword(pwd);
});

ipcMain.on('password-ok', (_, target) => {
  if (passwordWin && !passwordWin.isDestroyed()) passwordWin.close();
  if (target === 'manage') createManageWindow();
  else if (target === 'board') createBoardWindow();
});

ipcMain.on('close-password', () => {
  pendingWindow = null;
  if (passwordWin && !passwordWin.isDestroyed()) passwordWin.close();
});

ipcMain.handle('has-password', () => {
  return hasPassword();
});

ipcMain.handle('change-password', (_, oldPwd, newPwd) => {
  return changePassword(oldPwd, newPwd);
});

// ── 窗口控制 IPC ──
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

// 看板日志 → 写入文件
ipcMain.on('board-log', (_, tag, msg) => logToFile('board:' + tag, msg));

// ── 教师管理 IPC ──
ipcMain.handle('get-teachers', () => ({
  approved: getApprovedTeachers(),
  pending: getPendingRequests(),
}));
ipcMain.handle('approve-teacher', (_, connectionId) => {
  const ok = approveTeacher(connectionId);
  if (ok) notifyManageTeachersChanged();
  return ok;
});
ipcMain.handle('reject-teacher', (_, connectionId) => {
  rejectTeacher(connectionId);
  notifyManageTeachersChanged();
  return true;
});
ipcMain.handle('update-teacher', (_, connectionId, data) => {
  const ok = updateTeacher(connectionId, data);
  if (ok) notifyManageTeachersChanged();
  return ok;
});
ipcMain.handle('remove-teacher', (_, connectionId) => {
  removeTeacher(connectionId);
  notifyManageTeachersChanged();
  return true;
});
ipcMain.handle('import-teacher', (_, connectionId, name, role, subjects) => {
  rejectTeacher(connectionId);
  const d = getDb();
  d.prepare('INSERT INTO approved_teachers (connection_id, name, role, subjects, approved_at) VALUES (?,?,?,?,?)')
    .run(connectionId, name, role, JSON.stringify(subjects || []), new Date().toISOString());
  notifyManageTeachersChanged();
  return true;
});

// 通知管理窗口：教师列表有变化
function notifyManageTeachersChanged() {
  if (manageWin && !manageWin.isDestroyed()) {
    manageWin.webContents.send('teachers-changed');
  }
}

// 数据变更时通知看板刷新 + 教师端同步
function notifyAllDataChanged(data) {
  if (boardWin && !boardWin.isDestroyed()) {
    logToFile('ipc', 'send data-changed → board');
    boardWin.webContents.send('data-changed');
  }
  // 广播同步给已认证的 WebSocket 客户端
  if (wss) {
    const t0 = Date.now();
    const d = data || loadData();
    broadcastSync(d);
    const t1 = Date.now();
    if (t1 - t0 > 30) logToFile('ws', `broadcastSync slow: ${t1 - t0}ms`);
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
  console.log(`  Password : ${hasPassword() ? 'set' : 'not set'}`);
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
  openManageWindow();
});
