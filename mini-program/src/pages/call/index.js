const socket = require('../../utils/socket');
const { sessionStore } = require('../../utils/session');
const roomContext = require('../../utils/room-context');
const CALL_TEXT_KEY = 'classroom_call_custom_message_v1';
const DEFAULT_CALL_TEXT = '{name}同学，请到办公室';
Page({
  data: {
    status: 'offline', statusMessage: '未连接', statusDetail: '', className: '', roomName: '', students: [], filteredStudents: [], query: '', callingId: '', multiSelect:false,selectedCount:0,
    callText: DEFAULT_CALL_TEXT, callTextLength: DEFAULT_CALL_TEXT.length,
    templates: ['{name}同学，请到办公室', '{name}同学，请到讲台', '{name}同学，请联系老师'],
  },
  onLoad(options) {
    const session = sessionStore.load();
    if (!session) { wx.reLaunch({ url: '/pages/login/index' }); return; }
    const context=roomContext.activateByCode(options && options.code); if(!context){wx.showToast({title:'教室信息已失效',icon:'none'});setTimeout(()=>wx.navigateBack(),300);return;} this.session=context.session;
    let callText = DEFAULT_CALL_TEXT;
    try {
      const stored = wx.getStorageSync(CALL_TEXT_KEY);
      if (stored && typeof stored === 'object' && Object.prototype.hasOwnProperty.call(stored, 'text')) callText = String(stored.text).slice(0, 100);
      else if (typeof stored === 'string' && stored) callText = stored.slice(0, 100);
    } catch (_error) {}
    this.setData({ roomName: context.room.name, callText, callTextLength: callText.length });
    this.unsubscribe = socket.subscribe((event, payload) => {
      if (event === 'status') this.setData({ status: payload.status, statusMessage: payload.message, statusDetail: payload.detail || '' });
      if (event === 'sync') this.applySync(payload);
      if (event === 'error') wx.showToast({ title: payload.message || '操作失败', icon: 'none' });
    });
    socket.connect(context.room, context.session.account,{force:true});
  },
  onUnload() { this.unsubscribe && this.unsubscribe(); },
  onShow() {
    const session = sessionStore.load();
    if (!session) { wx.reLaunch({ url: '/pages/login/index' }); return; }
    this.session = session;
    if (session.activeRoom) { this.setData({ roomName: session.activeRoom.name }); socket.connect(session.activeRoom, session.account); }
  },
  applySync(data) {
    if (!data.teacher || data.teacher.role !== '班主任') {
      if (!this.permissionDenied) {
        this.permissionDenied = true;
        wx.showToast({ title:'仅班主任可以呼叫学生',icon:'none' });
        setTimeout(() => wx.navigateBack(), 500);
      }
      return;
    }
    this.selectedIds=this.selectedIds||new Set();this.sentIds=this.sentIds||new Set();
    const validIds=new Set((data.students||[]).map(item=>item.id));for(const id of this.selectedIds)if(!validIds.has(id))this.selectedIds.delete(id);
    const students = (data.students || []).map(item => ({ ...item, initial: String(item.name || '生').slice(0, 1),selected:this.selectedIds.has(item.id),sent:this.sentIds.has(item.id) }));
    this.allStudents = students;
    this.setData({ className: data.className || '', students, filteredStudents: this.filterStudents(students, this.data.query) });
  },
  filterStudents(students, query) { const value = String(query || '').trim().toLowerCase(); return value ? students.filter(item => item.name.toLowerCase().includes(value)) : students; },
  search(event) { const query = event.detail.value; this.setData({ query, filteredStudents: this.filterStudents(this.allStudents || [], query) }); },
  editCallText(event) {
    const callText = String(event.detail.value || '').slice(0, 100);
    this.setData({ callText, callTextLength: callText.length });
    try { wx.setStorageSync(CALL_TEXT_KEY, { text: callText }); } catch (_error) {}
  },
  useTemplate(event) {
    const index = Number(event.currentTarget.dataset.index);
    const callText = this.data.templates[index];
    if (!callText) return;
    this.setData({ callText, callTextLength: callText.length });
    try { wx.setStorageSync(CALL_TEXT_KEY, { text: callText }); } catch (_error) {}
  },
  insertNameVariable() {
    const current = String(this.data.callText || '');
    if (current.includes('{name}')) { wx.showToast({ title: '消息中已有学生姓名', icon: 'none' }); return; }
    const callText = (`{name}${current}`).slice(0, 100);
    this.setData({ callText, callTextLength: callText.length });
    try { wx.setStorageSync(CALL_TEXT_KEY, { text: callText }); } catch (_error) {}
  },
  clearCallText() {
    this.setData({ callText: '', callTextLength: 0 });
    try { wx.setStorageSync(CALL_TEXT_KEY, { text: '' }); } catch (_error) {}
  },
  clearSearch() { this.setData({ query: '', filteredStudents: this.allStudents || [] }); },
  refreshStudentViews(){const selected=this.selectedIds||new Set();const sent=this.sentIds||new Set();this.allStudents=(this.allStudents||[]).map(item=>({...item,selected:selected.has(item.id),sent:sent.has(item.id)}));this.setData({students:this.allStudents,filteredStudents:this.filterStudents(this.allStudents,this.data.query),selectedCount:selected.size});},
  toggleMultiSelect(){const multiSelect=!this.data.multiSelect;this.selectedIds=this.selectedIds||new Set();if(!multiSelect)this.selectedIds.clear();this.setData({multiSelect});this.refreshStudentViews();},
  handleStudentTap(event){if(this.data.multiSelect)this.toggleStudent(event);else this.callStudent(event);},
  toggleStudent(event){const id=event.currentTarget.dataset.id;this.selectedIds=this.selectedIds||new Set();if(this.selectedIds.has(id))this.selectedIds.delete(id);else this.selectedIds.add(id);this.refreshStudentViews();wx.vibrateShort({type:'light'});},
  selectVisible(){this.selectedIds=this.selectedIds||new Set();(this.data.filteredStudents||[]).forEach(item=>this.selectedIds.add(item.id));this.refreshStudentViews();},
  clearSelection(){this.selectedIds=this.selectedIds||new Set();this.selectedIds.clear();this.refreshStudentViews();},
  callSelected(){const selected=this.selectedIds||new Set();const students=(this.allStudents||[]).filter(item=>selected.has(item.id));if(!students.length){wx.showToast({title:'请至少选择一名学生',icon:'none'});return;}this.sendStudents(students);},
  callTarget(students){const base=students.map(item=>item.name).join('、');return{base,display:base};},
  sendStudents(students){if(!students.length||this.data.status!=='online')return;const rawMessage=String(this.data.callText||'').trim();if(!rawMessage){wx.showToast({title:'请先填写呼叫内容',icon:'none'});return;}const callId=`${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;const target=this.callTarget(students);const studentNames=students.map(item=>item.name);const message=rawMessage.replace(/\{name\}同学/g,`${target.base}同学`).replace(/\{name\}/g,target.display);if(!socket.send({type:'call',callId,studentName:target.display,studentNames,className:this.data.className,message})){wx.showToast({title:'连接已断开',icon:'none'});return;}this.sentIds=this.sentIds||new Set();students.forEach(item=>this.sentIds.add(item.id));this.selectedIds=this.selectedIds||new Set();this.selectedIds.clear();this.setData({multiSelect:false,callingId:students.length===1?students[0].id:''});this.refreshStudentViews();wx.vibrateShort({type:'light'});wx.showToast({title:students.length===1?'呼叫已发送':`已呼叫 ${students.length} 人`,icon:'success'});setTimeout(()=>{students.forEach(item=>this.sentIds.delete(item.id));this.setData({callingId:''});this.refreshStudentViews();},2400);},
  callStudent(event) {
    const id = event.currentTarget.dataset.id;
    const student = (this.allStudents || []).find(item => item.id === id);
    if (!student) return;
    this.sendStudents([student]);
  },
  reconnect() { if (this.session && this.session.activeRoom) socket.reconnect(this.session.activeRoom, this.session.account); },
});
