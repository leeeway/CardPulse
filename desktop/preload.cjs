const { contextBridge, ipcRenderer } = require('electron');
// Narrow methods only: no generic filesystem, shell, IPC, or Node access in the UI.
contextBridge.exposeInMainWorld(
  'cardpulseDesktop',
  Object.freeze({
    platform: process.platform,
    readVault: () => ipcRenderer.invoke('vault:read'),
    writeVault: (payload) => ipcRenderer.invoke('vault:write', payload),
    clearVault: () => ipcRenderer.invoke('vault:clear'),
    exportBackup: (payload) => ipcRenderer.invoke('backup:export', payload),
    importBackup: () => ipcRenderer.invoke('backup:import'),
    fetchReferenceRate: () => ipcRenderer.invoke('rates:fetch'),
  }),
);
