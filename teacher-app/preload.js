const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── 窗口控制 ──
  winMinimize:  () => ipcRenderer.send('win-minimize'),
  winMaximize:  () => ipcRenderer.send('win-maximize'),
  winClose:     () => ipcRenderer.send('win-close'),

  // ── 数据读写 ──
  getData:     ()       => ipcRenderer.invoke('get-data'),
  saveData:    (data)   => ipcRenderer.invoke('save-data', data),
  generateMiniProgramQr: () => ipcRenderer.invoke('generate-mini-program-qr'),
  getMiniProgramLoginStatus: () => ipcRenderer.invoke('get-mini-program-login-status'),
  exportHomework: (data) => ipcRenderer.invoke('export-homework', data),
});
