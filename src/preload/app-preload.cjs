'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const localDropListeners = new Set();
const localDragListeners = new Set();

function notify(listeners, payload) {
  for (const listener of listeners) {
    try { listener(payload); } catch {}
  }
}

function hasFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes('Files');
}

let dragDepth = 0;
window.addEventListener('dragenter', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth += 1;
  notify(localDragListeners, true);
}, true);
window.addEventListener('dragover', (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  notify(localDragListeners, true);
}, true);
window.addEventListener('dragleave', (event) => {
  if (!dragDepth) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) notify(localDragListeners, false);
}, true);
window.addEventListener('dragend', () => { dragDepth = 0; notify(localDragListeners, false); }, true);
window.addEventListener('drop', async (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  dragDepth = 0;
  notify(localDragListeners, false);
  const paths = [...event.dataTransfer.files]
    .map((file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } })
    .filter(Boolean);
  const result = await ipcRenderer.invoke('local-media:open', paths);
  notify(localDropListeners, result);
}, true);

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('floatingApi', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  resolveQueue: (payload) => ipcRenderer.invoke('media:resolve-queue', payload),
  searchVideos: (query) => ipcRenderer.invoke('video:search', query),
  resolveVideoMetadata: (ids) => ipcRenderer.invoke('video:metadata', ids),
  cookieBrowsers: () => ipcRenderer.invoke('settings:cookie-browsers'),
  setCookieBrowser: (browser) => ipcRenderer.invoke('settings:set-cookie-browser', browser),
  setCaption: (caption) => ipcRenderer.invoke('settings:set-caption', caption),
  setSoundBoost: (value) => ipcRenderer.invoke('settings:set-sound-boost', value),
  onLocalDrop: (callback) => {
    if (typeof callback !== 'function') return () => {};
    localDropListeners.add(callback);
    return () => localDropListeners.delete(callback);
  },
  onLocalDrag: (callback) => {
    if (typeof callback !== 'function') return () => {};
    localDragListeners.add(callback);
    return () => localDragListeners.delete(callback);
  },
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

