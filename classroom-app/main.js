const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, protocol, safeStorage, clipboard, dialog } = require('electron');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { normalizeIncomingCall } = require('./call-message');
const { getLanInterfaces: selectLanInterfaces } = require('./lan-addresses');
const connectionCode = require('./connection-code');
const { enrollClassroom, revokeClassroom } = require('./cloud-config');
const { ClassroomCloudBridge, normalizeCloudConfig } = require('./cloud-bridge');
const { ClassroomMdnsAdvertiser } = require('./classroom-mdns');
const {
  createClassroomQrPayload,
  createWechatDirectLink,
  normalizeWechatDirectBaseUrl,
} = require('./classroom-qr');
let Database = null;
let QRCode = null;

ipcMain.handle('copy-text', (_event, value) => {
  clipboard.writeText(String(value == null ? '' : value));
  return { ok: true };
});
ipcMain.handle('show-client-error', async (event, payload) => {
  const report = String(payload && payload.report || '未提供错误详情');
  const owner = BrowserWindow.fromWebContents(event.sender);
  const options = {
    type: 'error',
    title: String(payload && payload.title || '教室端错误'),
    message: String(payload && payload.message || '教室端遇到问题，当前操作未能完成。'),
    detail: '请点击“复制错误信息”，并将复制的完整内容提交给系统管理员，以便快速定位问题。',
    buttons: ['关闭', '复制错误信息'],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  };
  const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
  if (result.response === 1) clipboard.writeText(report);
  return { ok:true, copied:result.response === 1 };
});

// 教室端是托盘常驻应用，必须保证同一用户会话只运行一个实例。
// 第二次启动时直接退出，并由已运行的实例接管唤醒窗口。
const HAS_SINGLE_INSTANCE_LOCK = app.requestSingleInstanceLock();
if (!HAS_SINGLE_INSTANCE_LOCK) {
  console.warn('[single-instance] another classroom app instance is already running');
  app.quit();
}

const APP_ICON_PATH = path.join(__dirname, 'icon.png');

app.commandLine.appendSwitch('disable-http-cache');
const zlib = require('zlib');
const { AdaptiveGalleryManager, LEGACY_EMBEDDING_MODEL } = require('./face-gallery');

// ═══════════════════════════════════════
//  C++ 原生人脸引擎（ONNX Runtime 加速）
// ═══════════════════════════════════════
let nativeFaceEngine = null;
let NATIVE_AVAILABLE = false;
let ACTIVE_EMBEDDING_MODEL = LEGACY_EMBEDDING_MODEL;
const SFACE_COSINE_THRESHOLD = 0.363;
// 与渲染进程的连续识别确认次数保持一致：单帧未识别可能只是姿态、光照或模型确认延迟，
// 不应立即进入班主任待匹配库。
const PENDING_FACE_CONFIRM_COUNT = 2;
const CI_SMOKE_TEST = process.argv.includes('--ci-smoke-test');

function getDatabaseConstructor() {
  if (!Database) Database = require('better-sqlite3');
  return Database;
}

function logCISmokeStage(message) {
  if (!CI_SMOKE_TEST) return;
  console.log(`[smoke-stage] ${message}`);
  try {
    const smokeLogPath = process.env.CLASSROOM_SMOKE_LOG || path.join(os.tmpdir(), 'classroom-smoke.log');
    fs.appendFileSync(smokeLogPath, `${message}\n`, 'utf8');
  } catch (_) {}
}

function getNativeAddonPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'native', 'face_native_addon.node');
  }
  return path.join(__dirname, 'native', 'build', 'Release', 'face_native_addon.node');
}

function loadNativeFaceEngine() {
  try {
    const addonPath = getNativeAddonPath();
    if (!fs.existsSync(addonPath)) {
      logToFile('native', `Addon not found at ${addonPath}, using face-api.js fallback`);
      return;
    }
    logCISmokeStage(`requiring native addon: ${addonPath}`);
    nativeFaceEngine = require(addonPath);
    logCISmokeStage('native addon required; checking model directory');
    const modelDir = app.isPackaged
      ? path.join(process.resourcesPath, 'models', 'onnx')
      : path.join(__dirname, 'models', 'onnx');
    if (!fs.existsSync(modelDir)) {
      logToFile('native', 'ONNX model directory not found, using face-api.js fallback');
      nativeFaceEngine = null;
      return;
    }
    logCISmokeStage(`model directory ready; initializing ONNX: ${modelDir}`);
    const status = nativeFaceEngine.init(modelDir, { threads: 2 });
    logCISmokeStage('native init returned');
    if (status && status.success) {
      NATIVE_AVAILABLE = true;
      const engineStatus = nativeFaceEngine.getStatus();
      ACTIVE_EMBEDDING_MODEL = engineStatus.embeddingModel;
      logToFile('native', `ONNX Runtime face engine loaded successfully (${ACTIVE_EMBEDDING_MODEL})`);
    } else {
      logToFile('native', 'Native engine init failed, using face-api.js fallback');
      nativeFaceEngine = null;
    }
  } catch (e) {
    NATIVE_AVAILABLE = false;
    nativeFaceEngine = null;
    logToFile('native', `Addon load failed: ${e.message} — using face-api.js fallback`);
  }
}

async function runCISmokeTest() {
  let smokeDb = null;
  let smokeWindow = null;
  let exitCode = 0;
  try {
    logCISmokeStage('electron ready; starting renderer check');
    if (!app.isPackaged) throw new Error('smoke test must run from a packaged application');
    smokeWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await smokeWindow.loadFile('renderer/onboarding/onboarding.html');
    const title = await smokeWindow.webContents.executeJavaScript('document.title');
    if (!title.includes('绑定班主任')) throw new Error(`unexpected renderer title: ${title}`);
    logCISmokeStage('renderer loaded; loading better-sqlite3');
    const DatabaseConstructor = getDatabaseConstructor();
    smokeDb = new DatabaseConstructor(':memory:');
    smokeDb.exec('CREATE TABLE smoke_test (value TEXT NOT NULL)');
    smokeDb.prepare('INSERT INTO smoke_test VALUES (?)').run('ok');
    if (smokeDb.prepare('SELECT value FROM smoke_test').pluck().get() !== 'ok') {
      throw new Error('better-sqlite3 read/write verification failed');
    }
    logCISmokeStage('better-sqlite3 ready; loading native face engine');
    loadNativeFaceEngine();
    if (!NATIVE_AVAILABLE || !nativeFaceEngine) {
      throw new Error('packaged native face engine failed to initialize');
    }
    const status = nativeFaceEngine.getStatus();
    if (!status || status.loaded !== true || !status.embeddingModel) {
      throw new Error('native face engine returned an invalid status');
    }
    logCISmokeStage('native face engine ready; smoke test passed');
    console.log(`[smoke] classroom package ready (${status.embeddingModel})`);
  } catch (error) {
    console.error(`[smoke] classroom package failed: ${error.stack || error.message}`);
    exitCode = 1;
  } finally {
    if (smokeWindow && !smokeWindow.isDestroyed()) smokeWindow.destroy();
    if (smokeDb) smokeDb.close();
    if (nativeFaceEngine) {
      try { nativeFaceEngine.destroy(); } catch (_) {}
    }
  }
  app.exit(exitCode);
}

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
let onboardingWin = null;
let connectionQrWin = null;
let cloudSettingsWin = null;
let popupWin = null;
let boardWin = null;
let homeworkWidgetWin = null;
let homeworkFloatWin = null;
let faceCheckWin = null;
let faceRegisterWin = null;
let wss = null;
let heartbeatTimer = null;
const classroomMdns = new ClassroomMdnsAdvertiser({ logger:message => logToFile('mdns', message) });
const callMap = new Map();
const callQueue = [];
let isPopupBusy = false;
let db = null;
let cloudBridge = null;
const cloudBridgeSecret = crypto.randomBytes(32).toString('base64url');

function getCloudConfig() {
  try {
    const raw = getDb().prepare("SELECT value FROM meta WHERE key='cloudConfig'").get()?.value;
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (stored.deviceTokenEncrypted) {
      if (!safeStorage.isEncryptionAvailable()) return null;
      stored.deviceToken = safeStorage.decryptString(Buffer.from(stored.deviceTokenEncrypted, 'base64'));
      delete stored.deviceTokenEncrypted;
    }
    return normalizeCloudConfig(stored);
  } catch (_error) { return null; }
}

function serializeCloudConfig(config) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全存储不可用，无法保存云服务设备凭证');
  }
  const { deviceToken, ...publicConfig } = config;
  return JSON.stringify({ ...publicConfig, deviceTokenEncrypted:safeStorage.encryptString(deviceToken).toString('base64') });
}

function applyCloudRestore(snapshot) {
  if (!snapshot || snapshot.type !== 'cloud.restore' || !Array.isArray(snapshot.students) || !Array.isArray(snapshot.assignments)) return false;
  const data = loadData();
  const students = snapshot.students.slice(0, 5000).map(item => ({ id:String(item && item.id || '').trim().slice(0,128), name:String(item && item.name || '').trim().slice(0,80) })).filter(item => item.id && item.name);
  const studentIds = new Set(students.map(item => item.id));
  const assignments = snapshot.assignments.slice(0, 5000).map(item => {
    const submissions = item && item.submissions && typeof item.submissions === 'object' ? { ...item.submissions } : {};
    Object.keys(submissions).forEach(id => { if (!studentIds.has(id)) delete submissions[id]; });
    students.forEach(student => { if (!submissions[student.id]) submissions[student.id] = '未提交'; });
    return { id:String(item && item.id || '').trim().slice(0,128), subject:String(item && item.subject || '').trim().slice(0,80), type:item && item.type === 'notice' ? 'notice' : 'homework', title:String(item && item.title || '').trim().slice(0,1000), date:String(item && item.date || '').slice(0,10), deadline:item && item.deadline || null, source:item && item.source === 'student' ? 'student' : 'teacher', submissions:item && item.type === 'notice' ? {} : submissions };
  }).filter(item => item.id && item.title);
  data.className = String(snapshot.className || data.className || '').trim().slice(0,120);
  data.students = students;
  data.assignments = assignments;
  data.subjects = Array.from(new Set(assignments.map(item => item.subject).filter(Boolean)));
  if (snapshot.classroomConfigured !== false && data.className && students.length) getDb().prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('classroomConfigured','true')").run();
  saveData(data);
  broadcastSync(data);
  return true;
}

function applyCloudClassroomUpdate(message) {
  if (!message || message.type !== 'cloud.classroom-update') return false;
  const name = String(message.name || '').trim().slice(0, 120);
  if (!name) return false;
  getDb().prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('className',?)").run(name);
  broadcastSync(loadData());
  return true;
}

function restartCloudBridge() {
  if (cloudBridge) cloudBridge.stop();
  cloudBridge = null;
  const config = getCloudConfig();
  if (!config || !wss) { rebuildTrayMenu(); return; }
  cloudBridge = new ClassroomCloudBridge(config, {
    logger:message => logToFile('cloud', message),
    statusProvider:() => ({ lanConnectionCode:getConnectionCodes()[0] || '' }),
    snapshotProvider:buildCloudSnapshot,
    membershipHandler:applyCloudMembership,
    classroomHandler:applyCloudClassroomUpdate,
    localBridgeSecret:cloudBridgeSecret,
    restoreHandler:applyCloudRestore,
  });
  cloudBridge.start();
  rebuildTrayMenu();
}

function focusClassroomWindow() {
  const target = [
    onboardingWin,
    connectionQrWin,
    cloudSettingsWin,
    boardWin,
    homeworkWidgetWin,
    popupWin,
    faceRegisterWin,
  ].find(win => win && !win.isDestroyed() && win.isVisible());
  if (target) {
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
    return;
  }
  if (isSystemReady()) openBoardWindow();
  else if (!isHomeroomBound()) createOnboardingWindow();
  else createConnectionQrWindow();
}

if (HAS_SINGLE_INSTANCE_LOCK) {
  app.on('second-instance', () => {
    // app.focus() 只在部分平台有效，窗口自身的 show/focus 作为统一兜底。
    try { app.focus({ steal: true }); } catch (_) {}
    focusClassroomWindow();
  });
}

// ═══════════════════════════════════════
//  SQLite 数据库
// ═══════════════════════════════════════

function getDb() {
  if (db) return db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const DatabaseConstructor = getDatabaseConstructor();
  db = new DatabaseConstructor(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS subjects (name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS assignments (id TEXT PRIMARY KEY, subject TEXT, title TEXT, date TEXT);
    CREATE TABLE IF NOT EXISTS submissions (assignment_id TEXT, student_id TEXT, status TEXT DEFAULT '未提交', PRIMARY KEY (assignment_id, student_id));
    CREATE TABLE IF NOT EXISTS pending_faces (id TEXT PRIMARY KEY, crop_base64 TEXT, descriptor TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS approved_teachers (connection_id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, subjects TEXT DEFAULT '[]', approved_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pending_requests (connection_id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, subjects TEXT DEFAULT '[]', requested_at TEXT NOT NULL);
  `);
  // deadline 是作业从“展示”自动进入“提交统计”的时间。旧数据库按需平滑迁移。
  const assignmentColumns = db.prepare('PRAGMA table_info(assignments)').all().map(row => row.name);
  if (!assignmentColumns.includes('deadline')) db.exec('ALTER TABLE assignments ADD COLUMN deadline TEXT');
  if (!assignmentColumns.includes('type')) db.exec("ALTER TABLE assignments ADD COLUMN type TEXT DEFAULT 'homework'");
  if (!assignmentColumns.includes('source')) db.exec("ALTER TABLE assignments ADD COLUMN source TEXT DEFAULT 'teacher'");
  // attendance 表的创建/迁移交由 migrateAttendanceSchema 统一处理：
  // 注意不能在这里用 `CREATE TABLE IF NOT EXISTS attendance(...day...)`，
  // 因为旧库的 attendance 表已存在且无 day 列，SQLite 校验新 DDL 引用的 day 列会报
  // "no such column: day"，导致整个 getDb() 抛错、WS 服务无法启动、教师端连不上。
  migrateAttendanceSchema();
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

/**
 * 迁移旧考勤表结构：把每帧一行的历史表压缩成按 (student_id, day) 唯一的新表。
 * 旧表主键 (student_id, detected_at) 会无限增长；新表每人每天只保留最新一条。
 */
function migrateAttendanceSchema() {
  const d = db;
  const NEW_DDL = `
    CREATE TABLE attendance (
      student_id TEXT NOT NULL,
      status TEXT DEFAULT 'absent',
      detected_at TEXT NOT NULL,
      similarity REAL,
      day TEXT NOT NULL,
      PRIMARY KEY (student_id, day)
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_day ON attendance(day);
  `;

  try {
    const cols = d.prepare("PRAGMA table_info(attendance)").all();

    if (cols.length === 0) {
      // 情况 1：全新库，attendance 表不存在 → 直接建新结构
      d.exec(NEW_DDL);
      console.log('[db] attendance table created (new schema)');
      return;
    }

    const hasDay = cols.some(c => c.name === 'day');
    if (hasDay) {
      // 情况 2：已是新结构 → 确保索引存在即可
      d.exec('CREATE INDEX IF NOT EXISTS idx_attendance_day ON attendance(day)');
      return;
    }

    // 情况 3：旧结构（主键 student_id+detected_at，无 day 列）→ 迁移
    console.log('[db] migrating attendance table to (student_id, day) schema');
    d.exec('ALTER TABLE attendance RENAME TO attendance_old');
    d.exec(NEW_DDL);
    d.exec(`
      INSERT OR REPLACE INTO attendance (student_id, status, detected_at, similarity, day)
      SELECT student_id, status, detected_at, similarity,
             substr(detected_at, 1, 10) AS day
      FROM attendance_old o
      WHERE detected_at = (
        SELECT MAX(detected_at) FROM attendance_old o2
        WHERE o2.student_id = o.student_id
          AND substr(o2.detected_at, 1, 10) = substr(o.detected_at, 1, 10)
      );
    `);
    d.exec('DROP TABLE attendance_old');
    const n = d.prepare('SELECT COUNT(*) AS n FROM attendance').get().n;
    console.log(`[db] attendance migration done, ${n} rows kept`);
  } catch (e) {
    console.error('[db] attendance migration failed:', e.message);
  }
}

/**
 * 本地时区的"当天"键，格式 YYYY-MM-DD。
 * 解决旧实现用 toISOString().slice(0,10)（UTC 日期）导致的日界漏判。
 */
function localDayKey(date) {
  const d = date instanceof Date ? date : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function loadData() {
  const t0 = Date.now();
  const d = getDb();
  const className = d.prepare("SELECT value FROM meta WHERE key='className'").get()?.value || '';
  const students = d.prepare('SELECT id, name FROM students ORDER BY rowid').all();
  const subjects = getDerivedSubjects();
  const assignments = d.prepare("SELECT id, subject, title, date, deadline, COALESCE(type, 'homework') AS type, COALESCE(source, 'teacher') AS source FROM assignments ORDER BY date").all();
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
    // 学科由班主任和已批准任课教师的授课科目派生，旧 subjects 表不再写入。
    // assignments + submissions
    d.prepare('DELETE FROM assignments').run();
    d.prepare('DELETE FROM submissions').run();
    for (const a of (data.assignments || [])) {
      const type = a.type === 'notice' ? 'notice' : 'homework';
      const source = a.source === 'student' ? 'student' : 'teacher';
      d.prepare('INSERT INTO assignments (id, subject, title, date, deadline, type, source) VALUES (?,?,?,?,?,?,?)').run(a.id, a.subject, a.title, a.date, a.deadline || null, type, source);
      for (const [sid, status] of Object.entries(type === 'homework' ? (a.submissions || {}) : {})) {
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
//  教师账号管理
// ═══════════════════════════════════════

function getApprovedTeachers() {
  const d = getDb();
  return d.prepare('SELECT * FROM approved_teachers ORDER BY approved_at').all().map(r => ({
    connection_id: r.connection_id, name: r.name, role: r.role,
    subjects: JSON.parse(r.subjects || '[]'), approved_at: r.approved_at,
  }));
}

function getHomeroomTeacher() {
  const row = getDb().prepare("SELECT * FROM approved_teachers WHERE role='班主任' ORDER BY approved_at LIMIT 1").get();
  if (!row) return null;
  return {
    connection_id: row.connection_id,
    name: row.name,
    role: row.role,
    subjects: JSON.parse(row.subjects || '[]'),
    approved_at: row.approved_at,
  };
}

function isHomeroomBound() {
  return !!getHomeroomTeacher();
}

function isClassroomConfigured() {
  const d = getDb();
  const saved = d.prepare("SELECT value FROM meta WHERE key='classroomConfigured'").get();
  if (saved) return saved.value === 'true';
  // 兼容升级前已经完成班级资料配置的安装。
  const className = d.prepare("SELECT value FROM meta WHERE key='className'").get()?.value || '';
  const studentCount = d.prepare('SELECT COUNT(*) AS count FROM students').get().count;
  const configured = !!className.trim() && studentCount > 0;
  if (configured) d.prepare("INSERT OR REPLACE INTO meta VALUES ('classroomConfigured', 'true')").run();
  return configured;
}

function isSystemReady() {
  return isHomeroomBound() && isClassroomConfigured();
}

function getSavedNetworkInterface() {
  return getDb().prepare("SELECT value FROM meta WHERE key='networkInterface'").get()?.value || '';
}

function getNetworkInterfaceStatus() {
  const interfaces = selectLanInterfaces(os.networkInterfaces());
  const preferredName = getSavedNetworkInterface();
  const selected = preferredName
    ? interfaces.find(item => item.name === preferredName) || null
    : interfaces[0] || null;
  return {
    interfaces,
    mode: preferredName ? 'manual' : 'auto',
    preferredName,
    selected,
    unavailable: !!preferredName && !selected,
  };
}

function setNetworkInterface(name) {
  const requested = String(name || '').trim().slice(0, 120);
  const status = getNetworkInterfaceStatus();
  if (requested && !status.interfaces.some(item => item.name === requested)) {
    return { success:false, message:'选择的网卡当前不可用，请刷新后重新选择', ...status };
  }
  if (requested) getDb().prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('networkInterface', ?)").run(requested);
  else getDb().prepare("DELETE FROM meta WHERE key='networkInterface'").run();
  rebuildTrayMenu();
  [onboardingWin, connectionQrWin].forEach(win => {
    if (win && !win.isDestroyed()) win.webContents.send('network-interface-changed');
  });
  restartMdnsAdvertisement();
  return { success:true, ...getNetworkInterfaceStatus() };
}

function getLanAddresses() {
  const selected = getNetworkInterfaceStatus().selected;
  return selected ? [selected.address] : [];
}

function getConnectionCodes() {
  return getLanAddresses().map(address => {
    try { return connectionCode.encode(address); } catch (_error) { return null; }
  }).filter(Boolean);
}

function restartMdnsAdvertisement() {
  classroomMdns.stop();
  const selected = getNetworkInterfaceStatus().selected;
  const code = getConnectionCodes()[0];
  if (!selected || !code || !wss) return;
  const className = getDb().prepare("SELECT value FROM meta WHERE key='className'").get()?.value || '本教室';
  classroomMdns.start({ address:selected.address, connectionCode:code, port:WS_PORT, className });
}

async function getClassroomQrData() {
  const network = getNetworkInterfaceStatus();
  if (network.unavailable) return { success:false, message:`此前选择的网卡“${network.preferredName}”当前不可用，请重新选择网卡`, network };
  const connectionCodes = getConnectionCodes();
  if (!connectionCodes.length) return { success: false, message: '未检测到可用的局域网连接', network };
  const className = getDb().prepare("SELECT value FROM meta WHERE key='className'").get()?.value || '本教室';
  const wechatDirectBaseUrl = getDb().prepare("SELECT value FROM meta WHERE key='wechatDirectBaseUrl'").get()?.value || '';
  const connectionCodeValue = connectionCodes[0];
  if (!QRCode) QRCode = require('qrcode');
  const payload = wechatDirectBaseUrl
    ? createWechatDirectLink(wechatDirectBaseUrl, className, connectionCodeValue)
    : createClassroomQrPayload(className, connectionCodeValue);
  const qrDataUrl = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', width: 360, margin: 2 });
  return {
    success: true,
    name: className || '本教室',
    connectionCode: connectionCodeValue,
    qrDataUrl,
    qrMode: wechatDirectBaseUrl ? 'wechat-direct' : 'mini-program-scan',
    wechatDirectBaseUrl,
    network,
  };
}

function getWechatDirectLinkSettings() {
  const baseUrl = getDb().prepare("SELECT value FROM meta WHERE key='wechatDirectBaseUrl'").get()?.value || '';
  return { enabled: !!baseUrl, baseUrl };
}

function setWechatDirectLinkSettings(baseUrl) {
  let normalized = '';
  try { normalized = normalizeWechatDirectBaseUrl(baseUrl); }
  catch (error) { return { success:false, message:error.message, ...getWechatDirectLinkSettings() }; }
  if (normalized) getDb().prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('wechatDirectBaseUrl', ?)").run(normalized);
  else getDb().prepare("DELETE FROM meta WHERE key='wechatDirectBaseUrl'").run();
  return { success:true, ...getWechatDirectLinkSettings() };
}

function getOnboardingStatus() {
  const homeroom = getHomeroomTeacher();
  const candidates = new Map();
  getPendingRequests().forEach(teacher => candidates.set(teacher.connection_id, { ...teacher, source: 'pending' }));
  getApprovedTeachers().filter(teacher => teacher.role !== '班主任').forEach(teacher => {
    if (!candidates.has(teacher.connection_id)) candidates.set(teacher.connection_id, { ...teacher, source: 'approved' });
  });
  const className = getDb().prepare("SELECT value FROM meta WHERE key='className'").get()?.value || '';
  return { bound: !!homeroom, configured: isClassroomConfigured(), homeroom, candidates: Array.from(candidates.values()), className, connectionCodes: getConnectionCodes(), network:getNetworkInterfaceStatus() };
}

function bindHomeroomTeacher(connectionId) {
  const id = String(connectionId || '').trim();
  if (!id) return { success: false, message: '请选择需要绑定的班主任账户' };
  const existingHomeroom = getHomeroomTeacher();
  if (existingHomeroom) {
    return { success: true, teacher: existingHomeroom };
  }
  const d = getDb();
  const pending = d.prepare('SELECT * FROM pending_requests WHERE connection_id=?').get(id);
  const approved = d.prepare('SELECT * FROM approved_teachers WHERE connection_id=?').get(id);
  const teacher = pending || approved;
  if (!teacher) return { success: false, message: '该教师请求已失效，请让班主任重新连接' };
  let teacherSubjects = [];
  try { teacherSubjects = JSON.parse(teacher.subjects || '[]'); } catch (_error) {}
  teacherSubjects = normalizeSubjects(teacherSubjects);
  if (!teacherSubjects.length) return { success: false, message: '请让该教师重新连接并先选择授课科目，再绑定为班主任' };
  const now = new Date().toISOString();
  d.transaction(() => {
    d.prepare("INSERT OR REPLACE INTO meta VALUES ('classroomConfigured', 'false')").run();
    d.prepare('DELETE FROM pending_requests WHERE connection_id=?').run(id);
    d.prepare('DELETE FROM approved_teachers WHERE connection_id=?').run(id);
    d.prepare('INSERT INTO approved_teachers (connection_id, name, role, subjects, approved_at) VALUES (?,?,?,?,?)')
      .run(id, teacher.name, '班主任', JSON.stringify(teacherSubjects), now);
  })();
  notifyTeacherCandidatesChanged();
  notifyOnboardingChanged();
  refreshTeacherConnections(id, false);
  broadcastSync(loadData());
  rebuildTrayMenu();
  return { success: true, teacher: getHomeroomTeacher() };
}

function normalizeSubjects(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map(value => String(value).trim().slice(0, 30))
    .filter(Boolean))).slice(0, 20);
}

function getDerivedSubjects() {
  return Array.from(new Set(getApprovedTeachers()
    .flatMap(teacher => teacher.subjects || [])
    .map(subject => String(subject).trim()).filter(Boolean))).sort();
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

function rejectTeacher(connectionId) {
  getDb().prepare('DELETE FROM pending_requests WHERE connection_id=?').run(connectionId);
}

function removeTeacher(connectionId) {
  getDb().prepare('DELETE FROM approved_teachers WHERE connection_id=?').run(connectionId);
}

function removeTeacherMembership(connectionId) {
  const id = String(connectionId || '').trim();
  if (!id) return { removed: false, role: '' };
  const existing = findTeacher(id);
  getDb().transaction(() => {
    getDb().prepare('DELETE FROM pending_requests WHERE connection_id=?').run(id);
    getDb().prepare('DELETE FROM approved_teachers WHERE connection_id=?').run(id);
  })();
  return { removed: existing.found, role: existing.role || '' };
}

function applyCloudMembership(message) {
  const member = message && message.member && typeof message.member === 'object' ? message.member : {};
  const connectionId = String(member.connectionId || '').trim();
  if (!connectionId) return false;
  const d = getDb();
  if (message.action === 'remove' || member.status === 'rejected') {
    removeTeacherMembership(connectionId);
    refreshTeacherConnections(connectionId, false, true);
  } else {
    const name = String(member.name || '云端教师').trim().slice(0, 40);
    const subjects = normalizeSubjects(member.subjects);
    const role = member.role === 'homeroom' ? '班主任' : '授课教师';
    const now = new Date().toISOString();
    d.transaction(() => {
      d.prepare('DELETE FROM pending_requests WHERE connection_id=?').run(connectionId);
      if (member.status === 'pending') {
        d.prepare('DELETE FROM approved_teachers WHERE connection_id=?').run(connectionId);
        d.prepare('INSERT OR REPLACE INTO pending_requests (connection_id,name,role,subjects,requested_at) VALUES (?,?,?,?,?)').run(connectionId, name, role, JSON.stringify(subjects), now);
        refreshTeacherConnections(connectionId, true, false, true);
      } else {
        if (role === '班主任') d.prepare("UPDATE approved_teachers SET role='授课教师' WHERE role='班主任' AND connection_id<>?").run(connectionId);
        d.prepare('INSERT OR REPLACE INTO approved_teachers (connection_id,name,role,subjects,approved_at) VALUES (?,?,?,?,?)').run(connectionId, name, role, JSON.stringify(subjects), now);
        refreshTeacherConnections(connectionId, false);
      }
    })();
  }
  notifyTeacherCandidatesChanged();
  notifyOnboardingChanged();
  broadcastSync(loadData());
  rebuildTrayMenu();
  return true;
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

function getAppIcon() {
  const icon = nativeImage.createFromPath(APP_ICON_PATH);
  // Keep the embedded icon as a safe fallback if a copied or packaged asset is missing.
  return icon.isEmpty() ? nativeImage.createFromBuffer(createTrayIconPNG()) : icon;
}

function getTrayIcon() {
  // 托盘需要使用系统状态栏的逻辑尺寸；直接传入 256px 应用图标会在部分平台显得过大。
  const size = process.platform === 'win32' ? 16 : process.platform === 'darwin' ? 18 : 22;
  return getAppIcon().resize({ width: size, height: size });
}

// ═══════════════════════════════════════
//  托盘
// ═══════════════════════════════════════

function createTray() {
  const icon = getTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('班达-教室端 - 运行中');

  rebuildTrayMenu();
  tray.on('double-click', () => {
    if (isSystemReady()) openBoardWindow();
    else if (!isHomeroomBound()) createOnboardingWindow();
    else createConnectionQrWindow();
  });
}

function rebuildTrayMenu() {
  const autoLaunch = app.getLoginItemSettings().openAtLogin;
  const codes = getConnectionCodes();
  const network = getNetworkInterfaceStatus();
  const connectionCodeItem = { label: codes.length ? `连接码 ${codes.join(' / ')}` : '暂无可用连接码', enabled: false };
  const cloudConfig = getCloudConfig();
  const cloudServiceItem = { label:cloudConfig ? '云服务设置（已连接）' : '云服务设置', click:() => createCloudSettingsWindow() };
  const networkInterfaceItem = {
    label: network.selected ? `网卡 ${network.selected.name} · ${network.selected.address}` : '选择连接网卡',
    submenu: [
      { label:'自动选择（推荐）', type:'radio', checked:network.mode === 'auto', click:() => setNetworkInterface('') },
      ...network.interfaces.map(item => ({
        label:`${item.name} · ${item.address}${item.isVirtual ? ' · 虚拟网卡' : ''}`,
        type:'radio', checked:network.mode === 'manual' && network.preferredName === item.name,
        click:() => setNetworkInterface(item.name),
      })),
    ],
  };
  if (!isHomeroomBound()) {
    const menu = Menu.buildFromTemplate([
      connectionCodeItem,
      networkInterfaceItem,
      { label: '显示教室连接二维码', click: () => createConnectionQrWindow() },
      cloudServiceItem,
      { type: 'separator' },
      { label: '完成班主任绑定', click: () => createOnboardingWindow() },
      { label: (autoLaunch ? '✓ ' : '') + '开机自启', click: () => {
        const current = app.getLoginItemSettings().openAtLogin;
        app.setLoginItemSettings({ openAtLogin: !current });
        rebuildTrayMenu();
      } },
      { type: 'separator' },
      { label: '退出教室端', click: () => { if (wss) wss.close(); app.quit(); } },
    ]);
    tray.setToolTip('班达-教室端 - 等待绑定班主任');
    tray.setContextMenu(menu);
    return;
  }
  if (!isClassroomConfigured()) {
    const menu = Menu.buildFromTemplate([
      connectionCodeItem,
      networkInterfaceItem,
      { label: '显示教室连接二维码', click: () => createConnectionQrWindow() },
      cloudServiceItem,
      { type: 'separator' },
      { label: '等待班主任完成教室配置', enabled: false },
      { label: '班主任已绑定 · 等待教师端完成配置', enabled: false },
      { label: (autoLaunch ? '✓ ' : '') + '开机自启', click: () => {
        const current = app.getLoginItemSettings().openAtLogin;
        app.setLoginItemSettings({ openAtLogin: !current });
        rebuildTrayMenu();
      } },
      { type: 'separator' },
      { label: '退出教室端', click: () => { if (wss) wss.close(); app.quit(); } },
    ]);
    tray.setToolTip('班达-教室端 - 等待班主任配置教室');
    tray.setContextMenu(menu);
    return;
  }
  const faceEnabled = getFaceCheckEnabled();
  const menu = Menu.buildFromTemplate([
    connectionCodeItem,
    networkInterfaceItem,
    { label: '显示教室连接二维码', click: () => createConnectionQrWindow() },
    cloudServiceItem,
    { type: 'separator' },
    { label: '打开作业看板', click: () => openBoardWindow() },
    { label: '录入学生人脸', click: () => createFaceRegisterWindow() },
    { type: 'separator' },
    { label: (faceEnabled ? '✓ ' : '') + '启用人脸签到',
      click: () => {
        setFaceCheckEnabled(!getFaceCheckEnabled());
      }
    },
    { label: (autoLaunch ? '✓ ' : '') + '开机自启',
      click: () => {
        const current = app.getLoginItemSettings().openAtLogin;
        app.setLoginItemSettings({ openAtLogin: !current });
        rebuildTrayMenu();
      }
    },
    { type: 'separator' },
    { label: '退出教室端', click: () => { if (wss) wss.close(); app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

// ═══════════════════════════════════════
//  首次安装：班主任绑定引导
// ═══════════════════════════════════════

function createOnboardingWindow() {
  // 教室端只负责首次班主任绑定。绑定完成后的教师审核必须由班主任客户端处理，
  // 即使存在待审核教师，也不能重新打开教室端绑定窗口。
  if (isHomeroomBound()) {
    if (isSystemReady()) openBoardWindow();
    return;
  }
  if (onboardingWin && !onboardingWin.isDestroyed()) {
    onboardingWin.show(); onboardingWin.focus(); return;
  }
  onboardingWin = new BrowserWindow({
    width: 820,
    height: 720,
    minWidth: 680,
    minHeight: 580,
    title: '首次设置 — 绑定班主任',
    icon: APP_ICON_PATH,
    backgroundColor: '#F4F7FC',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  onboardingWin.loadFile('renderer/onboarding/onboarding.html');
  onboardingWin.on('closed', () => { onboardingWin = null; });
}

function createConnectionQrWindow() {
  if (connectionQrWin && !connectionQrWin.isDestroyed()) {
    connectionQrWin.show(); connectionQrWin.focus(); return;
  }
  connectionQrWin = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 420,
    minHeight: 660,
    title: '教室连接二维码',
    icon: APP_ICON_PATH,
    backgroundColor: '#F4F7FC',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  connectionQrWin.loadFile('renderer/connection/connection-qr.html');
  connectionQrWin.on('closed', () => { connectionQrWin = null; });
}

function createCloudSettingsWindow() {
  if (cloudSettingsWin && !cloudSettingsWin.isDestroyed()) {
    cloudSettingsWin.show(); cloudSettingsWin.focus(); return;
  }
  cloudSettingsWin = new BrowserWindow({
    width:680, height:650, minWidth:560, minHeight:560,
    title:'云服务设置', icon:APP_ICON_PATH, backgroundColor:'#F4F6FA',
    webPreferences:{ preload:path.join(__dirname, 'preload.js'), contextIsolation:true, nodeIntegration:false },
  });
  cloudSettingsWin.loadFile('renderer/cloud-settings/cloud-settings.html');
  cloudSettingsWin.on('closed', () => { cloudSettingsWin = null; });
}

function activateBoundRuntime(openBoard = true) {
  if (!isSystemReady()) return false;
  if (onboardingWin && !onboardingWin.isDestroyed()) onboardingWin.close();
  createHomeworkFloatWindow();
  if (getFaceCheckEnabled()) createFaceCheckWindow();
  rebuildTrayMenu();
  if (openBoard) openBoardWindow();
  return true;
}

function deactivateBoundRuntimeForRebinding() {
  callQueue.length = 0;
  callMap.clear();
  [popupWin, boardWin, homeworkFloatWin, faceCheckWin, faceRegisterWin].forEach(win => {
    if (win && !win.isDestroyed()) win.close();
  });
  if (homeworkWidgetWin && !homeworkWidgetWin.isDestroyed()) homeworkWidgetWin.hide();
  createOnboardingWindow();
  rebuildTrayMenu();
}

function finishBindingStage() {
  if (!isHomeroomBound()) return false;
  if (onboardingWin && !onboardingWin.isDestroyed()) onboardingWin.close();
  rebuildTrayMenu();
  return true;
}

function openBoardWindow() {
  if (!isSystemReady()) { createOnboardingWindow(); return; }
  createBoardWindow();
}

function setHomeworkFloatExpanded(expanded) {
  if (!homeworkFloatWin || homeworkFloatWin.isDestroyed()) return;
  const bounds = homeworkFloatWin.getBounds();
  const compact = 76;
  const expandedSize = 210;
  // 主球在两种窗口中都贴右下角（各留 4px）；扩展时向左上补足差值，主球视觉坐标不变。
  const offset = expandedSize - compact;
  homeworkFloatWin.setBounds(expanded
    ? { x: Math.max(0, bounds.x - offset), y: Math.max(0, bounds.y - offset), width: expandedSize, height: expandedSize }
    : { x: bounds.x + offset, y: bounds.y + offset, width: compact, height: compact });
}

function getHomeworkUnread() {
  const row = getDb().prepare("SELECT value FROM meta WHERE key='homeworkUnread'").get();
  return !!row && row.value === 'true';
}

function setHomeworkUnread(unread) {
  const value = unread ? 'true' : 'false';
  getDb().prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('homeworkUnread', ?)").run(value);
  if (homeworkFloatWin && !homeworkFloatWin.isDestroyed()) {
    homeworkFloatWin.webContents.send('homework-unread-changed', !!unread);
  }
}

// 学生从悬浮球进入查看用的桌面作业组件；课代表上报仍使用完整作业看板。
function createHomeworkFloatWindow() {
  if (!isSystemReady()) return;
  if (homeworkFloatWin && !homeworkFloatWin.isDestroyed()) return;
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const size = 76;
  homeworkFloatWin = new BrowserWindow({
    width: size, height: size,
    x: Math.max(12, sw - size - 22), y: Math.max(12, Math.round(sh * 0.62)),
    frame: false, transparent: true, resizable: false, movable: true,
    icon: APP_ICON_PATH,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  homeworkFloatWin.setAlwaysOnTop(true, 'floating');
  homeworkFloatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  homeworkFloatWin.loadFile('renderer/homework/homework-float.html');
  homeworkFloatWin.webContents.on('did-finish-load', () => {
    if (homeworkFloatWin && !homeworkFloatWin.isDestroyed()) {
      homeworkFloatWin.webContents.send('homework-unread-changed', getHomeworkUnread());
    }
  });
  homeworkFloatWin.on('closed', () => { homeworkFloatWin = null; });
}

function openHomeworkWidget() {
  if (!isSystemReady()) { createOnboardingWindow(); return; }
  setHomeworkUnread(false);
  if (homeworkWidgetWin && !homeworkWidgetWin.isDestroyed()) {
    homeworkWidgetWin.show(); homeworkWidgetWin.focus(); return;
  }
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(440, Math.max(360, sw - 32));
  const height = Math.min(570, Math.max(440, sh - 80));
  homeworkWidgetWin = new BrowserWindow({
    width, height, minWidth: 360, minHeight: 440,
    x: Math.max(12, sw - width - 28), y: Math.max(12, Math.round((sh - height) / 2)),
    frame: false, resizable: true, movable: true, alwaysOnTop: false, backgroundColor: '#F7F9FD', title: '今日安排',
    icon: APP_ICON_PATH,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  homeworkWidgetWin.loadFile('renderer/homework/homework-widget.html');
  homeworkWidgetWin.on('close', (event) => {
    if (!app.isQuitting) { event.preventDefault(); homeworkWidgetWin.hide(); }
  });
  homeworkWidgetWin.on('closed', () => { homeworkWidgetWin = null; });
}

function hideHomeworkWidget() {
  if (homeworkWidgetWin && !homeworkWidgetWin.isDestroyed()) homeworkWidgetWin.hide();
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
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  popupWin.loadFile('renderer/popup/popup.html');

  popupWin.webContents.on('did-finish-load', () => {
    // 弹窗就绪 → 从队列取一个呼叫推送过去
    if (callQueue.length > 0) {
      const { call } = callQueue.shift();
      popupWin.webContents.send('show-call', {
        callId:      call.callId,
        studentName: call.studentName,
        studentNames: call.studentNames || [call.studentName],
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
  if (!isSystemReady()) return;
  callMap.set(call.callId, ws);
  callQueue.push({ call, ws });
  if (!isPopupBusy && !popupWin) createPopupWindow();
}

// ═══════════════════════════════════════
//  作业看板（标准窗口，常驻桌面）
// ═══════════════════════════════════════

function createBoardWindow() {
  if (!isSystemReady()) { createOnboardingWindow(); return; }
  if (boardWin && !boardWin.isDestroyed()) { boardWin.focus(); return; }
  logToFile('board', 'createBoardWindow start');
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  boardWin = new BrowserWindow({
    width: Math.min(1280, sw),
    height: Math.min(820, sh),
    minWidth: 900,
    minHeight: 620,
    x: Math.max(0, Math.round((sw - Math.min(1280, sw)) / 2)),
    y: Math.max(0, Math.round((sh - Math.min(820, sh)) / 2)),
    resizable: true,
    backgroundColor: '#F8FAFC',
    title: '作业看板',
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  boardWin.loadFile('renderer/homework/homework-board.html');
  boardWin.webContents.on('did-finish-load', () => logToFile('board', 'window did-finish-load'));
  boardWin.webContents.on('render-process-gone', (_, details) => logToFile('board', `RENDER GONE: ${JSON.stringify(details)}`));
  boardWin.on('closed', () => { logToFile('board', 'window closed'); boardWin = null; });
  boardWin.on('unresponsive', () => logToFile('board', 'WINDOW UNRESPONSIVE!'));
}

// ═══════════════════════════════════════
//  后台人脸采集工作窗口
// ═══════════════════════════════════════

function createFaceCheckWindow() {
  if (!isSystemReady()) return;
  if (faceCheckWin && !faceCheckWin.isDestroyed()) return;
  faceCheckWin = new BrowserWindow({
    // 保留最小渲染表面供 getUserMedia / Canvas 使用，但不展示给用户。
    width: 1,
    height: 1,
    show: false,
    // show:false 时仍让渲染进程保持活跃，供摄像头和 Canvas 持续工作。
    paintWhenInitiallyHidden: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    title: '后台人脸采集',
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webgl: true,
      // 隐藏窗口时仍持续采集，避免 Chromium 将检测循环降频。
      backgroundThrottling: false,
    },
  });
  faceCheckWin.loadFile('renderer/face/face-check.html');
  faceCheckWin.on('closed', () => { faceCheckWin = null; });
}

function createFaceRegisterWindow(studentId, name) {
  if (!isSystemReady()) { createOnboardingWindow(); return; }
  if (faceRegisterWin && !faceRegisterWin.isDestroyed()) {
    faceRegisterWin.focus();
    // 通知已打开的窗口切换学生
    faceRegisterWin.webContents.send('set-student', studentId, name);
    return;
  }
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  faceRegisterWin = new BrowserWindow({
    width: 520,
    height: 580,
    x: Math.round((sw - 520) / 2),
    y: Math.round((sh - 580) / 3),
    title: '人脸注册 — 学生底库录入',
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webgl: true,
    },
  });
  // 通过 hash 传递初始学生参数
  const hash = studentId ? `#${encodeURIComponent(studentId)}/${encodeURIComponent(name)}` : '';
  faceRegisterWin.loadFile('renderer/face/face-register.html', { hash: hash || undefined });
  faceRegisterWin.on('closed', () => { faceRegisterWin = null; });
}

// ═══════════════════════════════════════
//  考勤数据
// ═══════════════════════════════════════

function getAttendanceData() {
  const d = getDb();
  const data = loadData();
  const students = data.students || [];
  // 用本地时区当天的键，避免 UTC 日界漏判
  const today = localDayKey(new Date());
  const results = [];

  for (const s of students) {
    const row = d.prepare(
      "SELECT status, detected_at, similarity FROM attendance WHERE student_id=? AND day=? LIMIT 1"
    ).get(s.id, today);
    results.push({
      studentId: s.id,
      name: s.name,
      status: row ? row.status : 'absent',
      lastSeen: row ? row.detected_at : null,
      similarity: row ? row.similarity : null,
    });
  }
  return results;
}

/**
 * 记录考勤：按 (student_id, day) UPSERT，一人一天只保留最新一条。
 * 解决旧实现每帧 INSERT 导致 attendance 表爆炸（3人/2天就 237 行）。
 */
function recordAttendance(studentId, status, similarity) {
  const d = getDb();
  const now = new Date().toISOString();
  const day = localDayKey(new Date());
  d.prepare(
    "INSERT INTO attendance (student_id, status, detected_at, similarity, day) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(student_id, day) DO UPDATE SET status=excluded.status, detected_at=excluded.detected_at, similarity=excluded.similarity"
  ).run(studentId, status, now, similarity, day);
  return now;
}

function broadcastFaceStatus(attendance) {
  if (!wss) return;
  const data = attendance || getAttendanceData();
  const msg = JSON.stringify({ type: 'face-status', attendance: data });
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN && ws._teacher && ws._teacher.status === 'approved') {
      ws.send(msg);
    }
  });
}

let _broadcastCount = 0;
let _lastBroadcastSig = '';
function broadcastFaceDetections(detections) {
  if (!wss) return;
  const allFacesMessage = JSON.stringify({ type: 'face-detections', detections });
  const recognizedFacesMessage = JSON.stringify({
    type: 'face-detections',
    detections: detections.filter(det => det.isRecognized && det.studentId),
  });
  let openClients = 0;
  let sent = 0;
  wss.clients.forEach(ws => {
    openClients++;
    if (ws.readyState === WebSocket.OPEN && ws._teacher && ws._teacher.status === 'approved') {
      // 未匹配人脸属于班级敏感配置数据，只发送给班主任。
      ws.send(ws._teacher.role === '班主任' ? allFacesMessage : recognizedFacesMessage);
      sent++;
    }
  });
  _broadcastCount++;
  // 诊断：detections 数量变化时记录（重点抓"发空数组"和客户端数变化）
  const sig = detections.length + ':' + sent + ':' + openClients;
  if (sig !== _lastBroadcastSig || _broadcastCount % 30 === 0) {
    _lastBroadcastSig = sig;
    logToFile('facebcast', `${detections.length} faces | sent=${sent} | total_ws_clients=${openClients} | open=${wss.clients.size} (#${_broadcastCount})`);
  }
}

function broadcastFaceSystemState(target = null) {
  if (!wss) return;
  const message = JSON.stringify({ type:'face-system-state', enabled:getFaceCheckEnabled() });
  const clients = target ? [target] : Array.from(wss.clients);
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN && ws._teacher?.status === 'approved') ws.send(message);
  });
}

function canManageFaceSystem(ws) {
  return ws?._transport === 'lan'
    && ws?._teacher?.status === 'approved'
    && ws?._teacher?.role === '班主任';
}

function broadcastFaceCameraFrame(image) {
  if (!wss || !getFaceCheckEnabled()) return;
  const message = JSON.stringify({ type:'face-camera-frame', image, capturedAt:Date.now() });
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN && ws._facePreviewSubscribed && canManageFaceSystem(ws)) ws.send(message);
  });
}

function broadcastLabelResult(faceId, studentId, name) {
  if (!wss) return;
  const msg = JSON.stringify({ type: 'face-labeled', faceId, studentId, name });
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN && ws._teacher && ws._teacher.status === 'approved' && ws._teacher.role === '班主任') {
      ws.send(msg);
    }
  });
}

function getPendingFaces() {
  const rows = getDb().prepare('SELECT id, crop_base64, descriptor, first_seen, last_seen FROM pending_faces ORDER BY last_seen DESC').all();
  return rows.map(row => ({
    faceId: row.id,
    cropBase64: row.crop_base64 || '',
    descriptor: JSON.parse(row.descriptor),
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
  }));
}

function faceSimilarity(left, right) {
  if (!left || !right || left.length !== right.length) return -1;
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let i = 0; i < left.length; i++) { dot += left[i] * right[i]; leftNorm += left[i] * left[i]; rightNorm += right[i] * right[i]; }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : -1;
}

function getGalleryRecognitionThreshold(galleryManager) {
  const threshold = galleryManager.getConfig().recognitionThreshold;
  return Number.isFinite(threshold) ? threshold : SFACE_COSINE_THRESHOLD;
}

function removePendingFacesMatchingDescriptor(descriptor, threshold, requiredFaceId = null) {
  const matches = getPendingFaces()
    .filter(face => face.faceId === requiredFaceId || faceSimilarity(descriptor, face.descriptor) >= threshold)
    .map(face => face.faceId);
  if (requiredFaceId && !matches.includes(requiredFaceId)) matches.push(requiredFaceId);
  if (matches.length === 0) return 0;
  const d = getDb();
  const remove = d.prepare('DELETE FROM pending_faces WHERE id=?');
  d.transaction(ids => ids.forEach(id => remove.run(id)))(matches);
  return matches.length;
}

function prunePendingFacesRecognizedByGallery(galleryManager = getGallery()) {
  const threshold = getGalleryRecognitionThreshold(galleryManager);
  const staleIds = getPendingFaces()
    .filter(face => {
      const match = galleryManager.findBestMatch(new Float32Array(face.descriptor));
      return match && match.similarity >= threshold;
    })
    .map(face => face.faceId);
  if (staleIds.length === 0) return 0;
  const d = getDb();
  const remove = d.prepare('DELETE FROM pending_faces WHERE id=?');
  d.transaction(ids => ids.forEach(id => remove.run(id)))(staleIds);
  return staleIds.length;
}

function storePendingFace(det) {
  if (!Array.isArray(det.descriptor) || det.descriptor.length !== 128 || det.descriptor.some(value => !Number.isFinite(value))) return false;
  if (Number.isFinite(det.seenCount) && det.seenCount < PENDING_FACE_CONFIRM_COUNT) return false;
  const descriptor = det.descriptor.map(Number);
  // 标注后的短时间内，渲染进程可能仍上报旧的“未识别”追踪；以最新底库为准二次拦截。
  const galleryManager = getGallery();
  const knownMatch = galleryManager.findBestMatch(new Float32Array(descriptor));
  const recognitionThreshold = getGalleryRecognitionThreshold(galleryManager);
  if (knownMatch && knownMatch.similarity >= recognitionThreshold) {
    return removePendingFacesMatchingDescriptor(descriptor, recognitionThreshold) > 0;
  }
  const pending = getPendingFaces();
  const duplicate = pending.find(face => faceSimilarity(descriptor, face.descriptor) >= 0.72);
  const now = new Date().toISOString();
  const d = getDb();
  if (duplicate) {
    d.prepare('UPDATE pending_faces SET last_seen=? WHERE id=?').run(now, duplicate.faceId);
    return false;
  }
  // 保留有限数量，避免长时间运行时把未标注人脸库无限放大。
  if (pending.length >= 100) d.prepare('DELETE FROM pending_faces WHERE id IN (SELECT id FROM pending_faces ORDER BY last_seen ASC LIMIT 1)').run();
  const id = 'pf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  d.prepare('INSERT INTO pending_faces (id, crop_base64, descriptor, first_seen, last_seen) VALUES (?,?,?,?,?)')
    .run(id, typeof det.cropBase64 === 'string' ? det.cropBase64 : '', JSON.stringify(descriptor), now, now);
  return true;
}

function removePendingFace(faceId) { getDb().prepare('DELETE FROM pending_faces WHERE id=?').run(faceId); }

function broadcastPendingFaces() {
  if (!wss) return;
  const msg = JSON.stringify({ type: 'pending-face-library', faces: getPendingFaces() });
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN && ws._teacher && ws._teacher.status === 'approved' && ws._teacher.role === '班主任') ws.send(msg);
  });
}

// ═══════════════════════════════════════
//  WebSocket 服务
// ═══════════════════════════════════════

function startWSServer() {
  wss = new WebSocket.Server({ port: WS_PORT, host: '0.0.0.0' });
  wss.on('error', (error) => {
    logToFile('ws', `WebSocket server error: ${error.message}`);
    if (error.code === 'EADDRINUSE') {
      console.error(`[WS] port ${WS_PORT} is already in use`);
    }
  });
  console.log(`[WS] listening on 0.0.0.0:${WS_PORT}`);

  wss.on('connection', (ws, req) => {
    const remote = req.socket.remoteAddress;
    console.log(`[WS] teacher connected (${remote})`);
    ws._lastPing = Date.now();

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (!isHomeroomBound() && !['probe', 'connect', 'join-request', 'leave-classroom', 'ping'].includes(msg.type)) {
        ws.send(JSON.stringify({ type: 'approval-required', message: '教室端尚未完成班主任绑定，暂时不能使用教学功能' }));
        return;
      }
      if (isHomeroomBound() && !isClassroomConfigured() && !['probe', 'connect', 'leave-classroom', 'ping', 'update-classroom'].includes(msg.type)) {
        ws.send(JSON.stringify({ type: 'auth-required', message: '请先由班主任完成教室初始化配置' }));
        return;
      }

      switch (msg.type) {

        case 'probe': {
          const data = loadData();
          ws._purpose = 'preflight';
          ws.send(JSON.stringify({
            type:'probe-ack',
            className:data.className || '本教室',
            homeroomBound:isHomeroomBound(),
            classroomConfigured:isClassroomConfigured(),
            serverTime:Date.now(),
          }));
          console.log(`[WS] preflight successful (${remote})`);
          break;
        }

        case 'connect': {
          const data = loadData();
          let teacher = null;
          ws._purpose = ['session', 'snapshot', 'leave', 'face'].includes(msg.purpose) ? msg.purpose : 'legacy';

          const loopback = /^(?:127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(String(remote || ''));
          const cloudMembership = loopback && msg._cloudBridgeSecret === cloudBridgeSecret && msg._cloudMembership && typeof msg._cloudMembership === 'object' ? msg._cloudMembership : null;
          ws._transport = cloudMembership ? 'cloud' : 'lan';
          const connectionId = String(cloudMembership && cloudMembership.connectionId || msg.connectionId || '').trim();
          const reportedName = String(cloudMembership && cloudMembership.name || msg.name || '').trim().slice(0, 20);
          const reportedSubjects = normalizeSubjects(cloudMembership && cloudMembership.subjects || msg.subjects);
          if (!reportedName || !/^[A-Za-z0-9-]{8,128}$/.test(connectionId)) {
            ws.send(JSON.stringify({ type: 'login-required', message: '教师身份无效，请在教师端重新登录' }));
            break;
          }

          {
            if (cloudMembership) {
              const cloudRole = cloudMembership.role === 'homeroom' ? '班主任' : '授课教师';
              if (!reportedSubjects.length) {
                ws.send(JSON.stringify({ type:'subject-required', message:'请先在云服务中设置至少一个授课科目' }));
                break;
              }
              const d = getDb();
              d.transaction(() => {
                if (cloudRole === '班主任') d.prepare("UPDATE approved_teachers SET role='授课教师' WHERE role='班主任' AND connection_id<>?").run(connectionId);
                d.prepare('DELETE FROM pending_requests WHERE connection_id=?').run(connectionId);
                d.prepare('INSERT OR REPLACE INTO approved_teachers (connection_id,name,role,subjects,approved_at) VALUES (?,?,?,?,?)')
                  .run(connectionId, reportedName, cloudRole, JSON.stringify(reportedSubjects), new Date().toISOString());
              })();
            }
            const t = findTeacher(connectionId);
            if (t.found && t.approved) {
              // 已批准：以教室端存储的身份为准（管理员可修改角色/学科）
              teacher = { connectionId, name: t.name, role: t.role, subjects: t.subjects, status: 'approved' };
              // 兼容旧版未设科目的已加入账户：只允许在教室端记录为空时补齐，不覆盖班主任已授权的科目。
              if (!normalizeSubjects(t.subjects).length && reportedSubjects.length) {
                getDb().prepare('UPDATE approved_teachers SET subjects=? WHERE connection_id=?').run(JSON.stringify(reportedSubjects), connectionId);
                teacher.subjects = reportedSubjects;
              }
              if (!normalizeSubjects(teacher.subjects).length) {
                ws.send(JSON.stringify({ type: 'subject-required', message: '当前教室还没有你的授课科目，请重新添加教室并先选择科目' }));
                break;
              }
              // 若教师端上报的姓名有变化，更新数据库
              if (reportedName !== t.name) {
                getDb().prepare('UPDATE approved_teachers SET name=? WHERE connection_id=?').run(reportedName, connectionId);
                teacher.name = reportedName;
              }
            } else if (t.found && !t.approved) {
              if (!reportedSubjects.length) {
                ws.send(JSON.stringify({ type: 'subject-required', message: '加入教室前必须至少选择一个授课科目' }));
                break;
              }
              // 待审核：更新教师最新上报的身份信息
              const newName = reportedName || t.name;
              const newSubjects = reportedSubjects;
              getDb().prepare('UPDATE pending_requests SET name=?, subjects=?, requested_at=? WHERE connection_id=?')
                .run(newName, JSON.stringify(newSubjects), new Date().toISOString(), connectionId);
              teacher = { connectionId, name: newName, role: t.role, subjects: newSubjects, status: 'pending' };
            } else {
              if (!reportedSubjects.length) {
                ws.send(JSON.stringify({ type: 'subject-required', message: '加入教室前必须至少选择一个授课科目' }));
                break;
              }
              getDb().prepare('INSERT INTO pending_requests (connection_id, name, role, subjects, requested_at) VALUES (?,?,?,?,?)')
                .run(connectionId, reportedName, '授课教师', JSON.stringify(reportedSubjects), new Date().toISOString());
              teacher = { connectionId, name: reportedName, role: '授课教师', subjects: reportedSubjects, status: 'pending' };
            }
          }
          ws._teacher = teacher;

          if (teacher.status === 'approved' && isHomeroomBound() && (isClassroomConfigured() || teacher.role === '班主任')) {
            sendTeacherSync(ws, data);
          } else {
            ws.send(JSON.stringify({
              type: 'approval-required',
              className: data.className,
              teacher,
              message: !isHomeroomBound()
                ? '教室端尚未绑定班主任，请先完成首次设置'
                : (!isClassroomConfigured() ? '等待班主任完成教室初始化配置' : '等待班主任批准加入'),
            }));
          }
          console.log(`[WS] connect from ${remote}, teacher=${teacher.name}, role=${teacher.role}, status=${teacher.status}, purpose=${ws._purpose}`);

          // 通知绑定引导与班主任教师端：待审核列表有变化
          if (teacher.status === 'pending') {
            // 只有尚未绑定班主任时，候选身份才需要出现在教室端首次设置窗口。
            // 后续普通教师申请只同步给班主任的小程序或教师桌面端审核。
            if (!isHomeroomBound()) {
              createOnboardingWindow();
              if (onboardingWin && !onboardingWin.isDestroyed()) {
                onboardingWin.show();
                onboardingWin.focus();
              }
            }
            notifyTeacherCandidatesChanged();
            broadcastSync(loadData());
          }
          notifyOnboardingChanged();
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
            notifyTeacherCandidatesChanged();
            notifyOnboardingChanged();
            broadcastSync(loadData());
          }
          break;
        }

        case 'leave-classroom': {
          const teacher = ws._teacher || {};
          if (!teacher.connectionId || !['approved', 'pending'].includes(teacher.status)) {
            ws.send(JSON.stringify({ type: 'auth-required', message: '请先验证教师身份，再退出教室' }));
            break;
          }
          const membership = removeTeacherMembership(teacher.connectionId);
          const wasHomeroom = membership.role === '班主任' || teacher.role === '班主任';
          ws._teacher = { ...teacher, status: 'left' };
          ws.send(JSON.stringify({
            type: 'leave-classroom-ack',
            removed: membership.removed,
            wasHomeroom,
            message: membership.removed ? '教室端已删除当前教师记录' : '当前教师记录已不存在',
          }));

          // 同一账户可能同时登录在教师电脑和小程序；立即撤销其他连接的权限，
          // 避免数据库记录删除后旧 WebSocket 仍能继续操作教室数据。
          wss.clients.forEach(client => {
            if (client === ws || client.readyState !== WebSocket.OPEN) return;
            if (!client._teacher || client._teacher.connectionId !== teacher.connectionId) return;
            client._teacher = { ...client._teacher, status: 'left' };
            client.send(JSON.stringify({ type: 'membership-revoked', message: '当前教师已退出教室，教室端记录已删除' }));
          });

          notifyTeacherCandidatesChanged();
          notifyOnboardingChanged();
          if (wasHomeroom) deactivateBoundRuntimeForRebinding();
          else broadcastSync(loadData());
          rebuildTrayMenu();
          logToFile('ws', `teacher left classroom: ${teacher.name} (${teacher.connectionId}), role=${teacher.role || membership.role || 'unknown'}`);
          break;
        }

        case 'call': {
          if (!checkApprovedTeacher(ws)) return;
          if (!msg.callId || !msg.studentName) return;
          const normalizedCall = normalizeIncomingCall(msg);
          if (!normalizedCall) return;
          enqueueCall({
            callId: msg.callId,
            // 始终由完整名单生成显示目标，避免旧客户端传来的“等 X 位”摘要继续出现。
            studentName: normalizedCall.studentName,
            studentNames: normalizedCall.studentNames,
            className: String(msg.className || '').slice(0, 40),
            message: normalizedCall.message,
          }, ws);
          break;
        }

        case 'ping': {
          ws._lastPing = Date.now();
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        }

        case 'request-sync': {
          if (ws._teacher && ws._teacher.status === 'approved') sendTeacherSync(ws, loadData());
          break;
        }

        case 'update-submission': {
          if (!checkApprovedTeacher(ws)) return;
          if (!msg.assignmentId || !msg.studentId) return;
          const data = loadData();
          const assignment = data.assignments.find(a => a.id === msg.assignmentId);
          if (assignment && assignment.type !== 'notice' && canTeacherManageSubject(ws._teacher, assignment.subject)) {
            assignment.submissions[msg.studentId] = msg.status || '未提交';
            saveData(data);
            broadcastSync(data);
          } else if (assignment) {
            ws.send(JSON.stringify({ type:'auth-required', message:'你只能更新本人授课科目的作业提交情况' }));
          }
          break;
        }

        case 'update-assignments': {
          if (!msg.action) return;
          const data = loadData();
          const teacher = ws._teacher || {};
          if (teacher.status !== 'approved') { ws.send(JSON.stringify({ type: 'auth-required', message: '未获批准，无法发布或修改班级内容' })); return; }
          const requested = msg.assignment || {};
          const existing = requested.id ? data.assignments.find(item => item.id === requested.id) : null;
          // 任课教师只能操作教室端已授权的学科；编辑时不得借由篡改 subject 转移作业归属。
          const targetSubject = msg.action === 'add' ? requested.subject : (existing && existing.subject);
          const hasConfiguredSubjects = normalizeSubjects(teacher.subjects).length > 0;
          const hasSubjectPermission = hasConfiguredSubjects && canTeacherManageSubject(teacher, targetSubject);
          const subjectUnchanged = msg.action !== 'edit' || !existing || requested.subject === existing.subject || teacher.role === '班主任';
          if (!targetSubject || !hasSubjectPermission || !subjectUnchanged) {
            ws.send(JSON.stringify({ type: 'auth-required', message: hasConfiguredSubjects ? '你只能发布或修改自己被授权学科的作业与通知' : '请先设置至少一个授课科目，再发布作业或通知' })); return;
          }
          if (msg.action === 'add' && requested.id && requested.title) {
            data.assignments.push({ ...msg.assignment, type: requested.type === 'notice' ? 'notice' : 'homework', source:'teacher', submissions: requested.type === 'notice' ? {} : (requested.submissions || {}) });
            setHomeworkUnread(true);
          } else if (msg.action === 'delete' && existing) {
            data.assignments = data.assignments.filter(a => a.id !== existing.id);
          } else if (msg.action === 'edit' && existing) {
            const idx = data.assignments.findIndex(a => a.id === existing.id);
            if (idx >= 0) data.assignments[idx] = { ...msg.assignment, type: existing.type === 'notice' ? 'notice' : 'homework', source:existing.source === 'student' ? 'student' : 'teacher', submissions: existing.type === 'notice' ? {} : (msg.assignment.submissions || {}) };
          } else { return; }
          saveData(data);
          broadcastSync(data);
          break;
        }

        case 'update-classroom': {
          const teacher = ws._teacher || {};
          if (teacher.status !== 'approved' || teacher.role !== '班主任') {
            ws.send(JSON.stringify({ type: 'auth-required', message: '仅已批准的班主任可修改班级资料与学生名单' })); return;
          }
          const data = loadData();
          const input = msg.classroom || {};
          const configuredSubjects = normalizeSubjects(input.subjects);
          if (configuredSubjects.length && !normalizeSubjects(teacher.subjects).length) {
            getDb().prepare('UPDATE approved_teachers SET subjects=? WHERE connection_id=?')
              .run(JSON.stringify(configuredSubjects), teacher.connectionId);
            teacher.subjects = configuredSubjects;
            ws._teacher.subjects = configuredSubjects;
          }
          const names = Array.isArray(input.students) ? input.students : [];
          const seenIds = new Set();
          const seenNames = new Set();
          const students = [];
          names.forEach((student, index) => {
            const name = String(student && student.name || '').trim().slice(0, 20);
            if (!name || seenNames.has(name)) return;
            const id = String(student && student.id || ('s' + Date.now().toString(36) + index)).trim().slice(0, 64);
            if (!id || seenIds.has(id)) return;
            seenIds.add(id); seenNames.add(name); students.push({ id, name });
          });
          data.className = String(input.className || '').trim().slice(0, 40);
          data.students = students;
          if (!data.className || students.length === 0) {
            ws.send(JSON.stringify({ type: 'auth-required', message: '教室配置需要填写班级名称并至少添加一名学生' }));
            return;
          }
          if (!normalizeSubjects(teacher.subjects).length) {
            ws.send(JSON.stringify({ type: 'auth-required', message: '班主任必须先设置授课科目，才能完成教室配置' }));
            return;
          }
          data.subjects = getDerivedSubjects();
          const studentIds = new Set(students.map(student => student.id));
          data.assignments.filter(assignment => assignment.type !== 'notice').forEach(assignment => {
            assignment.submissions = assignment.submissions || {};
            Object.keys(assignment.submissions).forEach(id => { if (!studentIds.has(id)) delete assignment.submissions[id]; });
            students.forEach(student => { if (!assignment.submissions[student.id]) assignment.submissions[student.id] = '未提交'; });
          });
          getDb().prepare("INSERT OR REPLACE INTO meta VALUES ('classroomConfigured', 'true')").run();
          saveData(data);
          activateBoundRuntime(false);
          rebuildTrayMenu();
          break;
        }

        case 'manage-teacher': {
          const operator = ws._teacher || {};
          if (!isSystemReady() || operator.status !== 'approved' || operator.role !== '班主任') {
            ws.send(JSON.stringify({ type: 'auth-required', message: '仅班主任可管理教师接入' }));
            return;
          }
          const action = String(msg.action || '');
          const connectionId = String(msg.connectionId || '').trim();
          if (!connectionId || (connectionId === operator.connectionId && action !== 'update')) {
            ws.send(JSON.stringify({ type: 'auth-required', message: '班主任只能修改自己的授课科目' }));
            return;
          }
          const subjects = normalizeSubjects(msg.subjects);
          const d = getDb();
          if (action === 'approve') {
            const pending = d.prepare('SELECT * FROM pending_requests WHERE connection_id=?').get(connectionId);
            if (!pending) return;
            const requestedSubjects = normalizeSubjects(JSON.parse(pending.subjects || '[]'));
            if (!requestedSubjects.length) {
              ws.send(JSON.stringify({ type: 'auth-required', message: '该教师尚未设置授课科目，请其重新发起加入请求' }));
              return;
            }
            d.transaction(() => {
              d.prepare('DELETE FROM pending_requests WHERE connection_id=?').run(connectionId);
              d.prepare('INSERT OR REPLACE INTO approved_teachers (connection_id, name, role, subjects, approved_at) VALUES (?,?,?,?,?)')
                .run(connectionId, pending.name, '授课教师', JSON.stringify(requestedSubjects), new Date().toISOString());
            })();
            refreshTeacherConnections(connectionId, false);
          } else if (action === 'reject') {
            rejectTeacher(connectionId);
            refreshTeacherConnections(connectionId, true);
          } else if (action === 'update') {
            if (!subjects.length) {
              ws.send(JSON.stringify({ type: 'auth-required', message: '每位教师必须至少保留一个授课科目' }));
              return;
            }
            const target = d.prepare('SELECT role FROM approved_teachers WHERE connection_id=?').get(connectionId);
            if (!target) return;
            d.prepare('UPDATE approved_teachers SET subjects=? WHERE connection_id=?')
              .run(JSON.stringify(subjects), connectionId);
            refreshTeacherConnections(connectionId, false);
          } else if (action === 'remove') {
            const target = d.prepare('SELECT role FROM approved_teachers WHERE connection_id=?').get(connectionId);
            if (!target || target.role === '班主任') return;
            removeTeacher(connectionId);
            refreshTeacherConnections(connectionId, true, true);
          } else if (action === 'transfer') {
            const target = d.prepare('SELECT role, subjects FROM approved_teachers WHERE connection_id=?').get(connectionId);
            const current = d.prepare('SELECT role FROM approved_teachers WHERE connection_id=?').get(operator.connectionId);
            if (!target || target.role === '班主任' || !current || current.role !== '班主任') {
              ws.send(JSON.stringify({ type: 'auth-required', message: '班主任转让对象无效，请刷新教师成员列表后重试' }));
              return;
            }
            if (!normalizeSubjects(JSON.parse(target.subjects || '[]')).length) {
              ws.send(JSON.stringify({ type: 'auth-required', message: '接任教师必须先设置至少一个授课科目' }));
              return;
            }
            d.transaction(() => {
              d.prepare("UPDATE approved_teachers SET role='授课教师' WHERE connection_id=? AND role='班主任'")
                .run(operator.connectionId);
              d.prepare("UPDATE approved_teachers SET role='班主任' WHERE connection_id=? AND role<>'班主任'")
                .run(connectionId);
            })();
            refreshTeacherConnections(connectionId, false);
            refreshTeacherConnections(operator.connectionId, false);
          } else {
            return;
          }
          broadcastSync(loadData());
          break;
        }

        case 'confirm-subjects': {
          const teacher = ws._teacher || {};
          if (teacher.status !== 'approved') { ws.send(JSON.stringify({ type: 'auth-required', message: '请先完成教室审核' })); return; }
          const subjects = normalizeSubjects(msg.subjects);
          if (!subjects.length) { ws.send(JSON.stringify({ type: 'auth-required', message: '请至少确认一个授课科目' })); return; }
          getDb().prepare('UPDATE approved_teachers SET subjects=? WHERE connection_id=?').run(JSON.stringify(subjects), teacher.connectionId);
          ws._teacher.subjects = subjects;
          sendTeacherSync(ws, loadData());
          break;
        }

        case 'update-subjects': {
          ws.send(JSON.stringify({ type: 'auth-required', message: '学科由班主任和已加入教师的授课科目自动生成，不能手动修改' }));
          break;
        }

        case 'set-face-system': {
          if (!canManageFaceSystem(ws)) {
            ws.send(JSON.stringify({ type:'auth-required', message:'仅班主任可通过局域网开启或关闭教室人脸系统' }));
            break;
          }
          setFaceCheckEnabled(msg.enabled === true);
          break;
        }

        case 'face-preview-subscribe': {
          if (!canManageFaceSystem(ws)) {
            ws.send(JSON.stringify({ type:'auth-required', message:'完整摄像头画面仅供班主任在教室局域网内查看' }));
            break;
          }
          ws._facePreviewSubscribed = msg.enabled === true && getFaceCheckEnabled();
          ws.send(JSON.stringify({ type:'face-preview-state', enabled:ws._facePreviewSubscribed, faceSystemEnabled:getFaceCheckEnabled() }));
          break;
        }

        case 'label-face': {
          const teacher = ws._teacher || {};
          if (teacher.status !== 'approved' || teacher.role !== '班主任') {
            ws.send(JSON.stringify({ type: 'auth-required', message: '仅班主任可为待标注人脸匹配学生姓名' }));
            return;
          }
          // 只接受教室端待标注人脸库中的特征，防止前端传入过期或伪造的 descriptor。
          if (!msg.faceId || !msg.studentId || !msg.name) return;
          const pending = getPendingFaces().find(face => face.faceId === msg.faceId);
          if (!pending) { ws.send(JSON.stringify({ type: 'auth-required', message: '该待标注人脸已失效或已被处理' })); return; }
          const g = getGallery();
          const descriptor = new Float32Array(pending.descriptor);
          g.addStudent(msg.studentId, msg.name, [descriptor]);
          g.saveNow();
          const data = loadData();
          if (!data.students.some(student => student.id === msg.studentId)) {
            data.students.push({ id: msg.studentId, name: msg.name });
            saveData(data);
          }
          // 同一个人可能因角度变化产生多条待标注记录；入库后一次清除全部可识别记录。
          const removedPendingCount = prunePendingFacesRecognizedByGallery(g);
          if (removedPendingCount === 0) removePendingFace(msg.faceId);
          // 广播标注结果
          broadcastLabelResult(msg.faceId, msg.studentId, msg.name);
          broadcastPendingFaces();
          console.log(`[face] labeled face ${msg.faceId} as ${msg.name} (${msg.studentId}); cleared ${Math.max(removedPendingCount, 1)} pending face(s)`);
          break;
        }
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[WS] teacher disconnected (${remote}), teacher=${ws._teacher && ws._teacher.name || 'unverified'}, purpose=${ws._purpose || 'unknown'}, code=${code}, reason=${reason && reason.toString() || '-'}`);
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

// 所有已获批准的教师都可以执行课堂呼叫等通用教学操作。
function checkApprovedTeacher(ws) {
  if (!isSystemReady()) {
    ws.send(JSON.stringify({ type: 'approval-required', message: '教室端尚未完成初始化配置' }));
    return false;
  }
  const t = ws._teacher || {};
  if (!t.status || t.status !== 'approved') {
    ws.send(JSON.stringify({ type: 'auth-required', message: '未获批准，无法修改数据' }));
    return false;
  }
  return true;
}

function canTeacherManageSubject(teacher, subject) {
  if (!teacher || teacher.status !== 'approved' || !subject) return false;
  const subjects = normalizeSubjects(teacher.subjects);
  return teacher.role === '班主任' || subjects.includes(String(subject).trim());
}

// 广播同步数据（每个连接带个性化 teacher 信息）
function broadcastSync(data) {
  if (!wss || !isHomeroomBound()) return;
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN && ws._teacher && ws._teacher.status === 'approved') sendTeacherSync(ws, data);
  });
  cloudBridge?.sendSnapshot();
}

function buildCloudSnapshot() {
  const data = loadData();
  return {
    type:'sync',
    className:data.className,
    students:data.students,
    subjects:data.subjects,
    assignments:data.assignments,
    classroomConfigured:isClassroomConfigured(),
    teachers:{ approved:getApprovedTeachers(), pending:getPendingRequests() },
    faceLanRequired:true,
  };
}

function sendTeacherSync(ws, data) {
  if (!isHomeroomBound() || !ws || ws.readyState !== WebSocket.OPEN || !ws._teacher || ws._teacher.status !== 'approved') return;
  if (!isClassroomConfigured() && ws._teacher.role !== '班主任') return;
  // 兼容修复前遗留的数据：同步前先过滤已经能被当前底库识别的待标注记录。
  prunePendingFacesRecognizedByGallery();
  const homeroom = ws._teacher.role === '班主任';
  const teacherSubjects = normalizeSubjects(ws._teacher.subjects);
  const allowedSubjects = new Set(teacherSubjects);
  const visibleAssignments = homeroom
    ? data.assignments
    : data.assignments.filter(item => allowedSubjects.has(String(item.subject || '')));
  ws.send(JSON.stringify({
    type: 'sync',
    className: data.className,
    students: data.students,
    subjects: homeroom ? data.subjects : teacherSubjects,
    assignments: visibleAssignments,
    attendance: getAttendanceData(),
    pendingFaces: homeroom ? getPendingFaces() : [],
    faceSystemEnabled: getFaceCheckEnabled(),
    classroomConfigured: isClassroomConfigured(),
    teachers: homeroom ? { approved: getApprovedTeachers(), pending: getPendingRequests() } : null,
    teacher: {
      connectionId: ws._teacher.connectionId,
      name: ws._teacher.name,
      role: ws._teacher.role,
      subjects: ws._teacher.subjects,
      status: ws._teacher.status,
    },
  }));
}

function refreshTeacherConnections(connectionId, rejected, removed = false, pending = false) {
  if (!wss) return;
  const data = loadData();
  wss.clients.forEach(ws => {
    if (!ws._teacher || ws._teacher.connectionId !== connectionId || ws.readyState !== WebSocket.OPEN) return;
    if (rejected) {
      ws._teacher.status = removed ? 'left' : (pending ? 'pending' : 'rejected');
      ws.send(JSON.stringify(removed
        ? { type: 'membership-revoked', className: data.className, message: `班主任已将你移出“${data.className || '当前教室'}”，本地教室记录已删除` }
        : pending
          ? { type: 'approval-required', className: data.className, teacher: ws._teacher, message: '云服务已将你的成员状态改为待审核，请等待班主任重新批准' }
          : { type: 'approval-rejected', className: data.className, message: '班主任未批准此次加入申请' }));
      return;
    }
    const current = findTeacher(connectionId);
    if (!current.found || !current.approved) return;
    ws._teacher = { connectionId, name: current.name, role: current.role, subjects: current.subjects, status: 'approved' };
    sendTeacherSync(ws, data);
  });
}

// ═══════════════════════════════════════
//  IPC 处理
// ═══════════════════════════════════════

ipcMain.handle('get-data', () => {
  if (!isSystemReady()) return { locked: true, className: '', students: [], subjects: [], assignments: [] };
  logToFile('ipc', 'get-data called');
  const t0 = Date.now();
  const r = loadData();
  const t1 = Date.now();
  if (t1 - t0 > 100) logToFile('ipc', `get-data slow: ${t1 - t0}ms`);
  return r;
});
ipcMain.handle('save-data', (_, data) => {
  if (!isSystemReady()) return false;
  logToFile('ipc', `save-data called, ${(data.students||[]).length}s/${(data.assignments||[]).length}hw`);
  const t0 = Date.now();
  saveData(data);
  const t1 = Date.now();
  if (t1 - t0 > 100) logToFile('ipc', `save-data slow: ${t1 - t0}ms`);
  return true;
});
ipcMain.handle('create-student-assignment', (_, input) => {
  if (!isSystemReady()) return { success:false, message:'教室尚未完成配置' };
  const data = loadData();
  const subject = String(input && input.subject || '').trim().slice(0, 30);
  const title = String(input && input.title || '').trim().slice(0, 200);
  const date = String(input && input.date || '').trim();
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
  if (!subject || !data.subjects.includes(subject)) return { success:false, message:'请选择教室中已有的授课科目' };
  if (!title) return { success:false, message:'请填写作业内容' };
  const studentCreatedToday = data.assignments.filter(item => item.source === 'student' && item.date === validDate);
  if (studentCreatedToday.length >= 30) return { success:false, message:'今日补录作业数量已达上限，请联系老师检查' };
  const duplicate = data.assignments.find(item => item.type !== 'notice' && item.date === validDate && item.subject === subject && item.title === title);
  if (duplicate) return { success:false, message:'这项作业已经存在，请直接选择后上报' };
  const assignment = {
    id:`student-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,
    subject,
    title,
    date:validDate,
    deadline:new Date().toISOString(),
    type:'homework',
    source:'student',
    submissions:Object.fromEntries(data.students.map(student => [student.id, '未提交'])),
  };
  data.assignments.push(assignment);
  saveData(data);
  return { success:true, assignment };
});
ipcMain.on('open-face-register', (_, studentId, name) => createFaceRegisterWindow(studentId, name));
ipcMain.on('open-homework-widget', () => openHomeworkWidget());
ipcMain.on('hide-homework-widget', () => hideHomeworkWidget());
ipcMain.on('open-homework-board', () => openBoardWindow());
ipcMain.handle('get-homework-unread', () => getHomeworkUnread());
ipcMain.on('set-homework-float-expanded', (_, expanded) => setHomeworkFloatExpanded(!!expanded));
ipcMain.on('move-homework-float', (event, dx, dy) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win !== homeworkFloatWin || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + dx), Math.round(y + dy));
});

ipcMain.handle('get-onboarding-status', () => getOnboardingStatus());
ipcMain.handle('get-classroom-qr', () => getClassroomQrData());
ipcMain.handle('get-cloud-config', () => {
  const config = getCloudConfig();
  return config ? { enabled:true, serverUrl:config.serverUrl, classroomId:config.classroomId, deviceId:config.deviceId } : null;
});
ipcMain.handle('enroll-cloud', async (_, input) => {
  try {
    const config = await enrollClassroom({ serverUrl:input && input.serverUrl, key:input && input.key, deviceName:os.hostname() || '教室电脑', appVersion:app.getVersion() });
    getDb().prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('cloudConfig',?)").run(serializeCloudConfig(config));
    restartCloudBridge();
    return { ok:true, config:{ enabled:true, serverUrl:config.serverUrl, classroomId:config.classroomId, deviceId:config.deviceId } };
  } catch (error) { return { ok:false, message:error.message || '无法连接云服务' }; }
});
ipcMain.handle('disconnect-cloud', async () => {
  const config = getCloudConfig();
  if (cloudBridge) cloudBridge.stop();
  cloudBridge = null;
  if (config) { try { await revokeClassroom(config); } catch (_error) {} }
  getDb().prepare("DELETE FROM meta WHERE key='cloudConfig'").run();
  rebuildTrayMenu();
  return { ok:true };
});
ipcMain.handle('get-wechat-direct-link-settings', () => getWechatDirectLinkSettings());
ipcMain.handle('set-wechat-direct-link-settings', (_, baseUrl) => setWechatDirectLinkSettings(baseUrl));
ipcMain.handle('get-network-interfaces', () => getNetworkInterfaceStatus());
ipcMain.handle('set-network-interface', (_, name) => setNetworkInterface(name));
ipcMain.handle('bind-homeroom-teacher', (_, connectionId) => bindHomeroomTeacher(connectionId));
ipcMain.on('finish-onboarding', () => finishBindingStage());

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

// 绑定引导中的教师候选列表有变化
function notifyTeacherCandidatesChanged() {
  notifyOnboardingChanged();
}

function notifyOnboardingChanged() {
  if (onboardingWin && !onboardingWin.isDestroyed()) {
    onboardingWin.webContents.send('onboarding-changed');
  }
}

// 数据变更时通知看板刷新 + 教师端同步
function notifyAllDataChanged(data) {
  if (boardWin && !boardWin.isDestroyed()) {
    logToFile('ipc', 'send data-changed → board');
    boardWin.webContents.send('data-changed');
  }
  if (homeworkWidgetWin && !homeworkWidgetWin.isDestroyed()) {
    homeworkWidgetWin.webContents.send('data-changed');
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
//  人脸识别开关
// ═══════════════════════════════════════

function getFaceCheckEnabled() {
  const d = getDb();
  const row = d.prepare("SELECT value FROM meta WHERE key='faceCheckEnabled'").get();
  // 默认开启（未设置时返回 true）
  if (!row) return true;
  return row.value === 'true';
}

function setFaceCheckEnabled(enabled) {
  const d = getDb();
  d.prepare("INSERT OR REPLACE INTO meta VALUES ('faceCheckEnabled', ?)").run(enabled ? 'true' : 'false');
  if (enabled) {
    // 开启：启动人脸采集窗口
    createFaceCheckWindow();
  } else {
    // 关闭：关闭现有人脸采集窗口
    if (faceCheckWin && !faceCheckWin.isDestroyed()) {
      faceCheckWin.close();
    }
  }
  rebuildTrayMenu();
  broadcastFaceSystemState();
}

// ═══════════════════════════════════════
//  人脸识别 IPC 处理
// ═══════════════════════════════════════

let gallery = null;

function getGallery() {
  if (!gallery) {
    gallery = new AdaptiveGalleryManager(path.join(DATA_DIR, 'gallery.json'), ACTIVE_EMBEDDING_MODEL);
    gallery.load();
  }
  return gallery;
}

// 获取底库数据（用于渲染进程人脸识别）
ipcMain.handle('face:get-gallery', () => {
  const g = getGallery();
  const result = [];
  for (const id of g.getAllStudentIds()) {
    const descs = g.getDescriptors(id);
    // 转为普通数组以便 IPC 传输
    result.push({
      studentId: id,
      name: g.getStudentName(id),
      descriptors: descs.map(d => Array.from(d)),
    });
  }
  return { students: result, config: g.getConfig(), metadata: g.getMetadata() };
});

// 学生人脸注册（face-api.js 检测在渲染进程完成，主进程只存描述符）
// 参数 descriptorArray 为渲染进程已提取的 128 维特征向量
ipcMain.handle('face:register', async (_, studentId, name, descriptorArray) => {
  try {
    if (!Array.isArray(descriptorArray) || descriptorArray.length !== 128 || descriptorArray.some(value => !Number.isFinite(value))) {
      return { success: false, error: '人脸描述符必须是 128 维有限数值' };
    }
    const g = getGallery();
    const descriptor = new Float32Array(descriptorArray);
    g.addStudent(studentId, name, [descriptor]);
    g.saveNow();
    if (prunePendingFacesRecognizedByGallery(g) > 0) broadcastPendingFaces();
    return { success: true };
  } catch (e) {
    console.error('[face:register] error:', e.message);
    return { success: false, error: e.message };
  }
});

// 注册时保存已提取的描述符
ipcMain.handle('face:save-descriptor', (_, studentId, name, descriptorArray) => {
  try {
    if (!Array.isArray(descriptorArray) || descriptorArray.length !== 128 || descriptorArray.some(value => !Number.isFinite(value))) {
      return { success: false, error: '人脸描述符必须是 128 维有限数值' };
    }
    const g = getGallery();
    const descriptor = new Float32Array(descriptorArray);
    g.addStudent(studentId, name, [descriptor]);
    g.saveNow();
    if (prunePendingFacesRecognizedByGallery(g) > 0) broadcastPendingFaces();
    return { success: true };
  } catch (e) {
    console.error('[face:save-descriptor] error:', e.message);
    return { success: false, error: e.message };
  }
});

// 上报检测到的所有人脸（新流程：含缩略图+描述符，广播给教师端标注）
// 记录最近一次考勤签名，仅当有人状态变化时才广播 face-status，避免每帧全量推送
let _lastAttendanceSig = '';

ipcMain.handle('face:report-detections', (_, detections) => {
  try {
    // detections: [{ faceId, cropBase64, descriptor, studentId, name, similarity, isRecognized }]
    const g = getGallery();
    let pendingChanged = false;
    // 对已识别的人脸：记录考勤 + 自适应特征入库（设计方案核心功能，原先缺失）
    for (const det of detections) {
      if (det.isRecognized && det.studentId) {
        recordAttendance(det.studentId, 'present', det.similarity);
        // 高置信度特征加入自适应底库，使识别越来越准
        if (det.descriptor && det.descriptor.length > 0) {
          try {
            g.tryAddAdaptiveDescriptor(det.studentId, new Float32Array(det.descriptor), det.similarity);
          } catch (_) { /* 自适应失败不影响主流程 */ }
          pendingChanged = removePendingFacesMatchingDescriptor(
            det.descriptor,
            getGalleryRecognitionThreshold(g)
          ) > 0 || pendingChanged;
        }
      }
    }
    for (const det of detections) {
      if (!det.isRecognized || !det.studentId) pendingChanged = storePendingFace(det) || pendingChanged;
    }
    // 广播所有人脸给教师端（缩略图 + 描述符，用于标注/展示）
    broadcastFaceDetections(detections);
    if (pendingChanged) broadcastPendingFaces();

    // 考勤状态仅在变化时广播，降低 WS 负载
    const attendance = getAttendanceData();
    const sig = attendance.map(a => a.studentId + ':' + a.status + ':' + (a.lastSeen || '')).join('|');
    if (sig !== _lastAttendanceSig) {
      _lastAttendanceSig = sig;
      broadcastFaceStatus(attendance);
    }
    return { success: true };
  } catch (e) {
    console.error('[face:report-detections] error:', e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('face:preview-requested', () => {
  if (!wss || !getFaceCheckEnabled()) return false;
  return Array.from(wss.clients).some(ws => ws.readyState === WebSocket.OPEN && ws._facePreviewSubscribed && canManageFaceSystem(ws));
});

ipcMain.on('face:report-preview', (_event, image) => {
  if (typeof image !== 'string' || image.length > 400000 || !/^data:image\/jpeg;base64,/.test(image)) return;
  broadcastFaceCameraFrame(image);
});

// 获取考勤状态
ipcMain.handle('face:get-attendance', () => {
  return getAttendanceData();
});

// 重置某学生的自适应特征
ipcMain.handle('face:reset-adaptive', (_, studentId) => {
  const g = getGallery();
  g.resetAdaptive(studentId);
  return { success: true };
});

// 获取底库学生列表（含特征数量）
ipcMain.handle('face:get-students', () => {
  const g = getGallery();
  return g.getStudents();
});

// 删除学生底库
ipcMain.handle('face:remove-student', (_, studentId) => {
  const g = getGallery();
  g.removeStudent(studentId);
  return { success: true };
});

// 更新底库配置
ipcMain.handle('face:update-config', (_, newConfig) => {
  const g = getGallery();
  g.updateConfig(newConfig);
  return { success: true, config: g.getConfig() };
});

// 人脸识别开关
ipcMain.handle('get-face-check-enabled', () => {
  return getFaceCheckEnabled();
});

ipcMain.handle('set-face-check-enabled', (_, enabled) => {
  setFaceCheckEnabled(enabled);
  return getFaceCheckEnabled();
});

// 人脸采集诊断日志（渲染进程每帧上报，用于排查"头像闪现后消失"等问题）
ipcMain.on('face:diag-log', (_, line) => {
  logToFile('facediag', line);
});

// ═══════════════════════════════════════
//  原生人脸引擎 IPC（C++ ONNX Runtime 加速路径）
// ═══════════════════════════════════════

// 查询原生引擎是否可用
ipcMain.handle('face:native-status', () => {
  return {
    available: NATIVE_AVAILABLE,
    embeddingModel: ACTIVE_EMBEDDING_MODEL,
    recognitionThreshold: NATIVE_AVAILABLE ? SFACE_COSINE_THRESHOLD : getGallery().getConfig().recognitionThreshold,
    gallery: getGallery().getMetadata(),
  };
});

// 原生人脸检测 + 特征提取 + 匹配（一帧全流程）
ipcMain.handle('face:native-detect', (_, imageData, width, height) => {
  if (!NATIVE_AVAILABLE || !nativeFaceEngine) {
    return { success: false, error: 'native engine not available' };
  }
  try {
    const pixels = Buffer.from(imageData);
    const faces = nativeFaceEngine.detectFaces(pixels, width, height);

    // 构建图库扁平数组用于匹配
    const g = getGallery();
    const allStudentIds = g.getAllStudentIds();
    const galleryIndexMap = []; // flatIndex → { studentId, name }
    const galleryFlat = [];

    for (const id of allStudentIds) {
      const descs = g.getDescriptors(id);
      for (const d of descs) {
        galleryIndexMap.push({ studentId: id, name: g.getStudentName(id) });
        for (let j = 0; j < d.length; j++) {
          galleryFlat.push(d[j]);
        }
      }
    }

    const numGallery = galleryIndexMap.length;
    const results = [];

    for (const face of faces) {
      const descriptor = nativeFaceEngine.extractDescriptor(pixels, width, height, face);

      // 跳过描述符提取失败的人脸（等下一帧重试）
      if (!descriptor || descriptor.length !== 128) continue;

      let bestMatch = { index: -1, similarity: 0 };
      if (numGallery > 0) {
        const matches = nativeFaceEngine.matchFace(
          new Float32Array(descriptor),
          new Float32Array(galleryFlat),
          1
        );
        if (matches && matches.length > 0 && matches[0].similarity >= SFACE_COSINE_THRESHOLD) {
          bestMatch = matches[0];
        }
      }

      results.push({
        faceId: 'face_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        box: face,
        descriptor: Array.from(descriptor),
        studentId: bestMatch.index >= 0 ? galleryIndexMap[bestMatch.index].studentId : null,
        name: bestMatch.index >= 0 ? galleryIndexMap[bestMatch.index].name : '未识别',
        similarity: bestMatch.similarity || 0,
        isRecognized: bestMatch.index >= 0,
      });
    }

    return { success: true, detections: results };
  } catch (e) {
    logToFile('native', `Detection error: ${e.message}`);
    return { success: false, error: e.message };
  }
});

// 原生特征提取（用于人脸注册）
ipcMain.handle('face:native-extract-descriptor', (_, imageData, width, height) => {
  if (!NATIVE_AVAILABLE || !nativeFaceEngine) {
    return { success: false, error: 'native engine not available' };
  }
  try {
    const pixels = Buffer.from(imageData);
    const faces = nativeFaceEngine.detectFaces(pixels, width, height);
    if (!faces || faces.length === 0) {
      return { success: false, error: 'no face detected' };
    }
    const descriptor = nativeFaceEngine.extractDescriptor(pixels, width, height, faces[0]);
    if (!descriptor || descriptor.length === 0) {
      return { success: false, error: 'descriptor extraction failed' };
    }
    return { success: true, descriptor: Array.from(descriptor) };
  } catch (e) {
    logToFile('native', `Extract descriptor error: ${e.message}`);
    return { success: false, error: e.message };
  }
});

// 原生特征匹配（独立的匹配查询）
ipcMain.handle('face:native-match', (_, descriptorArray) => {
  if (!NATIVE_AVAILABLE || !nativeFaceEngine) {
    return { success: false, error: 'native engine not available' };
  }
  try {
    const g = getGallery();
    const allStudentIds = g.getAllStudentIds();
    const galleryIndexMap = [];
    const galleryFlat = [];

    for (const id of allStudentIds) {
      const descs = g.getDescriptors(id);
      for (const d of descs) {
        galleryIndexMap.push({ studentId: id, name: g.getStudentName(id) });
        for (let j = 0; j < d.length; j++) {
          galleryFlat.push(d[j]);
        }
      }
    }

    if (galleryIndexMap.length === 0) {
      return { success: true, matches: [] };
    }

    const matches = nativeFaceEngine.matchFace(
      new Float32Array(descriptorArray),
      new Float32Array(galleryFlat),
      3
    );

    return {
      success: true,
      matches: (matches || []).map(m => ({
        index: m.index,
        similarity: m.similarity,
        studentId: galleryIndexMap[m.index] ? galleryIndexMap[m.index].studentId : null,
        name: galleryIndexMap[m.index] ? galleryIndexMap[m.index].name : '未知',
      })),
    };
  } catch (e) {
    logToFile('native', `Match error: ${e.message}`);
    return { success: false, error: e.message };
  }
});

// ═══════════════════════════════════════
//  应用生命周期
// ═══════════════════════════════════════

// 注册自定义协议 scheme（必须在 app.ready 之前）
protocol.registerSchemesAsPrivileged([
  { scheme: 'face-models', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

app.whenReady().then(() => {
  if (!HAS_SINGLE_INSTANCE_LOCK) return;
  if (CI_SMOKE_TEST) return runCISmokeTest();
  // 注册自定义协议用于加载模型文件（绕过 file:// fetch 限制）
  protocol.handle('face-models', (request) => {
    // request.url 可能是各种格式: face-models://models/xxx, face-models:/models/xxx
    // 直接用 URL 解析提取路径
    let pathname;
    try {
      const u = new URL(request.url);
      pathname = u.host + u.pathname; // host='models', pathname='/xxx'
    } catch {
      pathname = request.url.replace(/^face-models:\/*/, '');
    }
    const filePath = path.join(__dirname, pathname);
    console.log('[face-models]', request.url, '→', filePath);
    try {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      return new Response(data, {
        headers: { 'Content-Type': ext === '.json' ? 'application/json' : 'application/octet-stream' },
      });
    } catch (e) {
      console.error('[face-models] 404:', filePath, e.message);
      return new Response('Not Found', { status: 404 });
    }
  });

  // 隐藏默认菜单栏
  Menu.setApplicationMenu(null);
  // 运行时同步更新 macOS Dock 图标；托盘和窗口图标也使用同一资源。
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(getAppIcon());
  // ── 启动日志 ──
  const line = '='.repeat(50);
  console.log(line);
  console.log('  Banda - Classroom App');
  console.log(line);
  console.log(`  WS Port  : ${WS_PORT}`);
  console.log(`  Database : ${DB_FILE}`);
  console.log(line);

  // 默认开启开机自启（首次运行）
  const loginSettings = app.getLoginItemSettings();
  if (!loginSettings.wasOpenedAtLogin && !loginSettings.openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  // 先确定特征模型，再加载对应版本底库；模型变化时会先备份旧库。
  loadNativeFaceEngine();
  getGallery().cleanExpired();

  // 每 6 小时清理一次过期自适应特征（expiryDays 默认 30 天）
  setInterval(() => {
    try { getGallery().cleanExpired(); } catch (_) {}
  }, 6 * 60 * 60 * 1000).unref();

  startWSServer();
  restartMdnsAdvertisement();
  createTray();
  restartCloudBridge();
  if (isSystemReady()) activateBoundRuntime(false);
  else if (!isHomeroomBound()) createOnboardingWindow();
});

// 阻止所有窗口关闭时退出（托盘常驻）
app.on('window-all-closed', () => { /* 什么都不做，保持托盘运行 */ });

app.on('before-quit', () => {
  app.isQuitting = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (cloudBridge) cloudBridge.stop();
  if (wss) wss.close();
  classroomMdns.stop();
  if (gallery) gallery.ensureSaved();
  if (nativeFaceEngine) {
    try { nativeFaceEngine.destroy(); } catch (_) {}
  }
});

app.on('activate', () => {
  // macOS Dock 点击：只有未绑定状态进入首次设置；已绑定但待配置时显示连接二维码。
  if (isSystemReady()) openBoardWindow();
  else if (!isHomeroomBound()) createOnboardingWindow();
  else createConnectionQrWindow();
});
