// Gives the page a narrow bridge to the main process, for requests the
// browser sandbox can't make itself (NetEase and QQ Music lyrics, Apple
// Music covers and lyrics), Discord Rich Presence, and the window shape.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lyricPlayerNative', {
  netease: (kind, params) => ipcRenderer.invoke('netease', kind, params),
  appleArt: (id, storefront) => ipcRenderer.invoke('apple-art', id, storefront),
  qqMusic: (kind, params) => ipcRenderer.invoke('qq-music', kind, params),
  appleMusic: (kind, params) => ipcRenderer.invoke('apple-music', kind, params),
  discord: (payload) => ipcRenderer.invoke('discord', payload),
  music: (kind, params) => ipcRenderer.invoke('music', kind, params),
  onLibraryChanged: (fn) => ipcRenderer.on('library-changed', () => fn()),
  lastfm: (kind, params) => ipcRenderer.invoke('lastfm', kind, params),
  update: (kind, params) => ipcRenderer.invoke('update', kind, params),
  onUpdateStatus: (fn) => ipcRenderer.on('update-status', (_e, s) => fn(s)),
  mini: (kind, payload) => ipcRenderer.invoke('mini', kind, payload),
  onMiniState: (fn) => ipcRenderer.on('mini-state', (_e, s) => fn(s)),
  onMiniCommand: (fn) => ipcRenderer.on('mini-command', (_e, c) => fn(c)),
  diagnostics: (text) => ipcRenderer.invoke('diagnostics', text),
  setLayout: (mode) => ipcRenderer.invoke('layout', mode),
  systemMedia: (kind, params) => ipcRenderer.invoke('system-media', kind, params),
  onSystemMedia: (fn) => ipcRenderer.on('system-media', (_e, s) => fn(s)),
  windowControl: (kind) => ipcRenderer.invoke('window', kind),
  onWindowState: (fn) => ipcRenderer.on('window-state', (_e, s) => fn(s)),
  appPrefs: (kind, params) => ipcRenderer.invoke('app-prefs', kind, params),
  glass: (kind) => ipcRenderer.invoke('glass', kind),
  platform: process.platform,
});
