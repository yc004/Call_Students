const socket = require('../../utils/socket');
const { sessionStore } = require('../../utils/session');

Page({
  data: { account:{ name:'教师',subjects:[] },initial:'教',roleText:'教师账户',subjectTags:[] },
  onLoad() { this.loadSession(); },
  onShow() { this.loadSession(); if(this.getTabBar)this.getTabBar().refresh('profile'); },
  loadSession() { const session = sessionStore.load(); if (!session) { wx.reLaunch({ url:'/pages/login/index' }); return; } this.setData({ account:{ ...session.account,subjects:[] },initial:String(session.account.name || '教').slice(0,1),roleText:'教师账户',subjectTags:[] }); },
  logout() { wx.showModal({ title:'退出登录？',content:'退出后需要重新登录教师账户。',confirmColor:'#DC2626',success:result => { if (!result.confirm) return; socket.disconnect(); sessionStore.clear(); getApp().globalData.session=null; wx.reLaunch({ url:'/pages/login/index' }); } }); },
});
