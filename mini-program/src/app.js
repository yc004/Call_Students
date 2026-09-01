const { sessionStore } = require('./utils/session');
const socket = require('./utils/socket');
const sharedRoom = require('./utils/shared-room');
const { parseDirectPairingLink } = require('./utils/auth');
const scanAction = require('./utils/scan-action');
const cloudApi = require('./utils/cloud');
const { clearLocalServiceCache } = require('./utils/local-service');
const errorReport = require('./utils/error-report');

App({
  globalData: {
    session: null,
    lastDirectRoomKey: '',
    applyNavigationTheme(theme, usageMode, organizationColor) {
      if (!wx.setNavigationBarColor) return;
      if (!usageMode) {
        const session = sessionStore.load();
        const organization = session && session.cloud && session.cloud.organization || {};
        usageMode = session && session.cloud ? 'tob' : 'toc';
        organizationColor = organizationColor || organization.primaryColor;
      }
      let currentTheme = theme;
      if (!currentTheme) {
        try { currentTheme = wx.getSystemInfoSync().theme || 'light'; } catch (_error) { currentTheme = 'light'; }
      }
      const modeColor=/^#[0-9A-Fa-f]{6}$/.test(String(organizationColor||''))?organizationColor:'#2563EB';
      const rgb=modeColor.match(/[0-9A-Fa-f]{2}/g)||[];
      const brightness=rgb.length===3?(Number.parseInt(rgb[0],16)*299+Number.parseInt(rgb[1],16)*587+Number.parseInt(rgb[2],16)*114)/1000:0;
      wx.setNavigationBarColor({
        frontColor: currentTheme === 'dark' ? '#ffffff' : usageMode === 'tob' && brightness < 165 ? '#ffffff' : '#000000',
        backgroundColor: currentTheme === 'dark' ? '#111111' : usageMode === 'tob' ? modeColor : '#f5f5f5',
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
  restoreCloudConnection(session) {
    if (!session || !session.account || !session.cloud) {
      if (session && session.account && session.activeRoom) socket.connect(session.activeRoom, session.account);
      return Promise.resolve(session);
    }
    if (this.cloudRestorePromise) return this.cloudRestorePromise;
    this.cloudRestorePromise = (async () => {
      let cloud = session.cloud;
      const expiresAt = new Date(cloud.accessExpiresAt || 0).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60000) cloud = await cloudApi.refreshSession(cloud);
      // 教室是首页核心数据，不能被头像、个人资料或科目配置的单项异常阻塞。
      const rooms = await cloudApi.listClassrooms(cloud);
      const [profileResult, subjectsResult] = await Promise.allSettled([
        cloudApi.getTeacherProfile(cloud),
        cloudApi.listSubjects(cloud),
      ]);
      if (profileResult.status === 'fulfilled') cloud = profileResult.value;
      if (subjectsResult.status === 'fulfilled') cloud.availableSubjects = subjectsResult.value;
      if (cloud.mustChangePassword) {
        const updated = sessionStore.updateCloud(cloud, rooms) || sessionStore.load();
        this.globalData.session = updated;
        wx.reLaunch({ url:'/pages/login/index?from=cloud' });
        return updated;
      }
      const updated = sessionStore.updateCloud(cloud, rooms) || sessionStore.load();
      this.globalData.session = updated;
      if (updated && updated.activeRoom) socket.connect(updated.activeRoom, updated.account, { force:true, skipCloudRefresh:true });
      this.notifyCloudSessionUpdated(updated);
      return updated;
    })().catch(error => {
      const accessExpired = new Date(session.cloud && session.cloud.accessExpiresAt || 0).getTime() <= Date.now();
      if (error && (error.statusCode === 401 || accessExpired && /超时|网络|连接/.test(String(error.message || '')))) {
        socket.disconnect();
        sessionStore.clear();
        this.globalData.session = null;
        wx.reLaunch({ url:'/pages/login/index?from=cloud&expired=1' });
        return null;
      }
      if (session.activeRoom) socket.connect(session.activeRoom, session.account);
      return session;
    }).finally(() => { this.cloudRestorePromise = null; });
    return this.cloudRestorePromise;
  },
  notifyCloudSessionUpdated(session) {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    pages.forEach(page => {
      if (page && typeof page.onCloudSessionUpdated === 'function') page.onCloudSessionUpdated(session);
    });
  },
  onLaunch(options) {
    this.globalData.session = sessionStore.load();
    this.globalData.applyNavigationTheme();
    this.themeHandler = ({ theme }) => this.globalData.applyNavigationTheme(theme);
    if (wx.onThemeChange) wx.onThemeChange(this.themeHandler);
    // 页面切换不会触发 App.onShow；在路由变化时再次应用，避免首页与“我的”沿用不同的标题栏颜色。
    if (wx.onAppRoute) wx.onAppRoute(() => this.globalData.applyNavigationTheme());
    // Wi-Fi、热点或蜂窝网络切换后，旧的 mDNS 解析地址不再可信。
    if (wx.onNetworkStatusChange) wx.onNetworkStatusChange(() => clearLocalServiceCache());
    this.openDirectEntry(options);
  },
  onShow(options) {
    this.globalData.applyNavigationTheme();
    const session = sessionStore.load();
    this.globalData.session = session;
    this.restoreCloudConnection(session);
    this.openDirectEntry(options);
  },
  onHide() {
    socket.pauseHeartbeat();
  },
  onError(error) {
    errorReport.show({ title:'小程序发生运行错误', message:'页面遇到未预期的问题，部分功能可能暂时不可用。', context:'小程序运行', error, suggestions:['返回首页后重试刚才的操作', '如果问题重复出现，请复制错误信息并提交给管理员'] });
  },
  onUnhandledRejection(event) {
    errorReport.show({ title:'小程序请求处理失败', message:'请求没有正常完成，请检查网络连接后重试。', context:'异步请求', error:event && event.reason || event, suggestions:['检查手机网络以及教室端或云服务状态', '稍后重试；若仍失败，请复制错误信息提交管理员'] });
  },
});
