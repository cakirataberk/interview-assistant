const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  setAlwaysOnTop: (value) => ipcRenderer.invoke('set-always-on-top', value),
  setOpacity: (value) => ipcRenderer.invoke('set-opacity', value),
  getOpacity: () => ipcRenderer.invoke('get-opacity'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onBackendReady: (callback) => ipcRenderer.on('backend-ready', (_event, ready) => callback(ready)),
  onSetupProgress: (callback) => ipcRenderer.on('setup-progress', (_event, msg) => callback(msg)),
  blackholeCheck: () => ipcRenderer.invoke('blackhole-check'),
  blackholeInstall: () => ipcRenderer.invoke('blackhole-install'),
  onBlackholeProgress: (callback) => ipcRenderer.on('blackhole-progress', (_event, data) => callback(data)),

  // Deep-link auth
  startLinkFlow: (locale) => ipcRenderer.invoke('start-link-flow', locale),
  getApiBase: () => ipcRenderer.invoke('get-api-base'),
  onLinkProgress: (callback) => ipcRenderer.on('link-progress', (_event, stage) => callback(stage)),
  onLinkDone: (callback) => ipcRenderer.on('link-done', (_event, data) => callback(data)),
  onLinkError: (callback) => ipcRenderer.on('link-error', (_event, data) => callback(data)),
})
