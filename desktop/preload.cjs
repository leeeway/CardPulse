const { contextBridge, ipcRenderer } = require('electron');
// Narrow methods only: no generic filesystem, shell, IPC, or Node access in the UI.
contextBridge.exposeInMainWorld(
  'cardpulseDesktop',
  Object.freeze({
    platform: process.platform,
    arch: process.arch,
    copyBuildInfo: () => ipcRenderer.invoke('build:copy-info'),
    readVault: () => ipcRenderer.invoke('vault:read'),
    writeVault: (payload, expected) =>
      ipcRenderer.invoke('vault:write', payload, expected),
    clearVault: (expected) => ipcRenderer.invoke('vault:clear', expected),
    restoreVault: (payload, expected) =>
      ipcRenderer.invoke('vault:restore', payload, expected),
    exportBackup: (payload) => ipcRenderer.invoke('backup:export', payload),
    importBackup: () => ipcRenderer.invoke('backup:import'),
    fetchReferenceRate: () => ipcRenderer.invoke('rates:fetch'),
  }),
);
