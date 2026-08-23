const socket = require('../../utils/socket');
const { sessionStore } = require('../../utils/session');
const { parseClassroomQr } = require('../../utils/classroom-qr');
const sharedRoom = require('../../utils/shared-room');
const scanAction = require('../../utils/scan-action');
const errorReport = require('../../utils/error-report');
const networkDiagnostics = require('../../utils/network-diagnostics');
const subjectOptions = require('../../utils/subject-options');
const shareCard = require('../../utils/share-card');

Page({
  data: {
    scanning: false,
    activeRoomName: '',
    roomCount: 0,
    canShareRoom: false,
  },

  onShow() {
    const session = sessionStore.load();
    if (!session) { wx.reLaunch({ url: '/pages/login/index' }); return; }
    this.session = session;
    if (this.getTabBar) this.getTabBar().refresh('scan');
    this.setData({
      activeRoomName: session.activeRoom && session.activeRoom.name || '',
      roomCount: (session.rooms || []).length,
      canShareRoom: this.isCurrentRoomHomeroom(session),
    });
  },

  onLoad() {
    wx.hideShareMenu();
    this.unsubscribe = socket.subscribe((event, payload) => {
      if (event !== 'sync') return;
      this.currentTeacherRole = payload.teacher && payload.teacher.role || '';
      const session = sessionStore.load();
      const canShareRoom = this.isCurrentRoomHomeroom(session);
      this.setData({ canShareRoom });
      if (canShareRoom) wx.showShareMenu({ menus: ['shareAppMessage'] });
      else wx.hideShareMenu();
    });
  },

  onUnload() { this.unsubscribe && this.unsubscribe(); wx.hideShareMenu(); },

  isCurrentRoomHomeroom(session) {
    const socketState = socket.getState();
    return !!(session && session.activeRoom && socketState.status === 'online' && this.currentTeacherRole === '班主任');
  },

  onShareAppMessage() {
    const session = sessionStore.load();
    const room = session && session.activeRoom;
    if (!room || !this.isCurrentRoomHomeroom(session)) return shareCard.classroomInvite('班达 · 连接教室', '/pages/scan/index');
    return shareCard.classroomInvite(`${session.account.name} 邀请你连接“${room.name}”`, sharedRoom.createPath(room));
  },

  chooseScanAction() {
    if (this.data.scanning) return;
    scanAction.start({ onComplete: () => this.onShow() });
  },

  scanTeacherLogin() {
    this.scanCode(result => scanAction.handleTeacherLogin(result, () => this.onShow()));
  },

  scanClassroom() {
    this.scanCode(result => {
      let room;
      try { room = parseClassroomQr(result); }
      catch (error) {
        errorReport.show({title:'无法添加教室',error,context:'扫码－解析教室二维码',suggestions:['请扫描教室端当前显示的连接二维码', '让教室端刷新二维码后重新扫描']});
        return;
      }
      scanAction.openClassroomConnection(room);
    });
  },

  scanCode(onSuccess) {
    if (this.data.scanning) return;
    this.setData({ scanning: true });
    wx.scanCode({
      scanType: ['qrCode'],
      success: ({ result }) => onSuccess(result),
      fail: error => {
        if (!error || !String(error.errMsg || '').includes('cancel')) {
          wx.showToast({ title: '未能读取二维码', icon: 'none' });
        }
      },
      complete: () => this.setData({ scanning: false }),
    });
  },

  async saveClassroom(room) {
    const subjects=await subjectOptions.choose([], '选择授课科目');
    if(!subjects)return;
    wx.showLoading({title:'正在连接教室',mask:true});
    try {
      const saved=await scanAction.saveClassroom(room,subjects);
      this.session=saved.updated;
      this.setData({activeRoomName:saved.room.name,roomCount:saved.updated.rooms.length});
      wx.hideLoading();
      wx.showModal({title:saved.connection.status==='pending'?'身份已发送':'教室连接成功',content:saved.connection.status==='pending'?'请在教室电脑上确认当前教师身份并绑定为班主任。':'当前教师身份已通过验证。',showCancel:false});
    } catch(error) {
      wx.hideLoading();
      networkDiagnostics.showFailure({ error,room,context:'扫码连接教室' });
    }
  },

  explainSharePermission() {
    wx.showModal({ title: '仅班主任可以分享', content: '请先连接教室并确认当前账户已被该教室绑定为班主任。', showCancel: false });
  },

  showConnectionFailure(title, detail) {
    errorReport.show({ title, error:new Error(detail || title), context:'小程序扫码连接', message:'二维码已经读取，但无法与对应电脑建立连接。', suggestions:['确认手机和电脑在同一局域网', '确认微信已获本地网络权限', '确认电脑端二维码仍在有效期内'] });
  },
});
