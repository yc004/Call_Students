const socket = require('../../utils/socket');
const { sessionStore } = require('../../utils/session');
const cloudApi = require('../../utils/cloud');
const errorReport = require('../../utils/error-report');

function isRemoteAvatar(value) {
  return /^https?:\/\//i.test(String(value || '')) && !/^https?:\/\/tmp\//i.test(String(value || ''));
}

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
    profileAvatar:'',
    editName:'',
    profileBusy:false,
    currentPassword:'',
    newPassword:'',
    confirmPassword:'',
    cloudBusy:false,
    usageMode:'toc',
    organizationName:'',
    organizationShortName:'',
    organizationColor:'#2563EB',
  },
  onLoad() {
    this.applyNavigationTheme();
    this.themeHandler = ({ theme }) => this.applyNavigationTheme(theme);
    if (wx.onThemeChange) wx.onThemeChange(this.themeHandler);
    this.loadSession();
  },
  onShow() { this.loadSession(); if (this.getTabBar) this.getTabBar().refresh('profile'); },
  onUnload() { if (this.themeHandler && wx.offThemeChange) wx.offThemeChange(this.themeHandler); },
  applyNavigationTheme(theme) {
    const app = getApp();
    if (app && app.globalData && app.globalData.applyNavigationTheme) {
      const session=sessionStore.load();const organization=session&&session.cloud&&session.cloud.organization||{};
      app.globalData.applyNavigationTheme(theme,session&&session.cloud?'tob':'toc',organization.primaryColor);
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
    const organization=cloud&&cloud.organization||{};
    this.setData({
      account: { ...session.account, subjects: [] },
      initial: String((cloud && cloud.nickname) || session.account.name || '教').slice(0, 1),
      roleText: cloud ? '组织教师账户' : '个人免费账户',
      subjectTags: [],
      cloudConnected: !!cloud,
      cloudServerUrl: cloud && cloud.serverUrl || '',
      cloudUserId: cloud && cloud.userId || '',
      cloudNickname: cloud && (cloud.nickname || cloud.userName) || '',
      profileAvatar: (cloud && cloud.avatarUrl) || session.account.avatarUrl || '',
      editName: (cloud && (cloud.nickname || cloud.userName)) || session.account.name || '',
      usageMode:cloud?'tob':'toc',
      organizationName:organization.name||'',
      organizationShortName:organization.shortName||organization.name||'',
      organizationColor:organization.primaryColor||'#2563EB',
    });
    this.applyNavigationTheme();
  },
  onNameInput(event) { this.setData({ editName:String(event.detail.value || '').trimStart().slice(0, 40) }); },
  onCurrentPasswordInput(event) { this.setData({ currentPassword:String(event.detail.value || '') }); },
  onNewPasswordInput(event) { this.setData({ newPassword:String(event.detail.value || '') }); },
  onConfirmPasswordInput(event) { this.setData({ confirmPassword:String(event.detail.value || '') }); },
  onChooseAvatar(event) {
    const profileAvatar = event.detail && event.detail.avatarUrl || '';
    if (profileAvatar) this.setData({ profileAvatar });
  },
  persistLocalAvatar(filePath) {
    if (!filePath || isRemoteAvatar(filePath) || (wx.env && filePath.startsWith(wx.env.USER_DATA_PATH))) return Promise.resolve(filePath || '');
    return new Promise((resolve, reject) => wx.getFileSystemManager().saveFile({ tempFilePath:filePath, success:result=>resolve(result.savedFilePath), fail:reject }));
  },
  async saveProfile() {
    if (this.data.profileBusy) return;
    const session = sessionStore.load();
    const name = this.data.editName.trim();
    if (!session || !name) { wx.showToast({ title:'请输入用户名', icon:'none' }); return; }
    this.setData({ profileBusy:true }); wx.showLoading({ title:'正在保存资料', mask:true });
    try {
      let avatarUrl = this.data.profileAvatar || '';
      let cloud = session.cloud;
      if (cloud) {
        if (avatarUrl && !isRemoteAvatar(avatarUrl)) {
          const uploaded = await cloudApi.uploadAvatar(cloud, avatarUrl);
          avatarUrl = uploaded.url || cloud.avatarUrl || '';
          cloud = { ...cloud, avatarUrl };
        }
        if (name !== (cloud.nickname || cloud.userName)) cloud = await cloudApi.updateTeacherProfile(cloud, { name });
        cloud = { ...cloud, avatarUrl };
      } else {
        avatarUrl = await this.persistLocalAvatar(avatarUrl);
      }
      const account = { ...session.account, name, avatarUrl };
      const updated = sessionStore.save({ ...session, account, cloud:cloud || null });
      getApp().globalData.session = updated;
      wx.hideLoading(); this.setData({ profileBusy:false }); this.loadSession();
      wx.showToast({ title:'个人资料已保存', icon:'success' });
    } catch (error) {
      wx.hideLoading(); this.setData({ profileBusy:false });
      errorReport.show({ title:'个人资料保存失败', error, context:'我的－个人资料', suggestions:['检查头像文件是否有效', '组织模式下请检查网络和服务器状态'] });
    }
  },
  async changePassword() {
    if (this.data.profileBusy || !this.data.cloudConnected) return;
    const session = sessionStore.load();
    const currentPassword = this.data.currentPassword;
    const newPassword = this.data.newPassword;
    if (!currentPassword) { wx.showToast({ title:'请输入当前密码', icon:'none' }); return; }
    if (newPassword.length < 10) { wx.showToast({ title:'新密码至少 10 位', icon:'none' }); return; }
    if (newPassword !== this.data.confirmPassword) { wx.showToast({ title:'两次新密码输入不一致', icon:'none' }); return; }
    this.setData({ profileBusy:true }); wx.showLoading({ title:'正在修改密码', mask:true });
    try {
      const cloud = await cloudApi.updateTeacherProfile(session.cloud, { currentPassword, newPassword });
      const updated = sessionStore.save({ ...session, cloud });
      getApp().globalData.session = updated;
      wx.hideLoading(); this.setData({ profileBusy:false,currentPassword:'',newPassword:'',confirmPassword:'' });
      wx.showToast({ title:'密码已修改', icon:'success' });
    } catch (error) {
      wx.hideLoading(); this.setData({ profileBusy:false });
      errorReport.show({ title:'密码修改失败', error, context:'我的－账户安全', suggestions:['确认当前密码输入正确', '新密码至少需要 10 位且不要与旧密码相同'] });
    }
  },
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
      cloud = await cloudApi.getTeacherProfile(cloud);
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
      errorReport.show({ title:'云端数据同步失败', error, context:'我的－同步组织数据', suggestions:['检查当前网络和组织服务器状态', '确认登录没有过期，必要时重新登录组织'] });
    }
  },
  logout() {
    wx.showModal({
      title: '确认退出登录？',
      content: this.data.usageMode === 'toc' ? '个人模式的数据只保存在当前微信设备。退出后教师身份、教室连接和设置都会被清除且无法恢复。' : '退出后会删除本机登录凭证，但组织云端的账号、教室和教学数据不会被删除。',
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
