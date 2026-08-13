const { pairWithTeacher } = require('../../utils/auth');
const { sessionStore } = require('../../utils/session');
const sharedRoom = require('../../utils/shared-room');

Page({
  data: { scanning: false, registerOpen: false, registerName: '' },
  onLoad(options) { this.fromRoomShare = !!(options && options.from === 'roomShare'); },
  onShow() {
    if (!sessionStore.load()) return;
    if (this.fromRoomShare && sharedRoom.resumePending()) return;
    wx.switchTab({ url: '/pages/home/index' });
  },
  scanLogin() {
    if (this.data.scanning) return;
    this.setData({ scanning: true });
    wx.scanCode({
      scanType: ['qrCode'],
      success: async ({ result }) => {
        try {
          wx.showLoading({ title: '正在连接教师端', mask: true });
          const current = sessionStore.load();
          if (!current) throw Object.assign(new Error('请先创建小程序教师账户，再从“我的”扫描教师端二维码'), { code:'PAIR_ACCOUNT_REQUIRED' });
          const session = await pairWithTeacher(result, current);
          sessionStore.save(session);
          getApp().globalData.session = session;
          wx.hideLoading();
          wx.showToast({ title: `欢迎，${session.account.name}`, icon: 'success' });
          setTimeout(() => { if (!sharedRoom.resumePending()) wx.switchTab({ url: '/pages/home/index' }); }, 300);
        } catch (error) {
          wx.hideLoading();
          this.showPairingFailure(error);
        } finally {
          this.setData({ scanning: false });
        }
      },
      fail: error => {
        if (!String(error.errMsg || '').includes('cancel')) wx.showToast({ title: '扫码失败，请重试', icon: 'none' });
        this.setData({ scanning: false });
      },
    });
  },
  openRegister() { this.setData({ registerOpen: true, registerName: '' }); },
  closeRegister() { this.setData({ registerOpen: false }); },
  setRegisterName(event) { this.setData({ registerName: String(event.detail.value || '').slice(0, 20) }); },
  registerAccount() {
    const name = String(this.data.registerName || '').trim();
    if (!name) { wx.showToast({ title: '请输入教师姓名', icon: 'none' }); return; }
    const random = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    const session = sessionStore.save({ account: { name, connectionId: `mini-${random}`.slice(0, 128), subjects: [] }, rooms: [], activeRoom: null, pairedAt: new Date().toISOString() });
    getApp().globalData.session = session;
    this.setData({ registerOpen: false });
    wx.showToast({ title: '账户创建成功', icon: 'success' });
    setTimeout(() => { if (!sharedRoom.resumePending()) wx.switchTab({ url: '/pages/home/index' }); }, 300);
  },
  showPairingFailure(error) {
    const code = error && error.code;
    if (code === 'PAIR_NETWORK') {
      wx.showModal({
        title: '无法连接教师端',
        content: [
          '请检查以下情况：',
          '1. 手机和电脑连接同一个 Wi‑Fi；',
          '2. 不要使用访客网络，并暂时关闭 VPN 或移动网络加速；',
          '3. 教师端保持运行，二维码未过期；',
          '4. 电脑防火墙允许教师端访问专用网络和 TCP 3457 端口。',
          '',
          '调整后请在教师端重新生成二维码。',
        ].join('\n'),
        cancelText: '稍后再试',
        confirmText: '重新扫码',
        success: result => {
          if (result.confirm) setTimeout(() => this.scanLogin(), 150);
        },
      });
      return;
    }
    if (code === 'PAIR_QR_EXPIRED') {
      wx.showModal({
        title: '二维码已过期',
        content: '临时二维码只有 2 分钟有效期。请在教师端点击“刷新二维码”，然后重新扫描。',
        cancelText: '稍后再试',
        confirmText: '重新扫码',
        success: result => {
          if (result.confirm) setTimeout(() => this.scanLogin(), 150);
        },
      });
      return;
    }
    wx.showModal({
      title: code === 'PAIR_UNSUPPORTED' ? '微信版本过低' : '二维码无法使用',
      content: error && error.message || '请在教师端重新生成二维码后再试。',
      showCancel: false,
      confirmText: '我知道了',
    });
  },
});
