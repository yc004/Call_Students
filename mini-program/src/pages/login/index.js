const { pairWithTeacher, loadPendingPairing, clearPendingPairing } = require('../../utils/auth');
const { sessionStore, hashPassword, verifyPassword } = require('../../utils/session');
const cloudApi = require('../../utils/cloud');
const sharedRoom = require('../../utils/shared-room');

const LOCAL_ACCOUNTS_KEY = 'classroom_call_local_accounts_v1';

function genConnectionId() {
  const random = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
  return ('mini-' + random).slice(0, 128);
}

function loadLocalAccounts() {
  try { return wx.getStorageSync(LOCAL_ACCOUNTS_KEY) || []; }
  catch (_error) { return []; }
}

function saveLocalAccounts(accounts) {
  wx.setStorageSync(LOCAL_ACCOUNTS_KEY, accounts);
}

Page({
  data: {
    scanning: false,
    mode: 'local',
    localTab: 'register',
    cloudTab: 'register',
    localName: '',
    localLoginName: '',
    localPassword: '',
    localConfirmPassword: '',
    cloudServerUrl: '',
    cloudKey: '',
    cloudLoginName: '',
    cloudPassword: '',
    cloudNickname: '',
    cloudAvatar: '',
    busy: false,
  },

  onLoad(options) {
    this.fromRoomShare = !!(options && options.from === 'roomShare');
    this.fromCloud = !!(options && options.from === 'cloud');
    if (this.fromCloud) this.setData({ mode: 'cloud' });
  },

  onShow() {
    if (this.fromCloud) return;
    if (!sessionStore.load()) return;
    const pendingPairing = loadPendingPairing();
    if (pendingPairing) { this.completePendingPairing(pendingPairing); return; }
    if (this.fromRoomShare && sharedRoom.resumePending()) return;
    wx.switchTab({ url: '/pages/home/index' });
  },

  setMode(event) { this.setData({ mode: event.currentTarget.dataset.mode }); },
  setLocalTab(event) { this.setData({ localTab: event.currentTarget.dataset.tab }); },
  setCloudTab(event) { this.setData({ cloudTab: event.currentTarget.dataset.tab }); },

  onLocalNameInput(event) { this.setData({ localName: String(event.detail.value || '').slice(0, 20) }); },
  onLocalLoginNameInput(event) { this.setData({ localLoginName: String(event.detail.value || '').trim().slice(0, 40) }); },
  onLocalPasswordInput(event) { this.setData({ localPassword: String(event.detail.value || '') }); },
  onLocalConfirmInput(event) { this.setData({ localConfirmPassword: String(event.detail.value || '') }); },

  onCloudServerInput(event) { this.setData({ cloudServerUrl: String(event.detail.value || '').trim().slice(0, 500) }); },
  onCloudKeyInput(event) { this.setData({ cloudKey: String(event.detail.value || '').trim().slice(0, 300) }); },
  onCloudLoginNameInput(event) { this.setData({ cloudLoginName: String(event.detail.value || '').trim().slice(0, 40) }); },
  onCloudPasswordInput(event) { this.setData({ cloudPassword: String(event.detail.value || '') }); },
  onCloudNicknameInput(event) { this.setData({ cloudNickname: String(event.detail.value || '').trim().slice(0, 40) }); },
  onChooseAvatar(event) { this.setData({ cloudAvatar: event.detail.avatarUrl || '' }); },

  registerLocal() {
    const name = this.data.localName.trim();
    const loginName = (this.data.localLoginName || name).trim();
    const password = this.data.localPassword;
    if (!name) { wx.showToast({ title: '请输入教师姓名', icon: 'none' }); return; }
    if (!loginName) { wx.showToast({ title: '请输入登录账号', icon: 'none' }); return; }
    if (!password || password.length < 6) { wx.showToast({ title: '密码至少 6 位', icon: 'none' }); return; }
    if (password !== this.data.localConfirmPassword) { wx.showToast({ title: '两次密码不一致', icon: 'none' }); return; }
    const accounts = loadLocalAccounts();
    if (accounts.some(item => item.loginName === loginName)) { wx.showToast({ title: '该账号已注册', icon: 'none' }); return; }
    const account = { name, loginName, connectionId: genConnectionId(), subjects: [], passwordHash: hashPassword(password) };
    accounts.push(account);
    saveLocalAccounts(accounts);
    const session = sessionStore.save({ account, rooms: [], activeRoom: null, cloud: null, pairedAt: new Date().toISOString() });
    getApp().globalData.session = session;
    this.afterLogin();
  },

  loginLocal() {
    const loginName = this.data.localLoginName.trim() || this.data.localName.trim();
    const password = this.data.localPassword;
    if (!loginName) { wx.showToast({ title: '请输入账号或姓名', icon: 'none' }); return; }
    const account = loadLocalAccounts().find(item => item.loginName === loginName || item.name === loginName);
    if (!account) { wx.showToast({ title: '账号不存在', icon: 'none' }); return; }
    if (account.passwordHash && !verifyPassword(password, account.passwordHash)) { wx.showToast({ title: '密码错误', icon: 'none' }); return; }
    const session = sessionStore.save({ account, rooms: [], activeRoom: null, cloud: null, pairedAt: new Date().toISOString() });
    getApp().globalData.session = session;
    this.afterLogin();
  },

  async registerCloud() {
    if (this.data.busy) return;
    const serverUrl = this.data.cloudServerUrl;
    const key = this.data.cloudKey;
    const loginName = this.data.cloudLoginName;
    const password = this.data.cloudPassword;
    const nickname = this.data.cloudNickname || this.data.cloudLoginName;
    if (!serverUrl || !key || !loginName || !password || password.length < 10) { wx.showToast({ title: '请完整填写服务器地址、密钥、账号和至少 10 位密码', icon: 'none' }); return; }
    let localAccount = sessionStore.load() && sessionStore.load().account;
    if (!localAccount) localAccount = { name: nickname, loginName, connectionId: genConnectionId(), subjects: [] };
    this.setData({ busy: true });
    wx.showLoading({ title: '正在注册云服务', mask: true });
    try {
      let cloud = await cloudApi.registerMiniProgramAccount({ serverUrl, key, loginName, password, nickname, legacyConnectionId: localAccount.connectionId, deviceName: '微信小程序' });
      if (this.data.cloudAvatar) {
        try { const upload = await cloudApi.uploadAvatar(cloud, this.data.cloudAvatar); cloud = { ...cloud, avatarUrl: upload.url }; }
        catch (_error) { /* 头像失败不阻断注册 */ }
      }
      const rooms = await cloudApi.listClassrooms(cloud);
      const account = { name: cloud.userName || nickname, loginName, connectionId: localAccount.connectionId, subjects: [], passwordHash: hashPassword(password) };
      const session = sessionStore.save({ account, rooms, activeRoom: rooms[0] || null, cloud, pairedAt: new Date().toISOString() });
      getApp().globalData.session = session;
      wx.hideLoading();
      this.setData({ busy: false });
      this.afterLogin('云账号注册成功');
    } catch (error) {
      wx.hideLoading();
      this.setData({ busy: false });
      wx.showModal({ title: '云服务注册失败', content: error.message || '请检查服务器地址、密钥和网络后重试。', showCancel: false });
    }
  },

  async loginCloud() {
    if (this.data.busy) return;
    const serverUrl = this.data.cloudServerUrl;
    const loginName = this.data.cloudLoginName;
    const password = this.data.cloudPassword;
    if (!serverUrl || !loginName || !password) { wx.showToast({ title: '请输入服务器地址、账号和密码', icon: 'none' }); return; }
    this.setData({ busy: true });
    wx.showLoading({ title: '正在登录云服务', mask: true });
    try {
      const cloud = await cloudApi.loginMiniProgramAccount({ serverUrl, loginName, password, deviceName: '微信小程序' });
      const rooms = await cloudApi.listClassrooms(cloud);
      const localAccount = sessionStore.load() ? sessionStore.load().account : { name: cloud.userName, loginName, connectionId: genConnectionId(), subjects: [] };
      const account = { ...localAccount, name: cloud.userName || localAccount.name, loginName };
      const session = sessionStore.save({ account, rooms, activeRoom: rooms[0] || null, cloud, pairedAt: new Date().toISOString() });
      getApp().globalData.session = session;
      wx.hideLoading();
      this.setData({ busy: false });
      this.afterLogin('云账号登录成功');
    } catch (error) {
      wx.hideLoading();
      this.setData({ busy: false });
      wx.showModal({ title: '云服务登录失败', content: error.message || '请检查账号、密码和服务器地址。', showCancel: false });
    }
  },

  async wechatLogin() {
    if (this.data.busy) return;
    const serverUrl = this.data.cloudServerUrl;
    if (!serverUrl) { wx.showToast({ title: '请输入服务器地址', icon: 'none' }); return; }
    wx.login({
      success: async loginRes => {
        if (!loginRes || !loginRes.code) { wx.showToast({ title: '微信登录失败', icon: 'none' }); return; }
        this.setData({ busy: true });
        wx.showLoading({ title: '微信登录中', mask: true });
        try {
          const cloud = await cloudApi.wechatLogin({ serverUrl, code: loginRes.code, deviceName: '微信小程序' });
          const rooms = await cloudApi.listClassrooms(cloud);
          const localAccount = sessionStore.load() ? sessionStore.load().account : { name: cloud.userName, loginName: cloud.userName, connectionId: genConnectionId(), subjects: [] };
          const session = sessionStore.save({ account: { ...localAccount, name: cloud.userName || localAccount.name }, rooms, activeRoom: rooms[0] || null, cloud, pairedAt: new Date().toISOString() });
          getApp().globalData.session = session;
          wx.hideLoading();
          this.setData({ busy: false });
          this.afterLogin('微信登录成功');
        } catch (error) {
          wx.hideLoading();
          this.setData({ busy: false });
          if (error.code === 'WECHAT_NOT_BOUND') wx.showModal({ title: '微信未绑定', content: '该微信尚未绑定教师云账号，请先使用密钥注册。', showCancel: false });
          else wx.showModal({ title: '微信登录失败', content: error.message || '请稍后重试。', showCancel: false });
        }
      },
      fail: () => wx.showToast({ title: '微信登录失败', icon: 'none' }),
    });
  },

  afterLogin(toastTitle) {
    const pendingPairing = loadPendingPairing();
    if (pendingPairing) { this.completePendingPairing(pendingPairing); return; }
    if (toastTitle) wx.showToast({ title: toastTitle, icon: 'success' });
    setTimeout(() => { if (!sharedRoom.resumePending()) wx.switchTab({ url: '/pages/home/index' }); }, 300);
  },

  scanLogin() {
    if (this.data.scanning) return;
    this.setData({ scanning: true });
    wx.scanCode({
      scanType: ['qrCode'],
      success: async ({ result }) => {
        try {
          wx.showLoading({ title: '正在连接教师端', mask: true });
          const current = sessionStore.load();
          if (!current) throw Object.assign(new Error('请先创建或登录小程序教师账户，再从“我的”扫描教师端二维码'), { code: 'PAIR_ACCOUNT_REQUIRED' });
          const session = await pairWithTeacher(result, current);
          sessionStore.save(session);
          getApp().globalData.session = session;
          wx.hideLoading();
          wx.showToast({ title: '欢迎，' + session.account.name, icon: 'success' });
          setTimeout(() => { if (!sharedRoom.resumePending()) wx.switchTab({ url: '/pages/home/index' }); }, 300);
        } catch (error) {
          wx.hideLoading();
          this.showPairingFailure(error);
        } finally { this.setData({ scanning: false }); }
      },
      fail: error => {
        if (!String(error.errMsg || '').includes('cancel')) wx.showToast({ title: '扫码失败，请重试', icon: 'none' });
        this.setData({ scanning: false });
      },
    });
  },

  async completePendingPairing(payload) {
    if (this.completingPendingPairing) return;
    this.completingPendingPairing = true;
    wx.showLoading({ title: '正在连接教师端', mask: true });
    try {
      const session = await pairWithTeacher(payload, sessionStore.load());
      sessionStore.save(session);
      getApp().globalData.session = session;
      clearPendingPairing();
      wx.hideLoading();
      wx.showToast({ title: '欢迎，' + session.account.name, icon: 'success' });
      setTimeout(() => wx.switchTab({ url: '/pages/home/index' }), 300);
    } catch (error) {
      wx.hideLoading();
      clearPendingPairing();
      this.showPairingFailure(error);
    } finally { this.completingPendingPairing = false; }
  },

  showPairingFailure(error) {
    const code = error && error.code;
    if (code === 'PAIR_NETWORK') {
      wx.showModal({
        title: '无法连接教师端',
        content: '请检查：\n1. 手机和电脑连接同一个 Wi-Fi；\n2. 不要使用访客网络，并暂时关闭 VPN；\n3. 教师端保持运行，二维码未过期；\n4. 电脑防火墙允许 TCP 3457 端口。',
        cancelText: '稍后再试', confirmText: '重新扫码',
        success: result => { if (result.confirm) setTimeout(() => this.scanLogin(), 150); },
      });
      return;
    }
    if (code === 'PAIR_QR_EXPIRED') {
      wx.showModal({ title: '二维码已过期', content: '临时二维码只有 2 分钟有效期。请在教师端点击刷新二维码，然后重新扫描。', cancelText: '稍后再试', confirmText: '重新扫码', success: result => { if (result.confirm) setTimeout(() => this.scanLogin(), 150); } });
      return;
    }
    wx.showModal({ title: code === 'PAIR_UNSUPPORTED' ? '微信版本过低' : '二维码无法使用', content: error && error.message || '请在教师端重新生成二维码后再试。', showCancel: false, confirmText: '我知道了' });
  },
});
