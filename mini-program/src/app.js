const { sessionStore } = require('./utils/session');
const socket = require('./utils/socket');
const sharedRoom = require('./utils/shared-room');
const { parseDirectPairingLink } = require('./utils/auth');
const scanAction = require('./utils/scan-action');

App({
  globalData: {
    session: null,
    lastDirectRoomKey: '',
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
  openDirectEntry(options) {
    const query = options && options.query && typeof options.query === 'object' ? options.query : options || {};
    const pairingPayload = parseDirectPairingLink(query.q || options && options.q);
    if (pairingPayload) {
      const key = `teacher:${pairingPayload.slice(-24)}`;
      if (this.globalData.lastDirectRoomKey === key) return true;
      this.globalData.lastDirectRoomKey = key;
      setTimeout(() => scanAction.handleTeacherLogin(pairingPayload, null, () => {
        this.globalData.lastDirectRoomKey = '';
      }), 120);
      return true;
    }
    const room = sharedRoom.fromLaunchOptions(options);
    if (!room) return false;
    const key = `${room.connectionCode}:${room.name}`;
    if (this.globalData.lastDirectRoomKey === key) return true;
    this.globalData.lastDirectRoomKey = key;
    sharedRoom.savePending(room);
    setTimeout(() => {
      const pages = getCurrentPages();
      const current = pages.length ? pages[pages.length - 1].route : '';
      if (current === 'pages/room-connect/index') return;
      wx.navigateTo({
        url: sharedRoom.createPath(room),
        fail: () => { this.globalData.lastDirectRoomKey = ''; },
      });
    }, 120);
    return true;
  },
  onLaunch(options) {
    this.globalData.session = sessionStore.load();
    this.globalData.applyNavigationTheme();
    this.themeHandler = ({ theme }) => this.globalData.applyNavigationTheme(theme);
    if (wx.onThemeChange) wx.onThemeChange(this.themeHandler);
    // 页面切换不会触发 App.onShow；在路由变化时再次应用，避免首页与“我的”沿用不同的标题栏颜色。
    if (wx.onAppRoute) wx.onAppRoute(() => this.globalData.applyNavigationTheme());
    this.openDirectEntry(options);
  },
  onShow(options) {
    this.globalData.applyNavigationTheme();
    const session = sessionStore.load();
    this.globalData.session = session;
    if (session && session.account && session.activeRoom) socket.connect(session.activeRoom, session.account);
    this.openDirectEntry(options);
  },
  onHide() {
    socket.pauseHeartbeat();
  },
});
