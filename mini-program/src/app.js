const { sessionStore } = require('./utils/session');
const socket = require('./utils/socket');

App({
  globalData: {
    session: null,
    applyNavigationTheme(theme) {
      if (!wx.setNavigationBarColor) return;
      let currentTheme = theme;
      if (!currentTheme) {
        try { currentTheme = wx.getSystemInfoSync().theme || 'light'; } catch (_error) { currentTheme = 'light'; }
      }
      wx.setNavigationBarColor({
        frontColor: currentTheme === 'dark' ? '#ffffff' : '#000000',
        backgroundColor: currentTheme === 'dark' ? '#111111' : '#f5f5f5',
      });
    },
  },
  onLaunch() {
    this.globalData.session = sessionStore.load();
    this.globalData.applyNavigationTheme();
    this.themeHandler = ({ theme }) => this.globalData.applyNavigationTheme(theme);
    if (wx.onThemeChange) wx.onThemeChange(this.themeHandler);
    // 页面切换不会触发 App.onShow；在路由变化时再次应用，避免首页与“我的”沿用不同的标题栏颜色。
    if (wx.onAppRoute) wx.onAppRoute(() => this.globalData.applyNavigationTheme());
  },
  onShow() {
    this.globalData.applyNavigationTheme();
    const session = sessionStore.load();
    this.globalData.session = session;
    if (session && session.account && session.activeRoom) socket.connect(session.activeRoom, session.account);
  },
  onHide() {
    socket.pauseHeartbeat();
  },
});
