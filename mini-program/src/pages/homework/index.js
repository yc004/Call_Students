const socket = require('../../utils/socket');
const { sessionStore } = require('../../utils/session');

function two(value) { return String(value).padStart(2, '0'); }
function dateValue(date = new Date()) { return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`; }
function formatDeadline(value) {
  const date = new Date(value); if (Number.isNaN(date.getTime())) return value || '未设置截止时间';
  return `截止 ${date.getMonth() + 1}月${date.getDate()}日 ${two(date.getHours())}:${two(date.getMinutes())}`;
}

Page({
  data: { status:'offline', statusMessage:'未连接', className:'', roomName:'', subjects:[], assignments:[], visibleAssignments:[], studentCount:0, selectedSubject:'', allowedSubjects:[], canCompose:false, composerOpen:false, draftSubjectIndex:0, draftTitle:'', today:dateValue(), todayLabel:'', draftDate:dateValue(), draftTime:'20:00', assignmentCount:0, pendingCount:0, subjectCount:0 },
  onLoad() {
    const now=new Date(); this.setData({ todayLabel:`${now.getMonth()+1}月${now.getDate()}日` });
    const session = sessionStore.load(); if (!session) { wx.reLaunch({ url:'/pages/login/index' }); return; }
    this.session = session; this.setData({ roomName:session.activeRoom ? session.activeRoom.name : '' });
    this.unsubscribe = socket.subscribe((event,payload) => {
      if (event === 'status') this.setData({ status:payload.status,statusMessage:payload.message,canCompose:payload.status === 'online' && this.data.allowedSubjects.length > 0 });
      if (event === 'sync') this.applySync(payload);
      if (event === 'error') wx.showToast({ title:payload.message || '操作失败',icon:'none' });
    });
    if (session.activeRoom) socket.connect(session.activeRoom,session.account);
  },
  onUnload() { this.unsubscribe && this.unsubscribe(); },
  onShow() {
    const session=sessionStore.load(); if(!session){ wx.reLaunch({url:'/pages/login/index'}); return; }
    this.session=session; if(session.activeRoom){ this.setData({roomName:session.activeRoom.name}); socket.connect(session.activeRoom,session.account); }
  },
  applySync(data) {
    this.rawData = data;
    const teacher = data.teacher || {};
    const allowedSubjects = teacher.role === '班主任' ? (data.subjects || []) : (teacher.subjects || []);
    const assignments=data.assignments || []; const pendingCount=assignments.filter(item => !item.deadline || new Date(item.deadline).getTime() > Date.now()).length;
    this.setData({ className:data.className || '',subjects:data.subjects || [],assignments,studentCount:(data.students || []).length,allowedSubjects,canCompose:this.data.status === 'online' && allowedSubjects.length > 0,assignmentCount:assignments.length,pendingCount,subjectCount:new Set(assignments.map(item => item.subject).filter(Boolean)).size });
    this.buildVisible();
  },
  buildVisible() {
    const filtered = (this.data.assignments || []).filter(item => !this.data.selectedSubject || item.subject === this.data.selectedSubject);
    const dates = new Map();
    filtered.sort((a,b) => String(b.date || '').localeCompare(String(a.date || ''))).forEach(item => {
      const date = item.date || '未设置日期'; if (!dates.has(date)) dates.set(date,new Map()); const subjects = dates.get(date); if (!subjects.has(item.subject)) subjects.set(item.subject,[]);
      subjects.get(item.subject).push({ ...item,deadlineText:formatDeadline(item.deadline),submitted:Object.values(item.submissions || {}).filter(value => value === '已提交' || value === '迟交').length });
    });
    const visibleAssignments = Array.from(dates.entries()).map(([date,subjects]) => { const groups=Array.from(subjects.entries()).map(([subject,items]) => ({ subject,initial:String(subject || '课').slice(0,1),items })); return { date,dateLabel:date === dateValue() ? '今天' : date,total:groups.reduce((sum,group) => sum+group.items.length,0),subjects:groups }; });
    this.setData({ visibleAssignments });
  },
  selectSubject(event) { this.setData({ selectedSubject:event.currentTarget.dataset.subject || '' }); this.buildVisible(); },
  openComposer() { this.setData({ composerOpen:true,draftTitle:'',draftDate:dateValue(),draftTime:'20:00' }); },
  closeComposer() { this.setData({ composerOpen:false }); },
  setDraftSubject(event) { this.setData({ draftSubjectIndex:Number(event.detail.value) }); }, setDraftTitle(event) { this.setData({ draftTitle:event.detail.value }); }, setDraftDate(event) { this.setData({ draftDate:event.detail.value }); }, setDraftTime(event) { this.setData({ draftTime:event.detail.value }); },
  submitAssignment() {
    const title = this.data.draftTitle.trim(); const subject = this.data.allowedSubjects[this.data.draftSubjectIndex]; if (!title || !subject) return;
    const submissions = {}; ((this.rawData && this.rawData.students) || []).forEach(student => { submissions[student.id] = '未提交'; });
    const assignment = { id:`${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`,subject,title,date:dateValue(),deadline:`${this.data.draftDate}T${this.data.draftTime}`,submissions };
    if (!socket.send({ type:'update-assignments',action:'add',assignment })) { wx.showToast({ title:'教室连接已断开',icon:'none' }); return; }
    this.setData({ composerOpen:false }); wx.showToast({ title:'作业已布置',icon:'success' }); socket.send({ type:'request-sync' });
  },
});
