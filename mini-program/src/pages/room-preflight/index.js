const sharedRoom = require('../../utils/shared-room');
const { probeClassroom } = require('../../utils/classroom-probe');

Page({
  data: {
    roomName:'正在识别教室',
    state:'connecting',
    title:'正在连接教室',
    detail:'请保持手机与教室电脑处于同一局域网',
    networkText:'正在读取网络状态',
    elapsedText:'',
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
      success:result => this.setData({ networkText:result.networkType === 'none' ? '当前设备没有网络连接' : `当前网络：${String(result.networkType || '未知').toUpperCase()}` }),
      fail:() => this.setData({ networkText:'请确认手机网络连接正常' }),
    });
  },

  async startConnection() {
    if (!this.room || this.connecting) return;
    this.connecting = true;
    this.setData({ state:'connecting', title:'正在连接教室', detail:'正在确认教室端是否在线，请稍候…', elapsedText:'' });
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
      const detail = String(error && error.message || '没有收到教室端响应');
      this.setData({
        state:'failed',
        title:/domain|合法域名/i.test(detail) ? '微信阻止了局域网连接' : '暂时无法连接教室',
        detail:/domain|合法域名/i.test(detail)
          ? 'Android 请确认手机与教室电脑在同一 Wi-Fi，且路由器未关闭局域网设备发现；iPhone 正式版目前不支持微信的 mDNS 局域网发现。'
          : detail,
      });
    }
  },

  retry() { this.startConnection(); },
  goBack() { wx.navigateBack({ fail:() => wx.switchTab({ url:'/pages/home/index' }) }); },
});
