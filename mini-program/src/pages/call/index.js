const socket = require('../../utils/socket');
const { sessionStore } = require('../../utils/session');
const { replaceTab } = require('../../utils/navigation');

Page({
  data: {
    status: 'offline', statusMessage: '未连接', statusDetail: '', className: '', roomName: '', students: [], filteredStudents: [], query: '', callingId: '',
    templates: ['{name}同学，请到办公室', '{name}同学，请到讲台', '{name}同学，请联系老师'], templateIndex: 0,
  },
  onLoad() {
    const session = sessionStore.load();
    if (!session) { wx.reLaunch({ url: '/pages/login/index' }); return; }
    this.session = session;
    this.setData({ roomName: session.activeRoom ? session.activeRoom.name : '尚未选择教室' });
    this.unsubscribe = socket.subscribe((event, payload) => {
      if (event === 'status') this.setData({ status: payload.status, statusMessage: payload.message, statusDetail: payload.detail || '' });
      if (event === 'sync') this.applySync(payload);
      if (event === 'error') wx.showToast({ title: payload.message || '操作失败', icon: 'none' });
    });
    if (session.activeRoom) socket.connect(session.activeRoom, session.account);
  },
  onUnload() { this.unsubscribe && this.unsubscribe(); },
  onShow() {
    const session = sessionStore.load();
    if (!session) { wx.reLaunch({ url: '/pages/login/index' }); return; }
    this.session = session;
    if (session.activeRoom) { this.setData({ roomName: session.activeRoom.name }); socket.connect(session.activeRoom, session.account); }
  },
  applySync(data) {
    const students = (data.students || []).map(item => ({ ...item, initial: String(item.name || '生').slice(0, 1) }));
    this.allStudents = students;
    this.setData({ className: data.className || '', students, filteredStudents: this.filterStudents(students, this.data.query) });
  },
  filterStudents(students, query) { const value = String(query || '').trim().toLowerCase(); return value ? students.filter(item => item.name.toLowerCase().includes(value)) : students; },
  search(event) { const query = event.detail.value; this.setData({ query, filteredStudents: this.filterStudents(this.allStudents || [], query) }); },
  openTemplates() {
    wx.showActionSheet({
      itemList: this.data.templates,
      success: result => this.setData({ templateIndex: result.tapIndex }),
    });
  },
  clearSearch() { this.setData({ query: '', filteredStudents: this.allStudents || [] }); },
  callStudent(event) {
    const id = event.currentTarget.dataset.id;
    const student = (this.allStudents || []).find(item => item.id === id);
    if (!student || this.data.status !== 'online') return;
    const callId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const message = this.data.templates[this.data.templateIndex].replace(/\{name\}/g, student.name);
    if (!socket.send({ type: 'call', callId, studentName: student.name, className: this.data.className, message })) {
      wx.showToast({ title: '连接已断开', icon: 'none' }); return;
    }
    this.setData({ callingId: id });
    wx.vibrateShort({ type: 'light' });
    setTimeout(() => this.setData({ callingId: '' }), 2400);
  },
  reconnect() { if (this.session && this.session.activeRoom) socket.reconnect(this.session.activeRoom, this.session.account); else this.openRooms(); },
  openRooms() { replaceTab('profile', { openRooms: true }); },
});
