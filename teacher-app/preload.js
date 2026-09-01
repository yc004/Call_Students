const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── 窗口控制 ──
  winMinimize:  () => ipcRenderer.send('win-minimize'),
  winMaximize:  () => ipcRenderer.send('win-maximize'),
  winClose:     () => ipcRenderer.send('win-close'),
  copyText:     (value) => ipcRenderer.invoke('copy-text', value),

  // ── 数据读写 ──
  getData:     ()       => ipcRenderer.invoke('get-data'),
  saveData:    (data)   => ipcRenderer.invoke('save-data', data),
  createLocalSession: (input) => ipcRenderer.invoke('create-local-session', input),
  loginTeacherCloud: (input) => ipcRenderer.invoke('login-teacher-cloud', input),
  completeTeacherProfile: (input) => ipcRenderer.invoke('complete-teacher-profile', input),
  chooseTeacherAvatar: () => ipcRenderer.invoke('choose-teacher-avatar'),
  updateTeacherProfile: (input) => ipcRenderer.invoke('update-teacher-profile', input),
  generateMiniProgramQr: () => ipcRenderer.invoke('generate-mini-program-qr'),
  getMiniProgramLoginStatus: () => ipcRenderer.invoke('get-mini-program-login-status'),
  cancelMiniProgramLogin: () => ipcRenderer.invoke('cancel-mini-program-login'),
  getWechatDirectLinkSettings: () => ipcRenderer.invoke('get-wechat-direct-link-settings'),
  setWechatDirectLinkSettings: (baseUrl) => ipcRenderer.invoke('set-wechat-direct-link-settings', baseUrl),
  exportHomework: (data) => ipcRenderer.invoke('export-homework', data),
  getHomeworkAiSettings: () => ipcRenderer.invoke('get-homework-ai-settings'),
  setHomeworkAiSettings: (data) => ipcRenderer.invoke('set-homework-ai-settings', data),
  analyzeHomework: (data) => ipcRenderer.invoke('analyze-homework', data),
  onHomeworkAiActivity: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, activity) => callback(activity);
    ipcRenderer.on('homework-ai-activity', listener);
    return () => ipcRenderer.removeListener('homework-ai-activity', listener);
  },
  getCloudSettings: () => ipcRenderer.invoke('get-cloud-settings'),
  setCloudSettings: (value) => ipcRenderer.invoke('set-cloud-settings', value),
  refreshCloudClassrooms: () => ipcRenderer.invoke('refresh-cloud-classrooms'),
  clearTeacherSession: () => ipcRenderer.invoke('clear-teacher-session'),
});
