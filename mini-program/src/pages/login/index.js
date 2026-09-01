const { pairWithTeacher, loadPendingPairing, clearPendingPairing } = require('../../utils/auth');
const { sessionStore } = require('../../utils/session');
const cloudApi = require('../../utils/cloud');
const sharedRoom = require('../../utils/shared-room');
const errorReport = require('../../utils/error-report');

function genConnectionId() {
  const random = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
  return ('mini-' + random).slice(0, 128);
}

Page({
  data: {
    screen:'choice', localName:'', cloudServerUrl:'', cloudUseHttps:false, cloudOrganizationSlug:'', cloudLoginName:'', cloudPassword:'',
    profileNickname:'', profilePassword:'', profileConfirmPassword:'', profileAvatar:'',
    organizationName:'组织空间', organizationShortName:'组织', organizationMark:'组', organizationColor:'#2563EB', busy:false,
  },

  onLoad(options) {
    this.fromRoomShare = !!(options && options.from === 'roomShare');
    this.fromCloud = !!(options && options.from === 'cloud');
    const remembered=cloudApi.loadRememberedCloudServer();
    this.setData({cloudServerUrl:remembered.serverUrl,cloudUseHttps:remembered.useHttps,...(this.fromCloud?{screen:'organization'}:{})});
  },

  onShow() {
    const session = sessionStore.load();
    if (!session) return;
    if (session.cloud && session.cloud.mustChangePassword) {
      this.pendingCloudSession = session;
      this.showProfile(session.cloud);
      return;
    }
    const pendingPairing = loadPendingPairing();
    if (pendingPairing) { this.completePendingPairing(pendingPairing); return; }
    if (this.fromRoomShare && sharedRoom.resumePending()) return;
    wx.switchTab({ url:'/pages/home/index' });
  },

  chooseMode(event) { this.setData({ screen:event.currentTarget.dataset.mode === 'tob' ? 'organization' : 'personal' }); },
  backToChoice() { if (!this.data.busy) this.setData({ screen:'choice' }); },
  onLocalNameInput(event) { this.setData({ localName:String(event.detail.value || '').trimStart().slice(0, 20) }); },
  onCloudServerInput(event) { this.setData({ cloudServerUrl:String(event.detail.value || '').replace(/^https?:\/\//i, '').trim().slice(0, 500) }); },
  onCloudHttpsChange(event) { this.setData({ cloudUseHttps:!!(event.detail.value && event.detail.value.length) }); },
  onCloudOrganizationSlugInput(event) { this.setData({ cloudOrganizationSlug:String(event.detail.value || '').trim().slice(0, 80) }); },
  onCloudLoginNameInput(event) { this.setData({ cloudLoginName:String(event.detail.value || '').trim().slice(0, 80) }); },
  onCloudPasswordInput(event) { this.setData({ cloudPassword:String(event.detail.value || '') }); },
  onProfileNicknameInput(event) { this.setData({ profileNickname:String(event.detail.value || '').trimStart().slice(0, 40) }); },
  onProfilePasswordInput(event) { this.setData({ profilePassword:String(event.detail.value || '') }); },
  onProfileConfirmInput(event) { this.setData({ profileConfirmPassword:String(event.detail.value || '') }); },

  getWechatCode() {
    return new Promise((resolve,reject)=>wx.login({timeout:10000,success:result=>result&&result.code?resolve(result.code):reject(new Error('微信未返回登录凭证')),fail:error=>reject(new Error(error&&error.errMsg||'无法获取微信登录凭证'))}));
  },

  enterPersonal() {
    const name = this.data.localName.trim();
    if (!name) { wx.showToast({ title:'请输入你的称呼', icon:'none' }); return; }
    const account = { name, loginName:name, connectionId:genConnectionId(), subjects:[] };
    const session = sessionStore.save({ account, rooms:[], activeRoom:null, cloud:null, usageMode:'toc', pairedAt:new Date().toISOString() });
    getApp().globalData.session = session;
    this.afterLogin();
  },

  async loginOrganization() {
    if (this.data.busy) return;
    const { cloudServerUrl:serverUrl, cloudOrganizationSlug:organizationSlug, cloudLoginName:loginName, cloudPassword:password } = this.data;
    if (!serverUrl || !organizationSlug || !loginName || !password) { wx.showToast({ title:'请填写服务器、组织标识、用户名和密码', icon:'none' }); return; }
    this.setData({ busy:true });
    wx.showLoading({ title:'正在进入组织', mask:true });
    try {
      const cloud = await cloudApi.loginMiniProgramAccount({ serverUrl, useHttps:this.data.cloudUseHttps, organizationSlug, loginName, password, deviceName:'微信小程序' });
      cloudApi.rememberCloudServer(serverUrl,this.data.cloudUseHttps);
      const rooms = cloud.mustChangePassword ? [] : await cloudApi.listClassrooms(cloud);
      if(!cloud.mustChangePassword)cloud.availableSubjects=await cloudApi.listSubjects(cloud);
      const existing = sessionStore.load();
      const account = { name:cloud.nickname || cloud.userName || loginName, loginName, avatarUrl:cloud.avatarUrl || '', connectionId:`cloud-${cloud.userId}`, subjects:[] };
      const session = sessionStore.save({ account, rooms, activeRoom:rooms[0] || null, cloud, usageMode:'tob', pairedAt:new Date().toISOString() });
      getApp().globalData.session = session;
      wx.hideLoading(); this.setData({ busy:false });
      if (cloud.mustChangePassword) { this.pendingCloudSession = session; this.showProfile(cloud); }
      else this.afterLogin('登录成功');
    } catch (error) {
      wx.hideLoading(); this.setData({ busy:false });
      errorReport.show({ title:'无法登录组织', error, context:'组织模式登录', suggestions:['检查服务器地址和 HTTP/HTTPS 选项', '确认账号密码正确且组织服务器已经启动'] });
    }
  },

  async loginWechatOrganization() {
    if(this.data.busy)return;
    const serverUrl=this.data.cloudServerUrl;
    if(!serverUrl){wx.showToast({title:'请先填写服务器地址',icon:'none'});return;}
    this.setData({busy:true});wx.showLoading({title:'微信一键登录',mask:true});
    try{
      const code=await this.getWechatCode();
      const cloud=await cloudApi.loginWechatAccount({serverUrl,useHttps:this.data.cloudUseHttps,code,deviceName:'微信小程序'});
      cloudApi.rememberCloudServer(serverUrl,this.data.cloudUseHttps);
      const rooms=await cloudApi.listClassrooms(cloud);
      cloud.availableSubjects=await cloudApi.listSubjects(cloud);
      const account={name:cloud.nickname||cloud.userName||'教师',loginName:cloud.userName,avatarUrl:cloud.avatarUrl||'',connectionId:`cloud-${cloud.userId}`,subjects:[]};
      const session=sessionStore.save({account,rooms,activeRoom:rooms[0]||null,cloud,usageMode:'tob',pairedAt:new Date().toISOString()});
      getApp().globalData.session=session;
      wx.hideLoading();this.setData({busy:false});this.afterLogin('微信登录成功');
    }catch(error){
      wx.hideLoading();this.setData({busy:false});
      errorReport.show({title:'微信登录失败',error,context:'组织模式微信登录',suggestions:['首次使用请先通过用户名和初始密码登录并完成绑定','检查服务器是否已配置微信小程序 AppID 和 AppSecret']});
    }
  },

  showProfile(cloud) {
    const organization = cloud.organization || {};
    this.setData({
      screen:'profile', profileNickname:cloud.nickname || cloud.userName || '', profileAvatar:cloud.avatarUrl || '',
      profilePassword:'', profileConfirmPassword:'', organizationName:organization.name || '组织空间',
      organizationShortName:organization.shortName || organization.name || '组织', organizationColor:organization.primaryColor || '#2563EB',
      organizationMark:String(organization.shortName || organization.name || '组织').slice(0, 1),
    });
  },

  async completeProfile() {
    if (this.data.busy) return;
    const session = this.pendingCloudSession || sessionStore.load();
    if (!session || !session.cloud) return;
    const nickname = this.data.profileNickname.trim();
    const name = nickname;
    const password = this.data.profilePassword;
    if (!nickname) { wx.showToast({ title:'请输入用户名', icon:'none' }); return; }
    if (password.length < 10) { wx.showToast({ title:'新密码至少 10 位', icon:'none' }); return; }
    if (password !== this.data.profileConfirmPassword) { wx.showToast({ title:'两次密码输入不一致', icon:'none' }); return; }
    this.setData({ busy:true }); wx.showLoading({ title:'正在保存资料', mask:true });
    try {
      let cloud = session.cloud;
      cloud = await cloudApi.completeTeacherProfile(cloud, { name, nickname, newPassword:password });
      const rooms = await cloudApi.listClassrooms(cloud);
      cloud.availableSubjects=await cloudApi.listSubjects(cloud);
      const account = { ...session.account, name:nickname || name, avatarUrl:cloud.avatarUrl || '', loginName:this.data.cloudLoginName || session.account.loginName };
      const updated = sessionStore.save({ ...session, account, rooms, activeRoom:rooms[0] || null, cloud, usageMode:'tob' });
      getApp().globalData.session = updated;
      this.pendingCloudSession = null;
      wx.hideLoading(); this.setData({ busy:false });
      this.offerWechatBinding(updated);
    } catch (error) {
      wx.hideLoading(); this.setData({ busy:false });
      errorReport.show({ title:'资料保存失败', error, context:'首次登录资料设置', suggestions:['检查网络连接后重试', '确认用户名有效且新密码至少为 10 位'] });
    }
  },

  offerWechatBinding(session) {
    if(!session||!session.cloud||session.cloud.wechatBound){this.afterLogin('资料设置完成');return;}
    wx.showModal({title:'绑定当前微信',content:'绑定后，下次只需点击“微信一键登录”，无需再次输入用户名和密码。不会读取微信昵称、头像或手机号。',confirmText:'一键绑定',cancelText:'以后再说',confirmColor:'#07C160',success:result=>{if(result.confirm)this.bindCurrentWechat(session);else this.afterLogin('资料设置完成');},fail:()=>this.afterLogin('资料设置完成')});
  },

  async bindCurrentWechat(session) {
    this.setData({busy:true});wx.showLoading({title:'正在绑定微信',mask:true});
    try{
      const code=await this.getWechatCode();
      const cloud=await cloudApi.bindWechat(session.cloud,code);
      const updated=sessionStore.save({...session,cloud});
      getApp().globalData.session=updated;
      wx.hideLoading();this.setData({busy:false});this.afterLogin('微信绑定成功');
    }catch(error){
      wx.hideLoading();this.setData({busy:false});
      errorReport.show({title:'微信绑定失败',error,context:'首次登录微信绑定',suggestions:['可稍后在“我的－个人信息”中再次绑定','请管理员检查服务器微信小程序配置']});
      this.afterLogin();
    }
  },

  afterLogin(toastTitle) {
    const pendingPairing = loadPendingPairing();
    if (pendingPairing) { this.completePendingPairing(pendingPairing); return; }
    if (toastTitle) wx.showToast({ title:toastTitle, icon:'success' });
    setTimeout(() => { if (!sharedRoom.resumePending()) wx.switchTab({ url:'/pages/home/index' }); }, 250);
  },

  async completePendingPairing(payload) {
    if (this.completingPendingPairing) return;
    this.completingPendingPairing = true;
    wx.showLoading({ title:'正在连接教师端', mask:true });
    try {
      const session = sessionStore.load();
      await pairWithTeacher(payload, session);
      clearPendingPairing();
      wx.hideLoading(); wx.showToast({ title:'电脑登录成功', icon:'success' });
      setTimeout(() => wx.switchTab({ url:'/pages/home/index' }), 300);
    } catch (error) {
      wx.hideLoading(); clearPendingPairing();
      errorReport.show({ title:'无法登录教师端', error, context:'教师端扫码登录', suggestions:['确认手机和教师电脑位于同一局域网', '请重新生成并扫描教师端二维码'] });
    } finally { this.completingPendingPairing = false; }
  },
});
