const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Open OSD overlay window
  openOSD: () => ipcRenderer.invoke('open-osd'),

  // Check if running in Electron
  isElectron: true
});
