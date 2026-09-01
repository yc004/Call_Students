const { sessionStore } = require('../../utils/session');
const sharedRoom = require('../../utils/shared-room');
const scanAction = require('../../utils/scan-action');
const networkDiagnostics = require('../../utils/network-diagnostics');
const subjectOptions = require('../../utils/subject-options');

Page({
  data: {
    valid: false,
    loggedIn: false,
    roomName: '教室连接',
    connectionCode: '',
    accountName: '',
    subjectText: '',
    selectedSubjects: [],
    alreadySaved: false,
    connecting: false,
    connectionState: 'ready',
    connectionTitle: '准备连接',
    connectionDetail: '确认信息后连接教室',
  },

  onLoad(options) {
    this.subjectDraftDirty = false;
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

  onShow() { if (this.room) this.refreshSession({ preserveSubjectDraft:this.subjectDraftDirty }); },

  refreshSession({ preserveSubjectDraft = false } = {}) {
    const session = sessionStore.load();
    this.session = session;
    const alreadySaved = !!(session && (session.rooms || []).some(item => item.connectionCode === this.room.connectionCode));
    const savedRoom = session && (session.rooms || []).find(item => item.connectionCode === this.room.connectionCode);
    const selectedSubjects = subjectOptions.normalize(preserveSubjectDraft ? this.data.selectedSubjects : savedRoom && savedRoom.subjects);
    this.setData({ loggedIn: !!session, accountName: session && session.account.name || '', alreadySaved, selectedSubjects, subjectText:selectedSubjects.join('、') });
  },

  async chooseSubjects() {
    const selectedSubjects = await subjectOptions.choose(this.data.selectedSubjects, '选择授课科目',this.room&&this.room.transport==='cloud'?this.room.subjects:undefined);
    if (!selectedSubjects) return;
    this.subjectDraftDirty = true;
    this.setData({ selectedSubjects, subjectText: selectedSubjects.join('、') });
  },

  async connectRoom() {
    if (!this.room || this.data.connecting) return;
    if (!this.session) {
      sharedRoom.savePending(this.room);
      wx.navigateTo({ url: '/pages/login/index?from=roomShare' });
      return;
    }
    const subjects=subjectOptions.normalize(this.data.selectedSubjects);
    if(!subjects.length){wx.showToast({title:'请选择授课科目',icon:'none'});return;}
    this.setData({ connecting:true,connectionState:'connecting',connectionTitle:'正在连接教室',connectionDetail:`正在通过连接码 ${this.room.connectionCode} 发送教师身份…` });
    try {
      const saved=await scanAction.saveClassroom(this.room,subjects);
      this.subjectDraftDirty = false;
      sharedRoom.clearPending();
      this.session=saved.updated;
      this.setData({alreadySaved:true,connecting:false,connectionState:saved.connection.status==='pending'?'waiting':'success',connectionTitle:saved.connection.status==='pending'?'身份已发送，等待电脑确认':'教室连接成功',connectionDetail:saved.connection.status==='pending'?'请查看教室电脑，确认当前教师并绑定为班主任。':'当前教师身份已经通过教室验证。'});
    } catch(error) {
      this.refreshSession({ preserveSubjectDraft:true });
      const diagnosis=await networkDiagnostics.diagnose(error,{room:this.room});
      this.setData({connecting:false,connectionState:'failed',connectionTitle:diagnosis.title,connectionDetail:diagnosis.message});
      networkDiagnostics.showFailure({ error,room:this.room,networkType:diagnosis.networkType,context:'教室分享链接连接' });
    }
  },

  goHome(){wx.switchTab({url:'/pages/home/index'});},

  openScan() { scanAction.start({ onComplete: () => this.refreshSession() }); },
});
