const socket = require('../../utils/socket');
const scanAction = require('../../utils/scan-action');
const { sessionStore } = require('../../utils/session');
const roomContext = require('../../utils/room-context');
const sharedRoom = require('../../utils/shared-room');
const errorReport = require('../../utils/error-report');
const subjectOptions = require('../../utils/subject-options');
const shareCard = require('../../utils/share-card');

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
function teacherDisplayName(value) { const name=String(value||'教师').trim()||'教师';return /老师$/.test(name)?name:`${name}老师`; }
function isToday(value) { const now=new Date(); const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; return String(value || '').slice(0,10)===today; }
function isHomework(item) { return (item && item.type || 'homework') !== 'notice'; }
function summarize(room, data) {
  const today = (data.assignments || []).filter(item => isHomework(item) && isToday(item.date));
  const now = Date.now(); let pending=0,closed=0,submitted=0,expected=0;
  today.forEach(item=>{const deadline=new Date(item.deadline || '').getTime();if(Number.isFinite(deadline)&&deadline<=now)closed+=1;else pending+=1;const values=Object.values(item.submissions || {});expected+=values.length;submitted+=values.filter(value=>value&&value!=='未提交').length;});
  const isHomeroom=!!(data.teacher&&data.teacher.role==='班主任');
  const needsSetup=room.transport!=='cloud'&&isHomeroom&&data.classroomConfigured===false;
  const statusKey=needsSetup?'uninitialized':'online';
  return { id:room.id,name:data.className || room.name,connectionCode:room.connectionCode,roomKey:roomContext.keyOf(room),online:true,isHomeroom,needsSetup,statusKey,statusClass:`status-${statusKey}`,statusLabel:needsSetup?'待初始化':'已连接',statusIcon:needsSetup?'初':'✓',statusText:needsSetup?'请先完成班级名称和学生名单配置':`今日 ${today.length} 项作业 · ${submitted}/${expected} 提交`,canUseFeatures:!needsSetup,homeworkCount:today.length,pending,closed,submitted,expected };
}
function errorText(error) { const text=String(error&&error.message||'');if(/domain|合法域名/i.test(text))return '微信暂未允许局域网连接';if(/批准/.test(text))return '等待班主任批准';if(/权限/.test(text))return '当前账户没有访问权限';return '教室端离线或不在当前网络'; }
function failedRoom(room,error){const statusKey=error&&error.roomStatus||'offline';const meta={offline:{label:'未连接',icon:'—',text:errorText(error)},pending:{label:'等待审核',icon:'…',text:'加入申请已发送，等待班主任批准'},'identity-error':{label:'身份异常',icon:'!',text:String(error&&error.message||'教师身份已失效，请重新加入教室')},uninitialized:{label:'待初始化',icon:'初',text:'班主任需要先完成教室基础配置'}}[statusKey]||{label:'未连接',icon:'—',text:errorText(error)};return{id:room.id,name:room.name,connectionCode:room.connectionCode,roomKey:roomContext.keyOf(room),online:false,statusKey,statusClass:`status-${statusKey}`,statusLabel:meta.label,statusIcon:meta.icon,statusText:meta.text,errorText:meta.text,canUseFeatures:false,homeworkCount:0,pending:0,closed:0,submitted:0,expected:0};}

Page({
  data:{hasRooms:false,accountName:'教师',accountDisplayName:'教师',greeting:'',usageMode:'toc',organizationName:'',organizationShortName:'',organizationMark:'组',organizationLogo:'',organizationColor:'#2563EB',roomStats:[],loadingStats:false,totalRooms:0,onlineRooms:0,totalHomework:0,totalPending:0,totalClosed:0,totalSubmitted:0,totalExpected:0},
  onLoad(){if(getApp().globalData.applyNavigationTheme)getApp().globalData.applyNavigationTheme();const session=sessionStore.load();if(!session||session.cloud&&session.cloud.mustChangePassword){wx.reLaunch({url:session?'/pages/login/index?from=cloud':'/pages/login/index'});return;}this.session=session;this.applySession(session);},
  onShow(){if(getApp().globalData.applyNavigationTheme)getApp().globalData.applyNavigationTheme();const session=sessionStore.load();if(!session||session.cloud&&session.cloud.mustChangePassword){wx.reLaunch({url:session?'/pages/login/index?from=cloud':'/pages/login/index'});return;}this.session=session;this.applySession(session);if(this.getTabBar)this.getTabBar().refresh('home');if(session.rooms.length)this.loadAllRoomStats();},
  onCloudSessionUpdated(session){if(!session||session.cloud&&session.cloud.mustChangePassword)return;this.session=session;this.applySession(session);if(session.rooms.length)this.loadAllRoomStats();else this.setData({hasRooms:false,roomStats:[],loadingStats:false,totalRooms:0,onlineRooms:0,totalHomework:0,totalPending:0,totalClosed:0,totalSubmitted:0,totalExpected:0});},
  onRoomChanged(){this.onShow();},
  applySession(session){
    const usageMode=session.cloud?'tob':'toc';
    const organization=session.cloud&&session.cloud.organization||{};
    const organizationName=organization.name||'组织空间';
    const organizationShortName=organization.shortName||organizationName;
    const organizationColor=organization.primaryColor||'#2563EB';
    this.setData({hasRooms:!!session.rooms.length,accountName:session.account.name,accountDisplayName:teacherDisplayName(session.account.name),greeting:dailyGreeting(session.account),totalRooms:session.rooms.length,usageMode,organizationName,organizationShortName,organizationMark:String(organizationShortName).slice(0,1),organizationLogo:organization.logoUrl||'',organizationColor});
    if(getApp().globalData.applyNavigationTheme)getApp().globalData.applyNavigationTheme(null,usageMode,organizationColor);
  },
  startScan(){scanAction.start({onComplete:()=>this.onRoomChanged()});},
  loadAllRoomStats(){if(this.statsPromise)return this.statsPromise;this.statsPromise=this.performLoadAllRoomStats().finally(()=>{this.statsPromise=null;});return this.statsPromise;},
  async performLoadAllRoomStats(){const session=sessionStore.load();const rooms=session&&session.rooms||[];if(!rooms.length){this.setData({hasRooms:false,roomStats:[],loadingStats:false});return;}const requestId=Date.now();this.requestId=requestId;this.setData({loadingStats:true,totalRooms:rooms.length});const results=[];let cursor=0;const worker=async()=>{while(cursor<rooms.length){const index=cursor++;const room=rooms[index];try{results[index]=summarize(room,await socket.fetchRoomSnapshot(room,session.account,5000));}catch(error){results[index]=failedRoom(room,error);}}};await Promise.all(Array.from({length:Math.min(3,rooms.length)},worker));if(this.requestId!==requestId)return;const online=results.filter(item=>item.statusKey==='online');this.setData({loadingStats:false,roomStats:results,onlineRooms:online.length,totalHomework:online.reduce((n,item)=>n+item.homeworkCount,0),totalPending:online.reduce((n,item)=>n+item.pending,0),totalClosed:online.reduce((n,item)=>n+item.closed,0),totalSubmitted:online.reduce((n,item)=>n+item.submitted,0),totalExpected:online.reduce((n,item)=>n+item.expected,0)});const setupRoom=results.find(item=>item.needsSetup);if(setupRoom&&!this.openingSetupGuide){this.openingSetupGuide=true;setTimeout(()=>wx.navigateTo({url:`/pages/classroom-settings/index?code=${encodeURIComponent(setupRoom.roomKey)}&guide=1`,complete:()=>{this.openingSetupGuide=false;}}),120);}},
  async openFeature(event){const {feature,code}=event.currentTarget.dataset;let session=sessionStore.load();let room=(session&&session.rooms||[]).find(item=>roomContext.keyOf(item)===String(code));if(!room)return;if(!(room.subjects||[]).length){if(session.cloud){wx.showToast({title:'管理员尚未为该班级配置授课科目',icon:'none',duration:2500});return;}const subjects=await subjectOptions.choose([], '设置授课科目');if(!subjects)return;const rooms=session.rooms.map(item=>roomContext.keyOf(item)===String(code)?{...item,subjects}:item);room=rooms.find(item=>roomContext.keyOf(item)===String(code));session=sessionStore.save({...session,rooms,activeRoom:room});getApp().globalData.session=session;}const result=roomContext.activateByCode(code);if(!result)return;socket.connect(result.room,result.session.account,{force:true});const url=roomContext.featureUrl(feature,result.room);if(url)wx.navigateTo({url});},
  openSettings(event){const code=event.currentTarget.dataset.code;const result=roomContext.activateByCode(code);if(!result){wx.showToast({title:'教室不存在',icon:'none'});return;}socket.connect(result.room,result.session.account,{force:true});wx.navigateTo({url:`/pages/classroom-settings/index?code=${encodeURIComponent(roomContext.keyOf(result.room))}`});},
  onShareAppMessage(options){const code=options&&options.target&&options.target.dataset&&options.target.dataset.code;const session=sessionStore.load();const room=(session&&session.rooms||[]).find(item=>roomContext.keyOf(item)===String(code));if(!room||room.cloudClassroomId)return shareCard.classroomInvite('班达 · 连接教室','/pages/home/index');return shareCard.classroomInvite(`${room.name}邀请你加入教室`,sharedRoom.createPath(room));},
  leaveRoom(event){
    const code=event.currentTarget.dataset.code;
    const session=sessionStore.load();
    const room=(session&&session.rooms||[]).find(item=>roomContext.keyOf(item)===String(code));
    if(!room)return;
    const stats=(this.data.roomStats||[]).find(item=>String(item.roomKey)===String(code));
    const homeroomNote=stats&&stats.isHomeroom?'\n\n你是该教室的班主任。退出后教室端会重新等待班主任绑定，但班级资料会保留。':'';
    wx.showModal({
      title:`退出“${room.name}”？`,
      content:`教室端会同时删除你的教师记录；以后需要重新扫码或通过分享链接加入。${homeroomNote}`,
      confirmText:'退出教室',
      confirmColor:'#FA5151',
      success:async result=>{
        if(!result.confirm)return;
        wx.showLoading({title:'正在通知教室端',mask:true});
        try{
          await socket.leaveClassroom(room,session.account,8000);
          wx.hideLoading();
          const activeCode=session.activeRoom&&roomContext.keyOf(session.activeRoom);
          const updated=sessionStore.removeRoom(room);
          getApp().globalData.session=updated;
          if(String(activeCode)===String(code)){
            socket.disconnect();
            if(updated&&updated.activeRoom)socket.connect(updated.activeRoom,updated.account,{force:true});
          }
          this.session=updated;
          this.applySession(updated);
          this.setData({roomStats:(this.data.roomStats||[]).filter(item=>String(item.roomKey)!==String(code))});
          if(updated&&updated.rooms.length)this.loadAllRoomStats();
          else this.setData({hasRooms:false,roomStats:[],onlineRooms:0,totalRooms:0,totalHomework:0,totalPending:0,totalClosed:0,totalSubmitted:0,totalExpected:0});
          wx.showToast({title:'已退出教室',icon:'success'});
        }catch(error){
          wx.hideLoading();
          errorReport.show({title:'暂时无法退出教室',error,context:'首页－退出教室',message:'无法通知教室端；为避免两端记录不一致，本次没有删除本地教室。',suggestions:['确认教室端已启动', '确认手机与教室电脑连接同一 Wi-Fi']});
        }
      },
    });
  },
});
