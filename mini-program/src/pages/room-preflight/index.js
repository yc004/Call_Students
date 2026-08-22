const sharedRoom = require('../../utils/shared-room');
const { probeClassroom } = require('../../utils/classroom-probe');
const networkDiagnostics = require('../../utils/network-diagnostics');

Page({
  data: {
    roomName:'正在识别教室',
    state:'connecting',
    title:'正在连接教室',
    detail:'请保持手机与教室电脑处于同一局域网',
    networkText:'正在读取网络状态',
    elapsedText:'',
    failureKind:'',
    failureSuggestions:[],
    hotspotLikely:false,
  },

  onLoad(options) {
    this.room = sharedRoom.fromLaunchOptions(options);
    if (!this.room) {
      this.setData({ state:'failed', title:'二维码信息无效', detail:'请返回后重新扫描教室端当前显示的二维码。' });
      return;
    }
    this.setData({ roomName:this.room.name });
    this.readNetwork();
    this.startConnection();
  },

  onUnload() {
    this.destroyed = true;
    if (this.redirectTimer) clearTimeout(this.redirectTimer);
  },

  readNetwork() {
    wx.getNetworkType({
      success:result => {
        this.networkType = String(result.networkType || 'unknown').toLowerCase();
        this.setData({ networkText:this.networkType === 'none' ? '当前设备没有网络连接' : `当前网络：${this.networkType.toUpperCase()}` });
      },
      fail:() => this.setData({ networkText:'请确认手机网络连接正常' }),
    });
  },

  async startConnection() {
    if (!this.room || this.connecting) return;
    this.connecting = true;
    this.setData({ state:'connecting', title:'正在连接教室', detail:'正在确认教室端是否在线，请稍候…', elapsedText:'', failureKind:'', failureSuggestions:[], hotspotLikely:false });
    try {
      const result = await probeClassroom(this.room, 8000);
      if (this.destroyed) return;
      this.connecting = false;
      this.setData({
        state:'success',
        roomName:result.className || this.room.name,
        title:'教室连接成功',
        detail:'正在打开身份信息页面',
        elapsedText:`用时 ${result.elapsed}ms`,
      });
      this.redirectTimer = setTimeout(() => {
        if (this.destroyed) return;
        wx.redirectTo({
          url:`/pages/room-connect/index?name=${encodeURIComponent(result.className || this.room.name)}&code=${encodeURIComponent(this.room.connectionCode)}&auto=1`,
          fail:error => this.setData({ state:'failed', title:'无法打开下一步', detail:error && error.errMsg || '请返回后重试' }),
        });
      }, 520);
    } catch (error) {
      if (this.destroyed) return;
      this.connecting = false;
      const diagnosis = await networkDiagnostics.diagnose(error, { room:this.room, networkType:this.networkType });
      this.setData({
        state:'failed',
        title:diagnosis.title,
        detail:diagnosis.message,
        failureKind:diagnosis.kind,
        failureSuggestions:diagnosis.suggestions,
        hotspotLikely:diagnosis.hotspotLikely,
      });
    }
  },

  retry() { this.startConnection(); },
  goBack() { wx.navigateBack({ fail:() => wx.switchTab({ url:'/pages/home/index' }) }); },
});
