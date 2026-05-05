const { contextBridge, ipcRenderer } = require('electron');

// Expose serial port API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // List available serial ports
  listPorts: () => ipcRenderer.invoke('list-ports'),
  
  // Connect to serial port
  connectSerial: (portPath) => ipcRenderer.invoke('connect-serial', portPath),
  
  // Disconnect serial port
  disconnectSerial: () => ipcRenderer.invoke('disconnect-serial'),
  
  // Write to serial port
  writeSerial: (data) => ipcRenderer.invoke('write-serial', data),

  // Send a structured serial command via the main-process command queue
  sendSerialCommand: (cmd, data, timeoutMs) => ipcRenderer.invoke('send-serial-command', { cmd, data, timeoutMs }),
  
  // Get serial connection status
  serialStatus: () => ipcRenderer.invoke('serial-status'),
  
  // Listen for serial data
  onSerialData: (callback) => {
    ipcRenderer.on('serial-data', (event, data) => callback(data));
  },
  
  // Listen for serial errors
  onSerialError: (callback) => {
    ipcRenderer.on('serial-error', (event, error) => callback(error));
  },
  
  // Listen for serial disconnection
  onSerialDisconnected: (callback) => {
    ipcRenderer.on('serial-disconnected', () => callback());
  },
  
  // Open OSD overlay window
  openOSD: () => ipcRenderer.invoke('open-osd'),
  
  // Check if running in Electron
  isElectron: true
});
