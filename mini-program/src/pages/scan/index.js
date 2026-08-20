const socket = require('../../utils/socket');
const { sessionStore } = require('../../utils/session');
const { pairWithTeacher } = require('../../utils/auth');
const { parseClassroomQr } = require('../../utils/classroom-qr');
const sharedRoom = require('../../utils/shared-room');
const scanAction = require('../../utils/scan-action');

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
    if (!room || !this.isCurrentRoomHomeroom(session)) return { title: '教室连接', path: '/pages/scan/index' };
    return {
      title: `${session.account.name} 邀请你连接“${room.name}”`,
      path: sharedRoom.createPath(room),
    };
  },

  chooseScanAction() {
    if (this.data.scanning) return;
    scanAction.start({ onComplete: () => this.onShow() });
  },

  scanTeacherLogin() {
    this.scanCode(async result => {
      wx.showLoading({ title: '正在登录教师端', mask: true });
      try {
        const synced = await pairWithTeacher(result, this.session);
        const previousCode = this.session.activeRoom && this.session.activeRoom.connectionCode;
        const activeRoom = synced.rooms.find(item => item.connectionCode === previousCode) || synced.rooms[0] || null;
        const updated = sessionStore.save({ ...synced, activeRoom, pairedAt: new Date().toISOString() });
        getApp().globalData.session = updated;
        this.session = updated;
        this.setData({ activeRoomName: activeRoom && activeRoom.name || '', roomCount: updated.rooms.length });
        wx.hideLoading();
        wx.showModal({ title: '教师端登录成功', content: '账户和教室连接信息已安全同步到电脑教师端。', showCancel: false });
      } catch (error) {
        wx.hideLoading();
        this.showConnectionFailure('无法登录教师端', error && error.message);
      }
    });
  },

  scanClassroom() {
    this.scanCode(result => {
      let room;
      try { room = parseClassroomQr(result); }
      catch (error) {
        wx.showModal({ title: '无法添加教室', content: error.message || '请扫描教室端显示的连接二维码', showCancel: false });
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
    const result=await new Promise(resolve=>wx.showModal({title:'填写授课科目',content:'这是加入教室的必填信息。多个科目可用逗号分隔。',editable:true,placeholderText:'例如：数学、物理',success:resolve,fail:()=>resolve({confirm:false})}));
    if(!result.confirm)return;
    const subjects=String(result.content||'').split(/[,，、\s]+/).map(value=>value.trim()).filter(Boolean);
    if(!subjects.length){wx.showToast({title:'请至少填写一个科目',icon:'none'});return;}
    wx.showLoading({title:'正在连接教室',mask:true});
    try {
      const saved=await scanAction.saveClassroom(room,subjects);
      this.session=saved.updated;
      this.setData({activeRoomName:saved.room.name,roomCount:saved.updated.rooms.length});
      wx.hideLoading();
      wx.showModal({title:saved.connection.status==='pending'?'身份已发送':'教室连接成功',content:saved.connection.status==='pending'?'请在教室电脑上确认当前教师身份并绑定为班主任。':'当前教师身份已通过验证。',showCancel:false});
    } catch(error) {
      wx.hideLoading();
      this.showConnectionFailure('无法连接教室',error&&error.message);
    }
  },

  explainSharePermission() {
    wx.showModal({ title: '仅班主任可以分享', content: '请先连接教室并确认当前账户已被该教室绑定为班主任。', showCancel: false });
  },

  showConnectionFailure(title, detail) {
    const reason = detail ? `\n\n错误信息：${detail}` : '';
    wx.showModal({
      title,
      content: `请确认：\n1. 手机和电脑在同一局域网\n2. 微信已获本地网络权限\n3. 电脑端二维码仍在有效期内${reason}`,
      confirmText: '重新扫码',
      cancelText: '稍后再试',
      success: result => { if (result.confirm) this.chooseScanAction(); },
    });
  },
});
