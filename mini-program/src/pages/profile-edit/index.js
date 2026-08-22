const { sessionStore } = require('../../utils/session');
const cloudApi = require('../../utils/cloud');
const errorReport = require('../../utils/error-report');

function isRemoteAvatar(value) {
  return /^https?:\/\//i.test(String(value || '')) && !/^https?:\/\/tmp\//i.test(String(value || ''));
}

Page({
  data: {
    usageMode:'toc',
    organizationColor:'#2563EB',
    organizationName:'',
    profileAvatar:'',
    initial:'教',
    editName:'',
    profileBusy:false,
    storageTitle:'仅保存在当前设备',
    storageDetail:'不会读取手机号或其他微信资料。',
  },

  onLoad() {
    this.loadSession();
    this.themeHandler = () => this.applyNavigationTheme();
    if (wx.onThemeChange) wx.onThemeChange(this.themeHandler);
  },

  onUnload() {
    if (this.themeHandler && wx.offThemeChange) wx.offThemeChange(this.themeHandler);
  },

  applyNavigationTheme() {
    const app = getApp();
    const session = sessionStore.load();
    const organization = session && session.cloud && session.cloud.organization || {};
    if (app && app.globalData && app.globalData.applyNavigationTheme) app.globalData.applyNavigationTheme(undefined, session && session.cloud ? 'tob' : 'toc', organization.primaryColor);
  },

  loadSession() {
    const session = sessionStore.load();
    if (!session) { wx.reLaunch({ url:'/pages/login/index' }); return; }
    const cloud = session.cloud || null;
    const organization = cloud && cloud.organization || {};
    const name = cloud && (cloud.nickname || cloud.userName) || session.account.name || '';
    this.setData({
      usageMode:cloud ? 'tob' : 'toc',
      organizationColor:organization.primaryColor || '#2563EB',
      organizationName:organization.shortName || organization.name || '',
      profileAvatar:cloud && cloud.avatarUrl || session.account.avatarUrl || '',
      initial:String(name || '教').slice(0, 1),
      editName:name,
      storageTitle:cloud ? '同步到组织云端' : '仅保存在当前设备',
      storageDetail:cloud ? '组织内其他已登录设备会显示更新后的资料。' : '不会读取手机号或其他微信资料。',
    });
    this.applyNavigationTheme();
  },

  onNameInput(event) {
    this.setData({ editName:String(event.detail.value || '').trimStart().slice(0, 40) });
  },

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
    this.setData({ profileBusy:true });
    wx.showLoading({ title:'正在保存', mask:true });
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
      wx.hideLoading();
      this.setData({ profileBusy:false, profileAvatar:avatarUrl, initial:name.slice(0, 1) });
      wx.showToast({ title:'个人信息已保存', icon:'success' });
      setTimeout(() => wx.navigateBack(), 450);
    } catch (error) {
      wx.hideLoading();
      this.setData({ profileBusy:false });
      errorReport.show({ title:'个人信息保存失败', error, context:'个人信息', suggestions:['检查头像文件是否有效', '组织模式下请检查网络和服务器状态'] });
    }
  },
});
