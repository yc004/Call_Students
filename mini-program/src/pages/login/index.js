const { parseLoginQr } = require('../../utils/auth');
const { sessionStore } = require('../../utils/session');

Page({
  data: { scanning: false },
  onShow() {
    if (sessionStore.load()) wx.switchTab({ url: '/pages/call/index' });
  },
  scanLogin() {
    if (this.data.scanning) return;
    this.setData({ scanning: true });
    wx.scanCode({
      scanType: ['qrCode'],
      success: ({ result }) => {
        try {
          const session = parseLoginQr(result);
          sessionStore.save(session);
          getApp().globalData.session = session;
          wx.showToast({ title: `欢迎，${session.account.name}`, icon: 'success' });
          setTimeout(() => wx.switchTab({ url: '/pages/call/index' }), 300);
        } catch (error) {
          wx.showModal({ title: '无法登录', content: error.message || '二维码无效', showCancel: false });
        }
      },
      fail: error => {
        if (!String(error.errMsg || '').includes('cancel')) wx.showToast({ title: '扫码失败，请重试', icon: 'none' });
      },
      complete: () => this.setData({ scanning: false }),
    });
  },
});
