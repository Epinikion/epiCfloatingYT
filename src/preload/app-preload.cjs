'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('floatingApi', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  resolveStream: (id) => ipcRenderer.invoke('media:resolve-stream', id),
  resolveQueue: (payload) => ipcRenderer.invoke('media:resolve-queue', payload),
  cookieBrowsers: () => ipcRenderer.invoke('settings:cookie-browsers'),
  setCookieBrowser: (browser) => ipcRenderer.invoke('settings:set-cookie-browser', browser),
  togglePin: () => ipcRenderer.send('window:toggle-pin'),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  toggleFullscreen: () => ipcRenderer.send('window:toggle-fullscreen'),
  leaveFullscreen: () => ipcRenderer.send('window:leave-fullscreen'),
  setVideoAspect: (ratio) => ipcRenderer.send('window:video-aspect', ratio),
  dragStart: (payload) => ipcRenderer.send('window:drag-start', payload),
  dragMove: (payload) => ipcRenderer.send('window:drag-move', payload),
  dragEnd: () => ipcRenderer.send('window:drag-end'),
  resizeStart: (payload) => ipcRenderer.send('window:resize-start', payload),
  resizeMove: (payload) => ipcRenderer.send('window:resize-move', payload),
  resizeEnd: () => ipcRenderer.send('window:resize-end'),
  onShortcut: (callback) => subscribe('app:shortcut', callback),
  onPin: (callback) => subscribe('window:pin', callback),
  onHover: (callback) => subscribe('window:hover', callback),
  onAmbientFrame: (callback) => subscribe('ambient:frame', callback),
  onSetting: (callback) => subscribe('setting:changed', callback),
  onFullscreen: (callback) => subscribe('window:fullscreen', callback),
  onResizePhase: (callback) => subscribe('window:resize-phase', callback),
  onAspect: (callback) => subscribe('window:aspect', callback),
});

