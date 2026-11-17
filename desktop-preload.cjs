const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tracker', {
  launchSteam: id => ipcRenderer.invoke('play:launch-steam', id),
  checkUpdate: version => ipcRenderer.invoke('orbit:update',version),
  loadLibrary: () => ipcRenderer.invoke('data:load-library'),
  importConfig: () => ipcRenderer.invoke('config:import'),
  saveConfig: config => ipcRenderer.invoke('config:save', config),
  importEnv: () => ipcRenderer.invoke('config:import-env'),
  saveEnv: filePath => ipcRenderer.invoke('config:save-env', filePath),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  restoreBackup: () => ipcRenderer.invoke('data:restore'),
  openBackupFolder: () => ipcRenderer.invoke('data:open-folder')
});
