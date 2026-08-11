const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── 窗口控制 ──
  winMinimize:  () => ipcRenderer.send('win-minimize'),
  winMaximize:  () => ipcRenderer.send('win-maximize'),
  winClose:     () => ipcRenderer.send('win-close'),

  // ── 数据读写 ──
  getData:     ()       => ipcRenderer.invoke('get-data'),
  saveData:    (data)   => ipcRenderer.invoke('save-data', data),
  registerAccount: (account) => ipcRenderer.invoke('register-account', account),
  loginAccount: (name, password) => ipcRenderer.invoke('login-account', name, password),
});
