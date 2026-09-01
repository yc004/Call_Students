const socket = require('../../utils/socket');
const { sessionStore } = require('../../utils/session');
const cloudApi = require('../../utils/cloud');

Page({
  data: {
    account: { name:'教师', subjects:[] },
    initial:'教',
    roleText:'教师账户',
    cloudNickname:'',
    profileAvatar:'',
    avatarLoadFailed:false,
    usageMode:'toc',
    organizationColor:'#2563EB',
    organizationName:'',
    connectionId:'',
    versionText:'开发版本',
  },
  onLoad() {
    this.applyNavigationTheme();
    this.themeHandler = ({ theme }) => this.applyNavigationTheme(theme);
    if (wx.onThemeChange) wx.onThemeChange(this.themeHandler);
    this.loadSession();
  },
  onShow() { this.loadSession(); if (this.getTabBar) this.getTabBar().refresh('profile'); },
  onCloudSessionUpdated() { this.loadSession(); },
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
    let versionText='开发版本';
    try { const info=wx.getAccountInfoSync&&wx.getAccountInfoSync();versionText=info&&info.miniProgram&&(info.miniProgram.version||info.miniProgram.envVersion)||versionText; } catch (_error) {}
    this.setData({
      account: { ...session.account, subjects: [] },
      initial: String((cloud && cloud.nickname) || session.account.name || '教').slice(0, 1),
      roleText: cloud ? '组织教师账户' : '个人免费账户',
      cloudNickname: cloud && (cloud.nickname || cloud.userName) || '',
      profileAvatar: (cloud && cloud.avatarUrl) || session.account.avatarUrl || '',
      avatarLoadFailed:false,
      usageMode:cloud?'tob':'toc',
      organizationColor:organization.primaryColor||'#2563EB',
      organizationName:organization.name||'',
      connectionId:session.account.connectionId||'',
      versionText,
    });
    this.applyNavigationTheme();
  },
  onAvatarError() { this.setData({ avatarLoadFailed:true }); },
  openProfileEditor() { wx.navigateTo({ url:'/pages/profile-edit/index' }); },
  showPrivacy(){wx.showModal({title:'隐私与数据边界',content:'个人模式资料保存在当前微信设备；教室连接信息仅用于局域网通信。人脸图片、特征和识别结果只保存在教室电脑，不上传到组织云端。',showCancel:false,confirmText:'知道了'});},
  showHelp(){wx.showModal({title:'使用帮助',content:'连接教室遇到问题时，请确认手机与教室电脑位于同一局域网，并允许微信访问本地网络。组织账号问题请联系学校或机构管理员。',showCancel:false,confirmText:'知道了'});},
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
