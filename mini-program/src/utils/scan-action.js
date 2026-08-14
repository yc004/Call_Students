const socket = require('./socket');
const { sessionStore } = require('./session');
const { pairWithTeacher, savePendingPairing, clearPendingPairing } = require('./auth');
const { PREFIX: ROOM_PREFIX, parseClassroomQr } = require('./classroom-qr');

function connectionGuide(title, detail, retry) {
  wx.showModal({
    title,
    content: `请确认：\n1. 手机和电脑在同一局域网\n2. 微信已获本地网络权限\n3. 电脑端二维码仍在有效期内${detail ? `\n\n错误信息：${detail}` : ''}`,
    confirmText: '重新扫码',
    cancelText: '稍后再试',
    success: result => { if (result.confirm) retry(); },
  });
}

async function saveClassroom(room, subjects) {
  const current = sessionStore.load();
  if (!current) throw new Error('请先登录教师账户');
  const existing = (current.rooms || []).find(item => item.connectionCode === room.connectionCode);
  const requestedSubjects = Array.from(new Set((subjects || []).map(value => String(value).trim()).filter(Boolean)));
  if (!requestedSubjects.length) throw new Error('请先填写至少一个授课科目');
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
    url:`/pages/room-connect/index?name=${encodeURIComponent(room.name)}&code=${encodeURIComponent(room.connectionCode)}&auto=1`,
    fail:error=>wx.showModal({title:'无法打开连接页面',content:error&&error.errMsg||'请返回首页后重试',showCancel:false}),
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
    const synced = await pairWithTeacher(value, current);
    const previousCode = current.activeRoom && current.activeRoom.connectionCode;
    const activeRoom = synced.rooms.find(item => item.connectionCode === previousCode) || synced.rooms[0] || null;
    const updated = sessionStore.save({ ...synced, activeRoom, pairedAt: new Date().toISOString() });
    clearPendingPairing();
    getApp().globalData.session = updated;
    if (activeRoom) socket.connect(activeRoom, updated.account, { force: true });
    wx.hideLoading();
    wx.showModal({ title: '教师端登录成功', content: '账户和教室连接信息已同步到电脑教师端。', showCancel: false });
    if (onComplete) onComplete({ type: 'teacher', updated });
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
        catch (error) { wx.showModal({ title: '无法添加教室', content: error.message, showCancel: false }); }
        return;
      }
      handleTeacherLogin(value, options.onComplete, () => start(options));
    },
    fail: error => {
      if (!String(error && error.errMsg || '').includes('cancel')) wx.showToast({ title: '未能读取二维码', icon: 'none' });
    },
  });
}

module.exports = { start, saveClassroom, handleTeacherLogin };
