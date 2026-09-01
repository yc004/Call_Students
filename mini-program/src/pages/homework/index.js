const socket = require('../../utils/socket');
const { sessionStore } = require('../../utils/session');
const homeworkView = require('../../utils/homework-view');
const homeworkOperations = require('../../utils/homework-operations');
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
  data: { status:'offline', statusMessage:'未连接', className:'', roomName:'', subjects:[], assignments:[], visibleAssignments:[], homeworkStage:'pending', contentType:'homework', publishType:'homework', studentCount:0, selectedSubject:'', allowedSubjects:[], canCompose:false, composerOpen:false, composerSubmitting:false, deletingAssignmentId:'', editingAssignmentId:'', draftSubjectIndex:0, draftTitle:'', today:dateValue(), todayLabel:'', draftDate:dateValue(), draftTime:'20:00', assignmentCount:0, pendingCount:0, closedCount:0, activeNoticeCount:0, endedNoticeCount:0, subjectCount:0, detailOpen:false, detailAssignmentId:'', detailTitle:'', detailSubject:'', detailDeadline:'', detailStudents:[], detailFilter:'all', detailSummary:null, detailSavingStudentId:'' },
  onLoad(options) {
    const now=new Date(); this.setData({ todayLabel:`${now.getMonth()+1}月${now.getDate()}日` });
    const session = sessionStore.load(); if (!session) { wx.reLaunch({ url:'/pages/login/index' }); return; }
    const context=roomContext.activateByCode(options && options.code);if(!context){wx.showToast({title:'教室信息已失效',icon:'none'});setTimeout(()=>wx.navigateBack(),300);return;}
    this.session = context.session; this.setData({ roomName:context.room.name });
    this.unsubscribe = socket.subscribe((event,payload) => {
      if (event === 'status') this.setData({ status:payload.status,statusMessage:payload.message,canCompose:payload.status === 'online' && this.data.allowedSubjects.length > 0 });
      if (event === 'sync') { this.applySync(payload); this.resolvePendingMutation(payload); }
      if (event === 'error') { this.rejectPendingMutation(new Error(payload.message || '操作失败')); wx.showToast({ title:payload.message || '操作失败',icon:'none' }); }
    });
    socket.connect(context.room,context.session.account,{force:true});
    this.deadlineTimer = setInterval(() => this.refreshDeadlineStages(), 30000);
  },
  onUnload() { this.unsubscribe && this.unsubscribe(); if (this.deadlineTimer) clearInterval(this.deadlineTimer); this.rejectPendingMutation(new Error('页面已关闭')); },
  onShow() {
    const session=sessionStore.load(); if(!session){ wx.reLaunch({url:'/pages/login/index'}); return; }
    this.session=session; if(session.activeRoom){ this.setData({roomName:session.activeRoom.name}); socket.connect(session.activeRoom,session.account); }
  },
  applySync(data) {
    this.rawData = data;
    const teacher = data.teacher || {};
    const allowedSubjects = teacher.role === '班主任' ? (data.subjects || []) : (teacher.subjects || []);
    const assignments=data.assignments || []; const homework=assignments.filter(item=>homeworkView.typeOf(item)==='homework'); const notices=assignments.filter(item=>homeworkView.typeOf(item)==='notice'); const pendingCount=homework.filter(item => homeworkView.stageOf(item) === 'pending').length; const activeNoticeCount=notices.filter(item=>homeworkView.stageOf(item)==='pending').length;
    const isHomeroom=teacher.role==='班主任';
    this.setData({ className:data.className || '',subjects:data.subjects || [],assignments,isHomeroom,studentCount:(data.students || []).length,allowedSubjects,canCompose:this.data.status === 'online' && allowedSubjects.length > 0,assignmentCount:homework.length,pendingCount,closedCount:homework.length-pendingCount,activeNoticeCount,endedNoticeCount:notices.length-activeNoticeCount,subjectCount:new Set(assignments.map(item => item.subject).filter(Boolean)).size });
    this.buildVisible();
    if (this.data.detailOpen) this.buildAssignmentDetail();
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
  openComposer(event) { const type=(event && event.currentTarget.dataset.type) || 'homework'; const draft=homeworkOperations.nextDeadlineDraft(); this.setData({ composerOpen:true,editingAssignmentId:'',publishType:type,draftSubjectIndex:0,draftTitle:'',draftDate:draft.date,draftTime:draft.time }); },
  editAssignment(event) { const id=event.currentTarget.dataset.id;const assignment=(this.data.assignments||[]).find(item=>item.id===id);if(!assignment||!this.data.allowedSubjects.includes(assignment.subject))return;const draft=deadlineDraft(assignment.deadline);const subjectIndex=Math.max(0,this.data.allowedSubjects.indexOf(assignment.subject));this.setData({composerOpen:true,editingAssignmentId:assignment.id,publishType:homeworkView.typeOf(assignment),draftSubjectIndex:subjectIndex,draftTitle:assignment.title||'',draftDate:draft.date,draftTime:draft.time}); },
  deleteAssignment(event) { const id=event.currentTarget.dataset.id;const assignment=(this.data.assignments||[]).find(item=>item.id===id);if(!assignment||!this.data.allowedSubjects.includes(assignment.subject)||this.data.deletingAssignmentId)return;const isNotice=homeworkView.typeOf(assignment)==='notice';wx.showModal({title:`删除${isNotice?'通知':'作业'}？`,content:isNotice?`删除后，教室端和所有教师设备都将不再显示“${assignment.title}”。`:`删除“${assignment.title}”后，该作业的全部学生提交统计也会一并删除，且无法恢复。`,confirmText:'删除',confirmColor:'#FA5151',success:async result=>{if(!result.confirm)return;this.setData({deletingAssignmentId:assignment.id});try{await this.sendAndConfirm({type:'update-assignments',action:'delete',assignment:{id:assignment.id}},{action:'delete',assignmentId:assignment.id});wx.showToast({title:`${isNotice?'通知':'作业'}已删除`,icon:'success'});}catch(error){wx.showToast({title:error.message||'删除失败，请重试',icon:'none'});}finally{this.setData({deletingAssignmentId:''});}}}); },
  selectPublishType(event) { if(this.data.editingAssignmentId)return;this.setData({publishType:event.currentTarget.dataset.type}); },
  closeComposer() { if(this.data.composerSubmitting)return;this.setData({ composerOpen:false,editingAssignmentId:'' }); },
  setDraftSubject(event) { this.setData({ draftSubjectIndex:Number(event.detail.value) }); }, setDraftTitle(event) { this.setData({ draftTitle:event.detail.value }); }, setDraftDate(event) { this.setData({ draftDate:event.detail.value }); }, setDraftTime(event) { this.setData({ draftTime:event.detail.value }); },
  async submitAssignment() {
    if(this.data.composerSubmitting)return;
    const title = this.data.draftTitle.trim(); const subject = this.data.allowedSubjects[this.data.draftSubjectIndex]; if (!title || !subject) return;
    const deadline=homeworkOperations.deadlineValue(this.data.draftDate,this.data.draftTime);
    if(!homeworkOperations.isFutureDeadline(deadline)){wx.showToast({title:'截止时间必须晚于当前时间',icon:'none'});return;}
    const submissions = {}; if(this.data.publishType==='homework') ((this.rawData && this.rawData.students) || []).forEach(student => { submissions[student.id] = '未提交'; });
    const existing=this.data.editingAssignmentId?(this.data.assignments||[]).find(item=>item.id===this.data.editingAssignmentId):null;
    const assignment = { id:existing?existing.id:`${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`,subject,title,date:existing?existing.date:dateValue(),deadline,type:this.data.publishType,submissions:existing?(existing.submissions||{}):submissions };
    const action=existing?'edit':'add';
    this.setData({composerSubmitting:true});
    try{await this.sendAndConfirm({type:'update-assignments',action,assignment},{action,assignmentId:assignment.id,title,subject,deadline,type:this.data.publishType});this.setData({ composerOpen:false,editingAssignmentId:'',contentType:this.data.publishType,homeworkStage:homeworkView.stageOf(assignment) });wx.showToast({ title:existing?(this.data.publishType==='notice'?'通知已更新':'作业已更新'):(this.data.publishType==='notice'?'通知已发布':'作业已布置'),icon:'success' });}
    catch(error){wx.showToast({title:error.message||'保存失败，请重试',icon:'none'});}
    finally{this.setData({composerSubmitting:false});}
  },
  sendAndConfirm(message,mutation,timeoutMs=8000){
    if(this.pendingMutation)return Promise.reject(new Error('上一项操作仍在同步'));
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{if(this.pendingMutation&&this.pendingMutation.mutation===mutation){this.pendingMutation=null;reject(new Error('同步超时，请检查教室连接后重试'));}},timeoutMs);this.pendingMutation={mutation,resolve,reject,timer};if(!socket.send(message)){this.rejectPendingMutation(new Error('教室连接已断开'));return;}socket.send({type:'request-sync'});});
  },
  resolvePendingMutation(snapshot){const pending=this.pendingMutation;if(!pending||!homeworkOperations.mutationSatisfied(pending.mutation,snapshot))return;clearTimeout(pending.timer);this.pendingMutation=null;pending.resolve(snapshot);},
  rejectPendingMutation(error){const pending=this.pendingMutation;if(!pending)return;clearTimeout(pending.timer);this.pendingMutation=null;pending.reject(error);},
  openAssignmentDetail(event){const assignment=(this.data.assignments||[]).find(item=>item.id===event.currentTarget.dataset.id);if(!assignment||homeworkView.typeOf(assignment)==='notice')return;this.setData({detailOpen:true,detailAssignmentId:assignment.id,detailFilter:'all'});this.buildAssignmentDetail();},
  closeAssignmentDetail(){if(this.data.detailSavingStudentId)return;this.setData({detailOpen:false,detailAssignmentId:'',detailStudents:[]});},
  setDetailFilter(event){this.setData({detailFilter:event.currentTarget.dataset.status});this.buildAssignmentDetail();},
  buildAssignmentDetail(){const assignment=(this.data.assignments||[]).find(item=>item.id===this.data.detailAssignmentId);if(!assignment){this.setData({detailOpen:false,detailAssignmentId:'',detailStudents:[]});return;}const students=(this.rawData&&this.rawData.students)||[];const all=students.map(student=>{const status=(assignment.submissions&&assignment.submissions[student.id])||'未提交';return{...student,initial:String(student.name||'学').slice(0,1),status,statusClass:status==='已提交'?'submitted':status==='迟交'?'late':status==='免交'?'exempt':'pending'};});const visible=this.data.detailFilter==='all'?all:all.filter(item=>item.status===this.data.detailFilter);this.setData({detailTitle:assignment.title,detailSubject:assignment.subject,detailDeadline:formatDeadline(assignment.deadline),detailStudents:visible,detailSummary:homeworkView.submissionSummary(assignment,students)});},
  chooseStudentStatus(event){if(this.data.detailSavingStudentId)return;const studentId=event.currentTarget.dataset.studentId;const assignment=(this.data.assignments||[]).find(item=>item.id===this.data.detailAssignmentId);if(!assignment||!this.data.allowedSubjects.includes(assignment.subject))return;const options=['已提交','未提交','迟交','免交'];wx.showActionSheet({itemList:options,success:result=>this.updateStudentStatus(studentId,options[result.tapIndex])});},
  async updateStudentStatus(studentId,status){this.setData({detailSavingStudentId:studentId});try{await this.sendAndConfirm({type:'update-submission',assignmentId:this.data.detailAssignmentId,studentId,status},{action:'submission',assignmentId:this.data.detailAssignmentId,studentId,status});wx.showToast({title:'提交状态已保存',icon:'success'});}catch(error){wx.showToast({title:error.message||'保存失败，请重试',icon:'none'});}finally{this.setData({detailSavingStudentId:''});}},
});
