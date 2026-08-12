const { sessionStore } = require('./utils/session');
const socket = require('./utils/socket');

App({
  globalData: { session: null },
  onLaunch() {
    this.globalData.session = sessionStore.load();
  },
  onShow() {
    const session = sessionStore.load();
    this.globalData.session = session;
    if (session && session.account && session.activeRoom) socket.connect(session.activeRoom, session.account);
  },
  onHide() {
    socket.pauseHeartbeat();
  },
});
