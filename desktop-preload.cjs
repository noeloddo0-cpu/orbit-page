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
  openBackupFolder: () => ipcRenderer.invoke('data:open-folder'),
  backupNow: () => ipcRenderer.invoke('data:backup-now'),
  verifyLatestBackup: () => ipcRenderer.invoke('data:verify-latest'),
  listBackups: () => ipcRenderer.invoke('data:list-backups'),
  miniMode: {
    get: () => ipcRenderer.invoke('orbit:mini-get'),
    set: on => ipcRenderer.invoke('orbit:mini-set', !!on),
    toggle: () => ipcRenderer.invoke('orbit:mini-toggle'),
    onChanged: cb => {
      const handler = (_event, on) => cb(!!on);
      ipcRenderer.on('orbit:mini-changed', handler);
      return () => ipcRenderer.removeListener('orbit:mini-changed', handler);
    }
  }
});
