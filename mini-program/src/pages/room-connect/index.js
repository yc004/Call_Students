const { sessionStore } = require('../../utils/session');
const sharedRoom = require('../../utils/shared-room');
const scanAction = require('../../utils/scan-action');

Page({
  data: {
    valid: false,
    loggedIn: false,
    roomName: '教室连接',
    connectionCode: '',
    accountName: '',
    subjectText: '',
    alreadySaved: false,
    connecting: false,
    connectionState: 'ready',
    connectionTitle: '准备连接',
    connectionDetail: '确认信息后连接教室',
  },

  onLoad(options) {
    const room = sharedRoom.fromLaunchOptions(options);
    this.room = room;
    if (!room) {
      this.setData({ valid: false });
      wx.showModal({ title: '分享链接无效', content: '教室连接信息不完整，请让班主任重新分享。', showCancel: false });
      return;
    }
    this.setData({ valid: true, roomName: room.name, connectionCode: room.connectionCode });
    this.refreshSession();
    this.autoConnect = options && options.auto === '1';
    if (this.autoConnect && this.data.subjectText) setTimeout(() => this.connectRoom(), 180);
  },

  onShow() { if (this.room) this.refreshSession(); },

  refreshSession() {
    const session = sessionStore.load();
    this.session = session;
    const alreadySaved = !!(session && (session.rooms || []).some(item => item.connectionCode === this.room.connectionCode));
    const savedRoom = session && (session.rooms || []).find(item => item.connectionCode === this.room.connectionCode);
    this.setData({ loggedIn: !!session, accountName: session && session.account.name || '', alreadySaved, subjectText:(savedRoom && savedRoom.subjects || []).join('、') });
  },

  onSubjectInput(event) { this.setData({ subjectText:event.detail.value }); },

  async connectRoom() {
    if (!this.room || this.data.connecting) return;
    if (!this.session) {
      sharedRoom.savePending(this.room);
      wx.navigateTo({ url: '/pages/login/index?from=roomShare' });
      return;
    }
    const subjects=String(this.data.subjectText||'').split(/[,，、\s]+/).map(value=>value.trim()).filter(Boolean);
    if(!subjects.length){wx.showToast({title:'请填写授课科目',icon:'none'});return;}
    this.setData({ connecting:true,connectionState:'connecting',connectionTitle:'正在连接教室',connectionDetail:`正在通过连接码 ${this.room.connectionCode} 发送教师身份…` });
    try {
      const saved=await scanAction.saveClassroom(this.room,subjects);
      sharedRoom.clearPending();
      this.session=saved.updated;
      this.setData({alreadySaved:true,connecting:false,connectionState:saved.connection.status==='pending'?'waiting':'success',connectionTitle:saved.connection.status==='pending'?'身份已发送，等待电脑确认':'教室连接成功',connectionDetail:saved.connection.status==='pending'?'请查看教室电脑，确认当前教师并绑定为班主任。':'当前教师身份已经通过教室验证。'});
    } catch(error) {
      this.refreshSession();
      this.setData({connecting:false,connectionState:'failed',connectionTitle:'无法连接教室',connectionDetail:error&&error.message||'没有收到教室端响应，请检查网络后重试。'});
    }
  },

  goHome(){wx.switchTab({url:'/pages/home/index'});},

  openScan() { scanAction.start({ onComplete: () => this.refreshSession() }); },
});
