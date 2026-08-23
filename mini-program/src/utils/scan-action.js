const socket = require('./socket');
const { sessionStore } = require('./session');
const { pairWithTeacher, savePendingPairing, clearPendingPairing } = require('./auth');
const { PREFIX: ROOM_PREFIX, parseClassroomQr } = require('./classroom-qr');
const errorReport = require('./error-report');

function connectionGuide(title, detail, retry) {
  errorReport.show({ title, error:new Error(detail || title), context:'扫码连接', message:'扫码信息已读取，但无法完成客户端连接。', suggestions:['确认手机和电脑在同一局域网', '确认微信已获得本地网络权限', '确认电脑端二维码仍在有效期内', '调整后重新扫码；如仍失败，请复制信息提交管理员'] });
}

async function saveClassroom(room, subjects) {
  const current = sessionStore.load();
  if (!current) throw new Error('请先登录教师账户');
  const existing = (current.rooms || []).find(item => item.connectionCode === room.connectionCode);
  const requestedSubjects = Array.from(new Set((subjects || []).map(value => String(value).trim()).filter(Boolean)));
  if (!requestedSubjects.length) throw new Error('请先选择至少一个授课科目');
  const storedRoom = existing ? { ...existing, name: room.name, subjects: requestedSubjects } : { id: `room_${Date.now().toString(36)}`, ...room, subjects: requestedSubjects };
  const rooms = (current.rooms || []).filter(item => item.connectionCode !== room.connectionCode).concat(storedRoom);
  const updated = sessionStore.save({ ...current, rooms, activeRoom: storedRoom });
  getApp().globalData.session = updated;
  try {
    const connection = await socket.waitForConnection(storedRoom, { ...updated.account, subjects: requestedSubjects }, 10000);
    return { updated, existing: !!existing, room: storedRoom, connection };
  } catch (error) {
    // 连接失败时回滚新扫码的教室，避免首页留下一个实际不可达的“已绑定”记录。
    if (!existing) {
      const rollback = sessionStore.save({ ...current, activeRoom:current.activeRoom || null });
      getApp().globalData.session = rollback;
    }
    throw error;
  }
}

function openClassroomConnection(room) {
  wx.navigateTo({
    url:`/pages/room-preflight/index?name=${encodeURIComponent(room.name)}&code=${encodeURIComponent(room.connectionCode)}`,
    fail:error=>errorReport.show({title:'无法打开连接页面',error,context:'扫码连接－页面跳转',suggestions:['返回首页后重新扫码', '如果仍失败，请复制信息提交管理员']}),
  });
}

async function handleTeacherLogin(value, onComplete, retry) {
  const current = sessionStore.load();
  if (!current) {
    savePendingPairing(value);
    wx.navigateTo({ url: '/pages/login/index?from=teacherPair' });
    return;
  }
  wx.showLoading({ title: '正在登录教师端', mask: true });
  try {
    const result = await pairWithTeacher(value, current);
    clearPendingPairing();
    wx.hideLoading();
    const imported = result && result.imported || {};
    const roomText = Number.isFinite(imported.roomCount) ? `，并导入 ${imported.roomCount} 个教室` : '';
    wx.showModal({ title: '教师端登录成功', content: `已使用“${current.account.name}”登录电脑${roomText}。小程序中的资料不会被修改。`, showCancel: false });
    if (onComplete) onComplete({ type:'teacher', session:current });
  } catch (error) {
    wx.hideLoading();
    connectionGuide('无法登录教师端', error && error.message, retry);
  }
}

function start(options = {}) {
  wx.scanCode({
    scanType: ['qrCode'],
    success: ({ result }) => {
      const value = String(result || '').trim();
      const directRoom = require('./shared-room').parseDirectLink(value);
      if (directRoom) {
        openClassroomConnection(directRoom);
        return;
      }
      if (value.startsWith(`${ROOM_PREFIX}.`)) {
        try { openClassroomConnection(parseClassroomQr(value)); }
        catch (error) { errorReport.show({ title:'无法添加教室', error, context:'解析教室二维码', suggestions:['确认扫描的是教室端当前显示的二维码', '让教室端重新生成二维码后再试'] }); }
        return;
      }
      handleTeacherLogin(value, options.onComplete, () => start(options));
    },
    fail: error => {
      if (!String(error && error.errMsg || '').includes('cancel')) wx.showToast({ title: '未能读取二维码', icon: 'none' });
    },
  });
}

module.exports = { start, saveClassroom, handleTeacherLogin, openClassroomConnection };
