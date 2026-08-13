const socket = require('../../utils/socket');
const { sessionStore } = require('../../utils/session');

Page({
  data: { account:{ name:'教师',subjects:[] },initial:'教',roleText:'教师账户',subjectTags:[] },
  onLoad() {
    this.applyNavigationTheme();
    this.themeHandler = ({ theme }) => this.applyNavigationTheme(theme);
    if (wx.onThemeChange) wx.onThemeChange(this.themeHandler);
    this.loadSession();
  },
  onShow() { this.applyNavigationTheme(); this.loadSession(); if(this.getTabBar)this.getTabBar().refresh('profile'); },
  onUnload() { if (this.themeHandler && wx.offThemeChange) wx.offThemeChange(this.themeHandler); },
  applyNavigationTheme(theme) {
    const app = getApp();
    if (app && app.globalData && app.globalData.applyNavigationTheme) {
      app.globalData.applyNavigationTheme(theme);
      return;
    }
    if (!wx.setNavigationBarColor) return;
    let currentTheme = theme || 'light';
    if (!theme) { try { currentTheme = wx.getSystemInfoSync().theme || 'light'; } catch (_error) {} }
    wx.setNavigationBarColor({ frontColor: currentTheme === 'dark' ? '#ffffff' : '#000000', backgroundColor: currentTheme === 'dark' ? '#111111' : '#f5f5f5' });
  },
  loadSession() { const session = sessionStore.load(); if (!session) { wx.reLaunch({ url:'/pages/login/index' }); return; } this.setData({ account:{ ...session.account,subjects:[] },initial:String(session.account.name || '教').slice(0,1),roleText:'教师账户',subjectTags:[] }); },
  logout() {
    wx.showModal({
      title: '确认退出登录？',
      content: '当前教师账户、已保存的教室连接和授课科目仅离线保存在这台微信设备上。退出后这些本地数据会被全部清除且无法恢复，之后需要重新登录并添加教室。教室端的班级资料不会被删除。',
      confirmText: '仍要退出',
      cancelText: '暂不退出',
      confirmColor: '#DC2626',
      success: result => {
        if (!result.confirm) return;
        socket.disconnect();
        sessionStore.clear();
        getApp().globalData.session = null;
        wx.reLaunch({ url: '/pages/login/index' });
      },
    });
  },
});
