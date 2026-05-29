const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData:  ()       => ipcRenderer.invoke('get-data'),
  saveData: (data)   => ipcRenderer.invoke('save-data', data),
});
