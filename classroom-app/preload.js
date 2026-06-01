const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
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
});
