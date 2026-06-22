const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── 窗口控制（所有页面通用） ──
  winMinimize:  () => ipcRenderer.send('win-minimize'),
  winMaximize:  () => ipcRenderer.send('win-maximize'),
  winClose:     () => ipcRenderer.send('win-close'),

  // ── 数据读写（管理页用） ──
  getData:    ()      => ipcRenderer.invoke('get-data'),
  saveData:   (data)  => ipcRenderer.invoke('save-data', data),

  // ── 打开管理窗口（托盘菜单用） ──
  openManage: ()      => ipcRenderer.send('open-manage'),

  // ── 呼叫弹窗（popup 页用） ──
  onShowCall: (cb)    => ipcRenderer.on('show-call', (_e, call) => cb(call)),
  callAck:    (callId)=> ipcRenderer.send('call-ack', callId),
  closePopup: ()      => ipcRenderer.send('close-popup'),

  // ── 作业看板（board 页用） ──
  closeBoard:  ()     => ipcRenderer.send('close-board'),
  moveBoard:   (dx, dy) => ipcRenderer.send('move-board', dx, dy),
  onDataChanged: (cb) => ipcRenderer.on('data-changed', () => cb()),
  boardLog:    (tag, msg) => ipcRenderer.send('board-log', tag, msg),

  // ── 密码验证（密码窗口用） ──
  verifyPassword: (pwd) => ipcRenderer.invoke('verify-password', pwd),
  passwordOk:     (target) => ipcRenderer.send('password-ok', target),
  closePassword:  () => ipcRenderer.send('close-password'),

  // ── 密码管理（管理页用） ──
  hasPassword:    () => ipcRenderer.invoke('has-password'),
  changePassword: (oldPwd, newPwd) => ipcRenderer.invoke('change-password', oldPwd, newPwd),

  // ── 教师管理（管理页用） ──
  getTeachers:     () => ipcRenderer.invoke('get-teachers'),
  approveTeacher:  (connectionId) => ipcRenderer.invoke('approve-teacher', connectionId),
  rejectTeacher:   (connectionId) => ipcRenderer.invoke('reject-teacher', connectionId),
  updateTeacher:   (connectionId, data) => ipcRenderer.invoke('update-teacher', connectionId, data),
  removeTeacher:   (connectionId) => ipcRenderer.invoke('remove-teacher', connectionId),
  importTeacher:   (connectionId, name, role, subjects) => ipcRenderer.invoke('import-teacher', connectionId, name, role, subjects),
  onTeachersChanged: (cb) => ipcRenderer.on('teachers-changed', () => cb()),
});
