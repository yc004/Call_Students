const socket = require('../../utils/socket');
const { sessionStore } = require('../../utils/session');
const { consumeTabAction } = require('../../utils/navigation');

Page({
  data: { account:{ name:'教师',subjects:[] },initial:'教',roleText:'教师账户',subjectTags:[],rooms:[],activeRoom:{},activeRoomInitial:'教',addingRoom:false,roomPickerOpen:false,newRoomName:'',newRoomIp:'' },
  onLoad() { this.loadSession(); },
  onShow() { this.loadSession(); const action=consumeTabAction('profile'); if (action && action.openRooms) this.setData({ roomPickerOpen:true }); },
  loadSession() { const session = sessionStore.load(); if (!session) { wx.reLaunch({ url:'/pages/login/index' }); return; } this.session=session; const rooms=(session.rooms || []).map(room => ({ ...room,initial:String(room.name || '教').slice(0,1) })); const active=session.activeRoom || {}; this.setData({ account:session.account,initial:String(session.account.name || '教').slice(0,1),roleText:'教师账户',subjectTags:(session.account.subjects || []).slice(0,4),rooms,activeRoom:active,activeRoomInitial:String(active.name || '教').slice(0,1) }); },
  selectRoom(event) { const room=this.data.rooms.find(item => item.ip === event.currentTarget.dataset.ip); if (!room) return; const session=sessionStore.setActiveRoom(room); getApp().globalData.session=session; this.setData({ activeRoom:room,activeRoomInitial:String(room.name || '教').slice(0,1),roomPickerOpen:false }); socket.connect(room,session.account); wx.showToast({ title:`正在连接${room.name}`,icon:'none' }); },
  showRoomPicker() { this.setData({ roomPickerOpen:true }); }, hideRoomPicker() { this.setData({ roomPickerOpen:false }); },
  closeRoomPanel() { this.setData({ roomPickerOpen:false,addingRoom:false }); },
  showAddRoom() { this.setData({ roomPickerOpen:false,addingRoom:true,newRoomName:'',newRoomIp:'' }); }, hideAddRoom() { this.setData({ addingRoom:false }); }, setRoomName(event) { this.setData({ newRoomName:event.detail.value }); }, setRoomIp(event) { this.setData({ newRoomIp:event.detail.value }); },
  addRoom() { const ip=this.data.newRoomIp.trim(); if (!/^[a-zA-Z0-9.:-]+$/.test(ip)) { wx.showToast({ title:'请输入正确的局域网 IP',icon:'none' }); return; } const room={ id:`room_${Date.now().toString(36)}`,name:this.data.newRoomName.trim() || ip,ip }; const storedRooms=(this.session.rooms || []).filter(item => item.ip !== ip); storedRooms.push(room); const session={ ...this.session,rooms:storedRooms,activeRoom:room }; sessionStore.save(session); getApp().globalData.session=session; this.session=session; const rooms=storedRooms.map(item => ({ ...item,initial:String(item.name || '教').slice(0,1) })); this.setData({ rooms,activeRoom:room,activeRoomInitial:String(room.name || '教').slice(0,1),addingRoom:false }); socket.connect(room,session.account); },
  logout() { wx.showModal({ title:'退出登录？',content:'退出后需要重新扫描教师端二维码。',confirmColor:'#DC2626',success:result => { if (!result.confirm) return; socket.disconnect(); sessionStore.clear(); getApp().globalData.session=null; wx.reLaunch({ url:'/pages/login/index' }); } }); },
});
