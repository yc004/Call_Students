const socket = require('../../utils/socket');
const scanAction = require('../../utils/scan-action');
const { sessionStore } = require('../../utils/session');
const roomContext = require('../../utils/room-context');
const sharedRoom = require('../../utils/shared-room');

const GREETINGS = [
  '今天也一起把课堂安排得井井有条。',
  '新的一天，愿每一次沟通都清晰顺畅。',
  '欢迎回来，今天的班级动态已经为你整理好。',
  '从容开始今天，重要的教学信息都在这里。',
  '愿今天的课堂充满专注、成长与好心情。',
  '你好，先看看今天有哪些事项需要关注。',
  '每一份认真都会被看见，今天也加油。',
];

function dateKey(date = new Date()) { return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`; }
function dailyGreeting(account) {
  const seed = `${dateKey()}-${account && account.connectionId || ''}`;
  let hash = 0; for (let index = 0; index < seed.length; index += 1) hash = ((hash * 31) + seed.charCodeAt(index)) >>> 0;
  return GREETINGS[hash % GREETINGS.length];
}
function isToday(value) { const now=new Date(); const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; return String(value || '').slice(0,10)===today; }
function isHomework(item) { return (item && item.type || 'homework') !== 'notice'; }
function summarize(room, data) {
  const today = (data.assignments || []).filter(item => isHomework(item) && isToday(item.date));
  const now = Date.now(); let pending=0,closed=0,submitted=0,expected=0;
  today.forEach(item=>{const deadline=new Date(item.deadline || '').getTime();if(Number.isFinite(deadline)&&deadline<=now)closed+=1;else pending+=1;const values=Object.values(item.submissions || {});expected+=values.length;submitted+=values.filter(value=>value&&value!=='未提交').length;});
  const isHomeroom=!!(data.teacher&&data.teacher.role==='班主任');
  return { id:room.id,name:data.className || room.name,connectionCode:room.connectionCode,online:true,isHomeroom,needsSetup:isHomeroom&&data.classroomConfigured===false,homeworkCount:today.length,pending,closed,submitted,expected };
}
function errorText(error) { const text=String(error&&error.message||'');if(/domain|合法域名/i.test(text))return '微信暂未允许局域网连接';if(/批准/.test(text))return '等待班主任批准';if(/权限/.test(text))return '当前账户没有访问权限';return '教室端离线或不在当前网络'; }

Page({
  data:{hasRooms:false,accountName:'教师',greeting:'',roomStats:[],loadingStats:false,totalRooms:0,onlineRooms:0,totalHomework:0,totalPending:0,totalClosed:0,totalSubmitted:0,totalExpected:0},
  onLoad(){if(getApp().globalData.applyNavigationTheme)getApp().globalData.applyNavigationTheme();const session=sessionStore.load();if(!session){wx.reLaunch({url:'/pages/login/index'});return;}this.session=session;this.applySession(session);},
  onShow(){if(getApp().globalData.applyNavigationTheme)getApp().globalData.applyNavigationTheme();const session=sessionStore.load();if(!session){wx.reLaunch({url:'/pages/login/index'});return;}this.session=session;this.applySession(session);if(this.getTabBar)this.getTabBar().refresh('home');if(session.rooms.length)this.loadAllRoomStats();},
  onRoomChanged(){this.onShow();},
  applySession(session){this.setData({hasRooms:!!session.rooms.length,accountName:session.account.name,greeting:dailyGreeting(session.account),totalRooms:session.rooms.length});},
  startScan(){scanAction.start({onComplete:()=>this.onRoomChanged()});},
  async loadAllRoomStats(){const session=sessionStore.load();const rooms=session&&session.rooms||[];if(!rooms.length){this.setData({hasRooms:false,roomStats:[],loadingStats:false});return;}const requestId=Date.now();this.requestId=requestId;this.setData({loadingStats:true,totalRooms:rooms.length});const results=[];let cursor=0;const worker=async()=>{while(cursor<rooms.length){const index=cursor++;const room=rooms[index];try{results[index]=summarize(room,await socket.fetchRoomSnapshot(room,session.account,5000));}catch(error){results[index]={id:room.id,name:room.name,connectionCode:room.connectionCode,online:false,errorText:errorText(error),homeworkCount:0,pending:0,closed:0,submitted:0,expected:0};}}};await Promise.all(Array.from({length:Math.min(3,rooms.length)},worker));if(this.requestId!==requestId)return;const online=results.filter(item=>item.online);this.setData({loadingStats:false,roomStats:results,onlineRooms:online.length,totalHomework:online.reduce((n,item)=>n+item.homeworkCount,0),totalPending:online.reduce((n,item)=>n+item.pending,0),totalClosed:online.reduce((n,item)=>n+item.closed,0),totalSubmitted:online.reduce((n,item)=>n+item.submitted,0),totalExpected:online.reduce((n,item)=>n+item.expected,0)});const setupRoom=results.find(item=>item.needsSetup);if(setupRoom&&!this.openingSetupGuide){this.openingSetupGuide=true;setTimeout(()=>wx.navigateTo({url:`/pages/classroom-settings/index?code=${encodeURIComponent(setupRoom.connectionCode)}&guide=1`,complete:()=>{this.openingSetupGuide=false;}}),120);}},
  async openFeature(event){const {feature,code}=event.currentTarget.dataset;let session=sessionStore.load();let room=(session&&session.rooms||[]).find(item=>String(item.connectionCode)===String(code));if(!room)return;if(!(room.subjects||[]).length){const choice=await new Promise(resolve=>wx.showModal({title:'先设置授课科目',content:'每位教师（包括班主任）加入教室时都必须填写科目。多个科目用逗号分隔。',editable:true,placeholderText:'例如：数学、物理',success:resolve,fail:()=>resolve({confirm:false})}));if(!choice.confirm)return;const subjects=String(choice.content||'').split(/[,，、\s]+/).map(value=>value.trim()).filter(Boolean);if(!subjects.length){wx.showToast({title:'请至少填写一个科目',icon:'none'});return;}const rooms=session.rooms.map(item=>String(item.connectionCode)===String(code)?{...item,subjects}:item);room=rooms.find(item=>String(item.connectionCode)===String(code));session=sessionStore.save({...session,rooms,activeRoom:room});getApp().globalData.session=session;}const result=roomContext.activateByCode(code);if(!result)return;socket.connect(result.room,result.session.account,{force:true});const url=roomContext.featureUrl(feature,result.room);if(url)wx.navigateTo({url});},
  openSettings(event){this.openFeature({currentTarget:{dataset:{feature:'settings',code:event.currentTarget.dataset.code}}});},
  onShareAppMessage(options){const code=options&&options.target&&options.target.dataset&&options.target.dataset.code;const session=sessionStore.load();const room=(session&&session.rooms||[]).find(item=>String(item.connectionCode)===String(code));if(!room)return{title:'班达 · 连接教室',path:'/pages/home/index'};return{title:`${room.name}邀请你加入教室`,path:sharedRoom.createPath(room)};},
  leaveRoom(event){const code=event.currentTarget.dataset.code;const session=sessionStore.load();const room=(session&&session.rooms||[]).find(item=>String(item.connectionCode)===String(code));if(!room)return;wx.showModal({title:`退出“${room.name}”？`,content:'退出后只会从本机移除该教室，不会删除班级资料。需要时可再次扫码或通过分享链接加入。',confirmText:'退出教室',confirmColor:'#FA5151',success:result=>{if(!result.confirm)return;const activeCode=session.activeRoom&&session.activeRoom.connectionCode;const updated=sessionStore.removeRoom(code);getApp().globalData.session=updated;if(String(activeCode)===String(code)){socket.disconnect();if(updated&&updated.activeRoom)socket.connect(updated.activeRoom,updated.account,{force:true});}this.session=updated;this.applySession(updated);this.setData({roomStats:(this.data.roomStats||[]).filter(item=>String(item.connectionCode)!==String(code))});if(updated&&updated.rooms.length)this.loadAllRoomStats();else this.setData({hasRooms:false,roomStats:[],onlineRooms:0,totalRooms:0,totalHomework:0,totalPending:0,totalClosed:0,totalSubmitted:0,totalExpected:0});wx.showToast({title:'已退出教室',icon:'success'});}});},
});
