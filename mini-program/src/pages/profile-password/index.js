const { sessionStore } = require('../../utils/session');
const cloudApi = require('../../utils/cloud');
const errorReport = require('../../utils/error-report');

Page({
  data: {
    organizationColor:'#2563EB',
    currentPassword:'',
    newPassword:'',
    confirmPassword:'',
    busy:false,
  },

  onLoad() {
    const session = sessionStore.load();
    if (!session || !session.cloud) { wx.navigateBack(); return; }
    const organization = session.cloud.organization || {};
    this.setData({ organizationColor:organization.primaryColor || '#2563EB' });
    this.applyNavigationTheme();
  },

  applyNavigationTheme() {
    const app = getApp();
    const session = sessionStore.load();
    const organization = session && session.cloud && session.cloud.organization || {};
    if (app && app.globalData && app.globalData.applyNavigationTheme) app.globalData.applyNavigationTheme(undefined, 'tob', organization.primaryColor);
  },

  onCurrentPasswordInput(event) { this.setData({ currentPassword:String(event.detail.value || '') }); },
  onNewPasswordInput(event) { this.setData({ newPassword:String(event.detail.value || '') }); },
  onConfirmPasswordInput(event) { this.setData({ confirmPassword:String(event.detail.value || '') }); },

  async changePassword() {
    if (this.data.busy) return;
    const session = sessionStore.load();
    const currentPassword = this.data.currentPassword;
    const newPassword = this.data.newPassword;
    if (!session || !session.cloud) { wx.showToast({ title:'登录状态已失效', icon:'none' }); return; }
    if (!currentPassword) { wx.showToast({ title:'请输入当前密码', icon:'none' }); return; }
    if (newPassword.length < 10) { wx.showToast({ title:'新密码至少 10 位', icon:'none' }); return; }
    if (newPassword !== this.data.confirmPassword) { wx.showToast({ title:'两次新密码输入不一致', icon:'none' }); return; }
    this.setData({ busy:true });
    wx.showLoading({ title:'正在修改密码', mask:true });
    try {
      const cloud = await cloudApi.updateTeacherProfile(session.cloud, { currentPassword, newPassword });
      const updated = sessionStore.save({ ...session, cloud });
      getApp().globalData.session = updated;
      wx.hideLoading();
      this.setData({ busy:false, currentPassword:'', newPassword:'', confirmPassword:'' });
      wx.showToast({ title:'密码已修改', icon:'success' });
      setTimeout(() => wx.navigateBack(), 450);
    } catch (error) {
      wx.hideLoading();
      this.setData({ busy:false });
      errorReport.show({ title:'密码修改失败', error, context:'个人信息－修改密码', suggestions:['确认当前密码输入正确', '新密码至少需要 10 位且不要与旧密码相同'] });
    }
  },
});
