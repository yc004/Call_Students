const socket = require('../../utils/socket');
const { sessionStore } = require('../../utils/session');
const cloudApi = require('../../utils/cloud');

Page({
  data: {
    account: { name:'教师', subjects:[] },
    initial:'教',
    roleText:'教师账户',
    subjectTags:[],
    cloudConnected:false,
    cloudServerUrl:'',
    cloudUserId:'',
    cloudNickname:'',
    cloudAvatar:'',
    cloudBusy:false,
  },
  onLoad() {
    this.applyNavigationTheme();
    this.themeHandler = ({ theme }) => this.applyNavigationTheme(theme);
    if (wx.onThemeChange) wx.onThemeChange(this.themeHandler);
    this.loadSession();
  },
  onShow() { this.applyNavigationTheme(); this.loadSession(); if (this.getTabBar) this.getTabBar().refresh('profile'); },
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
  loadSession() {
    const session = sessionStore.load();
    if (!session) { wx.reLaunch({ url:'/pages/login/index' }); return; }
    const cloud = session.cloud || null;
    this.setData({
      account: { ...session.account, subjects: [] },
      initial: String((cloud && cloud.nickname) || session.account.name || '教').slice(0, 1),
      roleText: '教师账户',
      subjectTags: [],
      cloudConnected: !!cloud,
      cloudServerUrl: cloud && cloud.serverUrl || '',
      cloudUserId: cloud && cloud.userId || '',
      cloudNickname: cloud && (cloud.nickname || cloud.userName) || '',
      cloudAvatar: cloud && cloud.avatarUrl || '',
    });
  },
  openCloudAuth() { wx.navigateTo({ url:'/pages/login/index?from=cloud' }); },
  async refreshCloud() {
    if (this.data.cloudBusy) return;
    const current = sessionStore.load();
    if (!current || !current.cloud) return;
    this.setData({ cloudBusy:true });
    wx.showLoading({ title:'正在同步', mask:true });
    try {
      let cloud = current.cloud;
      const expires = new Date(cloud.accessExpiresAt || 0).getTime();
      if (!Number.isFinite(expires) || expires <= Date.now() + 60000) cloud = await cloudApi.refreshSession(cloud);
      const rooms = await cloudApi.listClassrooms(cloud);
      const session = sessionStore.updateCloud(cloud, rooms);
      getApp().globalData.session = session;
      wx.hideLoading();
      this.setData({ cloudBusy:false });
      this.loadSession();
      wx.showToast({ title:'已同步 ' + rooms.length + ' 个教室', icon:'none' });
    } catch (error) {
      wx.hideLoading();
      this.setData({ cloudBusy:false });
      wx.showModal({ title:'同步失败', content:error.message || '请检查云服务连接。', showCancel:false });
    }
  },
  disconnectCloud() {
    wx.showModal({
      title:'断开云服务？',
      content:'将移除本机云端登录凭证和云教室列表，局域网教室不受影响。',
      confirmColor:'#DC2626',
      success: async result => {
        if (!result.confirm) return;
        const current = sessionStore.load();
        try { await cloudApi.logout(current.cloud); } catch (_error) {}
        const localRooms = (current.rooms || []).filter(room => room.transport !== 'cloud');
        const session = sessionStore.save({ ...current, cloud:null, rooms:localRooms, activeRoom:localRooms[0] || null });
        getApp().globalData.session = session;
        this.loadSession();
        wx.showToast({ title:'已断开云服务', icon:'none' });
      },
    });
  },
  logout() {
    wx.showModal({
      title: '确认退出登录？',
      content: '当前教师账户、已保存的教室连接和授课科目仅离线保存在这台微信设备上。退出后这些本地数据会被全部清除且无法恢复，之后需要重新登录并添加教室。教室端的班级资料不会被删除。',
      confirmText: '仍要退出',
      cancelText: '暂不退出',
      confirmColor: '#DC2626',
      success: async result => {
        if (!result.confirm) return;
        const current = sessionStore.load();
        if (current && current.cloud) { try { await cloudApi.logout(current.cloud); } catch (_error) {} }
        socket.disconnect();
        sessionStore.clear();
        getApp().globalData.session = null;
        wx.reLaunch({ url: '/pages/login/index' });
      },
    });
  },
});
