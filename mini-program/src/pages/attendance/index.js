const socket = require('../../utils/socket');
const { sessionStore } = require('../../utils/session');

function formatTime(value) {
  const date = new Date(value); if (!value || Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}

Page({
  data: { status:'offline',statusMessage:'未连接',className:'',roomName:'',students:[],visibleStudents:[],liveFaces:[],pendingFaces:[],filter:'all',query:'',presentCount:0,arrivedCount:0,awayCount:0,unseenCount:0,totalCount:0,presentPercent:0,pendingFaceCount:0,isHomeroom:false,updatedText:'等待数据' },
  onLoad() {
    const session=sessionStore.load(); if(!session){ wx.reLaunch({url:'/pages/login/index'}); return; }
    this.session=session; this.setData({roomName:session.activeRoom ? session.activeRoom.name : ''});
    this.unsubscribe=socket.subscribe((event,payload)=>{
      if(event==='status') this.setData({status:payload.status,statusMessage:payload.message});
      if(event==='sync') this.applySync(payload);
      if(event==='attendance') this.applyAttendance(payload.attendance || []);
      if(event==='presence') this.applyPresence(payload.detections || []);
      if(event==='pendingFaces') this.applyPendingFaces(payload.faces || []);
    });
    if(session.activeRoom) socket.connect(session.activeRoom,session.account);
  },
  onUnload(){ this.unsubscribe && this.unsubscribe(); },
  onShow(){
    const session=sessionStore.load(); if(!session){ wx.reLaunch({url:'/pages/login/index'}); return; }
    this.session=session; if(session.activeRoom){ this.setData({roomName:session.activeRoom.name}); socket.connect(session.activeRoom,session.account); }
  },
  applySync(data){ this.rawStudents=data.students || []; this.attendance=data.attendance || []; this.presentIds=this.presentIds || new Set(); this.isHomeroom=!!(data.teacher && data.teacher.role==='班主任'); this.setData({className:data.className || '',isHomeroom:this.isHomeroom}); this.applyPendingFaces(data.pendingFaces || []); this.rebuild(); },
  applyAttendance(attendance){ this.attendance=attendance; this.rebuild(); },
  applyPresence(detections){
    const valid=detections.filter(item=>this.validFaceImage(item.cropBase64) && (this.isHomeroom || (item.isRecognized && item.studentId)));
    this.faceImages=this.faceImages || new Map();
    valid.filter(item=>item.isRecognized && item.studentId).forEach(item=>this.faceImages.set(item.studentId,item.cropBase64));
    this.presentIds=new Set(detections.filter(item=>item.isRecognized && item.studentId).map(item=>item.studentId));
    const liveFaces=valid.slice(0,12).map((item,index)=>({id:item.faceId || `live-${index}`,image:item.cropBase64,name:item.isRecognized?(item.name || '已识别学生'):'待匹配',recognized:!!item.isRecognized}));
    this.setData({liveFaces}); this.rebuild();
  },
  applyPendingFaces(faces){
    const pendingFaces=(this.isHomeroom ? faces : []).filter(item=>this.validFaceImage(item.cropBase64)).slice(0,12).map(item=>({id:item.faceId,image:item.cropBase64,name:'待匹配人脸'}));
    this.setData({pendingFaceCount:faces.length,pendingFaces});
  },
  validFaceImage(value){ return typeof value==='string' && /^data:image\/(jpeg|jpg|png);base64,/i.test(value); },
  rebuild(){
    const attendanceById=new Map((this.attendance || []).map(item=>[item.studentId,item])); const presentIds=this.presentIds || new Set();
    const students=(this.rawStudents || []).map(student=>{ const record=attendanceById.get(student.id) || {}; const present=presentIds.has(student.id); const arrived=!!record.lastSeen; const state=present?'present':(arrived?'away':'unseen'); return {studentId:student.id,name:student.name,initial:String(student.name || '生').slice(0,1),faceImage:(this.faceImages && this.faceImages.get(student.id)) || '',state,stateLabel:present?'在教室':(arrived?'已离开':'未识别'),timeText:present?(record.lastSeen?`最近识别 ${formatTime(record.lastSeen)}`:'刚刚识别'):(arrived?`最后识别 ${formatTime(record.lastSeen)}`:'今天尚未识别')}; });
    this.allStudents=students; const presentCount=students.filter(item=>item.state==='present').length; const arrivedCount=students.filter(item=>item.state!=='unseen').length; const awayCount=students.filter(item=>item.state==='away').length; const unseenCount=students.filter(item=>item.state==='unseen').length; const totalCount=students.length;
    this.setData({students,presentCount,arrivedCount,awayCount,unseenCount,totalCount,presentPercent:totalCount?Math.round(presentCount/totalCount*100):0,updatedText:`更新于 ${formatTime(new Date())}`}); this.applyFilter();
  },
  applyFilter(){ const q=this.data.query.trim().toLowerCase(); const filter=this.data.filter; const visibleStudents=(this.allStudents || []).filter(item=>(filter==='all'||item.state===filter)&&(!q||item.name.toLowerCase().includes(q))); this.setData({visibleStudents}); },
  setFilter(event){ this.setData({filter:event.currentTarget.dataset.filter}); this.applyFilter(); }, search(event){this.setData({query:event.detail.value});this.applyFilter();}, clearSearch(){this.setData({query:''});this.applyFilter();},
  previewFace(event){
    const { source, index, studentId, name }=event.currentTarget.dataset; let image='';
    if(source==='live') image=((this.data.liveFaces[Number(index)] || {}).image || '');
    else if(source==='pending') image=((this.data.pendingFaces[Number(index)] || {}).image || '');
    else if(studentId && this.faceImages) image=this.faceImages.get(studentId) || '';
    if(!this.validFaceImage(image)) return;
    wx.previewImage({ current:image, urls:[image], showmenu:false });
  },
  refresh(){ socket.send({type:'request-sync'}); wx.showToast({title:'正在刷新',icon:'none'}); },
});
