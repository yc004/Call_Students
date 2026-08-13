const socket = require('../../utils/socket');
const { sessionStore } = require('../../utils/session');
const homeworkView = require('../../utils/homework-view');
const roomContext = require('../../utils/room-context');

function two(value) { return String(value).padStart(2, '0'); }
function dateValue(date = new Date()) { return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`; }
function formatDeadline(value) {
  const date = new Date(value); if (Number.isNaN(date.getTime())) return value || '未设置截止时间';
  return `截止 ${date.getMonth() + 1}月${date.getDate()}日 ${two(date.getHours())}:${two(date.getMinutes())}`;
}
function deadlineDraft(value) {
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return { date:dateValue(),time:'20:00' };
  return { date:dateValue(date),time:`${two(date.getHours())}:${two(date.getMinutes())}` };
}

Page({
  data: { status:'offline', statusMessage:'未连接', className:'', roomName:'', subjects:[], assignments:[], visibleAssignments:[], homeworkStage:'pending', contentType:'homework', publishType:'homework', studentCount:0, selectedSubject:'', allowedSubjects:[], canCompose:false, composerOpen:false, editingAssignmentId:'', draftSubjectIndex:0, draftTitle:'', today:dateValue(), todayLabel:'', draftDate:dateValue(), draftTime:'20:00', assignmentCount:0, pendingCount:0, closedCount:0, activeNoticeCount:0, endedNoticeCount:0, subjectCount:0 },
  onLoad(options) {
    const now=new Date(); this.setData({ todayLabel:`${now.getMonth()+1}月${now.getDate()}日` });
    const session = sessionStore.load(); if (!session) { wx.reLaunch({ url:'/pages/login/index' }); return; }
    const context=roomContext.activateByCode(options && options.code);if(!context){wx.showToast({title:'教室信息已失效',icon:'none'});setTimeout(()=>wx.navigateBack(),300);return;}
    this.session = context.session; this.setData({ roomName:context.room.name });
    this.unsubscribe = socket.subscribe((event,payload) => {
      if (event === 'status') this.setData({ status:payload.status,statusMessage:payload.message,canCompose:payload.status === 'online' && this.data.allowedSubjects.length > 0 });
      if (event === 'sync') this.applySync(payload);
      if (event === 'error') wx.showToast({ title:payload.message || '操作失败',icon:'none' });
    });
    socket.connect(context.room,context.session.account,{force:true});
    this.deadlineTimer = setInterval(() => this.refreshDeadlineStages(), 30000);
  },
  onUnload() { this.unsubscribe && this.unsubscribe(); if (this.deadlineTimer) clearInterval(this.deadlineTimer); },
  onShow() {
    const session=sessionStore.load(); if(!session){ wx.reLaunch({url:'/pages/login/index'}); return; }
    this.session=session; if(session.activeRoom){ this.setData({roomName:session.activeRoom.name}); socket.connect(session.activeRoom,session.account); }
  },
  applySync(data) {
    this.rawData = data;
    const teacher = data.teacher || {};
    const allowedSubjects = teacher.role === '班主任' ? (data.subjects || []) : (teacher.subjects || []);
    const assignments=data.assignments || []; const homework=assignments.filter(item=>homeworkView.typeOf(item)==='homework'); const notices=assignments.filter(item=>homeworkView.typeOf(item)==='notice'); const pendingCount=homework.filter(item => homeworkView.stageOf(item) === 'pending').length; const activeNoticeCount=notices.filter(item=>homeworkView.stageOf(item)==='pending').length;
    this.setData({ className:data.className || '',subjects:data.subjects || [],assignments,isHomeroom:teacher.role==='班主任',studentCount:(data.students || []).length,allowedSubjects,canCompose:this.data.status === 'online' && allowedSubjects.length > 0,assignmentCount:homework.length,pendingCount,closedCount:homework.length-pendingCount,activeNoticeCount,endedNoticeCount:notices.length-activeNoticeCount,subjectCount:new Set(assignments.map(item => item.subject).filter(Boolean)).size });
    this.buildVisible();
  },
  buildVisible() {
    const students = (this.rawData && this.rawData.students) || [];
    const filtered = (this.data.assignments || []).filter(item => homeworkView.typeOf(item) === this.data.contentType && (!this.data.selectedSubject || item.subject === this.data.selectedSubject));
    const visibleAssignments = homeworkView.groupByDeadline(filtered, this.data.homeworkStage).map(group => ({
      date:group.key,dateLabel:group.label,total:group.assignments.length,
      items:group.assignments.map(item => ({ ...item,isNotice:homeworkView.typeOf(item)==='notice',isStudentCreated:item.source==='student',canManage:this.data.allowedSubjects.includes(item.subject),deadlineText:formatDeadline(item.deadline),summary:homeworkView.submissionSummary(item,students) })),
    }));
    this.setData({ visibleAssignments });
  },
  refreshDeadlineStages() {
    const assignments = this.data.assignments || []; const homework=assignments.filter(item=>homeworkView.typeOf(item)==='homework'); const notices=assignments.filter(item=>homeworkView.typeOf(item)==='notice');
    const pendingCount = homework.filter(item => homeworkView.stageOf(item) === 'pending').length; const activeNoticeCount=notices.filter(item=>homeworkView.stageOf(item)==='pending').length;
    this.setData({ pendingCount,closedCount:homework.length-pendingCount,activeNoticeCount,endedNoticeCount:notices.length-activeNoticeCount }); this.buildVisible();
  },
  selectContentType(event) { this.setData({ contentType:event.currentTarget.dataset.type,homeworkStage:'pending' }); this.buildVisible(); },
  selectStage(event) { this.setData({ homeworkStage:event.currentTarget.dataset.stage }); this.buildVisible(); },
  selectSubject(event) { this.setData({ selectedSubject:event.currentTarget.dataset.subject || '' }); this.buildVisible(); },
  openComposer(event) { const type=(event && event.currentTarget.dataset.type) || 'homework'; this.setData({ composerOpen:true,editingAssignmentId:'',publishType:type,draftSubjectIndex:0,draftTitle:'',draftDate:dateValue(),draftTime:'20:00' }); },
  editAssignment(event) { const id=event.currentTarget.dataset.id;const assignment=(this.data.assignments||[]).find(item=>item.id===id);if(!assignment||!this.data.allowedSubjects.includes(assignment.subject))return;const draft=deadlineDraft(assignment.deadline);const subjectIndex=Math.max(0,this.data.allowedSubjects.indexOf(assignment.subject));this.setData({composerOpen:true,editingAssignmentId:assignment.id,publishType:homeworkView.typeOf(assignment),draftSubjectIndex:subjectIndex,draftTitle:assignment.title||'',draftDate:draft.date,draftTime:draft.time}); },
  deleteAssignment(event) { const id=event.currentTarget.dataset.id;const assignment=(this.data.assignments||[]).find(item=>item.id===id);if(!assignment||!this.data.allowedSubjects.includes(assignment.subject))return;const isNotice=homeworkView.typeOf(assignment)==='notice';wx.showModal({title:`删除${isNotice?'通知':'作业'}？`,content:isNotice?`删除后，教室端和所有教师设备都将不再显示“${assignment.title}”。`:`删除“${assignment.title}”后，该作业的全部学生提交统计也会一并删除，且无法恢复。`,confirmText:'删除',confirmColor:'#FA5151',success:result=>{if(!result.confirm)return;if(!socket.send({type:'update-assignments',action:'delete',assignment:{id:assignment.id}})){wx.showToast({title:'教室连接已断开',icon:'none'});return;}wx.showToast({title:`${isNotice?'通知':'作业'}已删除`,icon:'success'});socket.send({type:'request-sync'});}}); },
  selectPublishType(event) { if(this.data.editingAssignmentId)return;this.setData({publishType:event.currentTarget.dataset.type}); },
  closeComposer() { this.setData({ composerOpen:false,editingAssignmentId:'' }); },
  setDraftSubject(event) { this.setData({ draftSubjectIndex:Number(event.detail.value) }); }, setDraftTitle(event) { this.setData({ draftTitle:event.detail.value }); }, setDraftDate(event) { this.setData({ draftDate:event.detail.value }); }, setDraftTime(event) { this.setData({ draftTime:event.detail.value }); },
  submitAssignment() {
    const title = this.data.draftTitle.trim(); const subject = this.data.allowedSubjects[this.data.draftSubjectIndex]; if (!title || !subject) return;
    const submissions = {}; if(this.data.publishType==='homework') ((this.rawData && this.rawData.students) || []).forEach(student => { submissions[student.id] = '未提交'; });
    const existing=this.data.editingAssignmentId?(this.data.assignments||[]).find(item=>item.id===this.data.editingAssignmentId):null;
    const assignment = { id:existing?existing.id:`${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`,subject,title,date:existing?existing.date:dateValue(),deadline:`${this.data.draftDate}T${this.data.draftTime}`,type:this.data.publishType,submissions:existing?(existing.submissions||{}):submissions };
    const action=existing?'edit':'add';
    if (!socket.send({ type:'update-assignments',action,assignment })) { wx.showToast({ title:'教室连接已断开',icon:'none' }); return; }
    this.setData({ composerOpen:false,editingAssignmentId:'',contentType:this.data.publishType,homeworkStage:homeworkView.stageOf(assignment) }); wx.showToast({ title:existing?(this.data.publishType==='notice'?'通知已更新':'作业已更新'):(this.data.publishType==='notice'?'通知已发布':'作业已布置'),icon:'success' }); socket.send({ type:'request-sync' });
  },
});
