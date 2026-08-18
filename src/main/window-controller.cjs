'use strict';

const {
  minimumWindowSize,
  normalizeAspect,
  outerScale,
  reshapeForAspect,
  resizeFromDirection,
  snapBounds,
  videoRect,
} = require('./geometry.cjs');

const HOVER_HEIGHT = 40;
const AMBIENT_INTERVAL = 120;
const AMBIENT_WIDTH = 80;
const AMBIENT_HEIGHT = 45;
const ASPECT_EPSILON = 0.0005;

function isAllowedGuestUrl(rawUrl, localOrigin) {
  if (rawUrl === 'about:blank') return true;
  try {
    const url = new URL(rawUrl);
    if (url.origin === localOrigin) return true;
    const host = url.hostname.toLowerCase();
    return ['youtube.com', 'youtube-nocookie.com', 'youtu.be'].some((domain) => host === domain || host.endsWith(`.${domain}`))
      || host === 'consent.google.com'
      || host.endsWith('.consent.google.com');
  } catch {
    return false;
  }
}

class WindowController {
  constructor({ BrowserWindow, screen, clipboard, store, appPreload, guestPreload, icon, uiFile, partition, baseUrl }) {
    this.BrowserWindow = BrowserWindow;
    this.screen = screen;
    this.clipboard = clipboard;
    this.store = store;
    this.appPreload = appPreload;
    this.guestPreload = guestPreload;
    this.icon = icon;
    this.uiFile = uiFile;
    this.partition = partition;
    this.baseUrl = baseUrl;
    this.window = null;
    this.guest = null;
    this.fullscreen = false;
    this.restoreBounds = null;
    this.resize = null;
    this.drag = null;
    this.visualResize = false;
    this.hoverTimer = null;
    this.ambientTimer = null;
    this.ambientBusy = false;
  }

  create(startUrl = null) {
    const state = this.store.value;
    const scale = outerScale(state.glow);
    const minimum = minimumWindowSize(state.window.aspect, state.glow);
    const options = {
      width: Math.round(state.window.videoWidth * scale),
      height: Math.round(state.window.videoHeight * scale),
      minWidth: minimum.width,
      minHeight: minimum.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: state.pinned,
      resizable: !state.glow,
      show: false,
      icon: this.icon,
      webPreferences: {
        preload: this.appPreload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
      },
    };
    if (Number.isInteger(state.window.x) && Number.isInteger(state.window.y) && this.#pointIsVisible(state.window.x, state.window.y)) {
      options.x = state.window.x;
      options.y = state.window.y;
    }

    const window = new this.BrowserWindow(options);
    this.window = window;
    window.webContents.on('will-attach-webview', (_event, preferences, params) => {
      preferences.preload = this.guestPreload;
      preferences.contextIsolation = true;
      preferences.nodeIntegration = false;
      preferences.nodeIntegrationInSubFrames = false;
      preferences.sandbox = true;
      preferences.partition = this.partition;
      preferences.autoplayPolicy = 'no-user-gesture-required';
      params.partition = this.partition;
      params.allowpopups = false;
    });
    window.webContents.on('did-attach-webview', (_event, contents) => this.#attachGuest(contents));
    window.webContents.on('before-input-event', (event, input) => {
      if (this.handleInput(input, false)) event.preventDefault();
    });
    window.loadFile(this.uiFile);
    window.setOpacity(state.opacity);
    window.setAlwaysOnTop(state.pinned, 'screen-saver');
    if (state.lockAspect) window.setAspectRatio(state.window.aspect);
    window.once('ready-to-show', () => window.show());
    if (startUrl) window.webContents.once('did-finish-load', () => this.send('app:shortcut', { name: 'load-url', url: startUrl }));

    window.on('will-resize', () => this.#beginVisualResize());
    window.on('resize', () => this.#scheduleStateSave());
    window.on('resized', () => { if (!this.resize) this.#endVisualResize(); });
    window.on('move', () => this.#scheduleStateSave());
    window.on('close', () => this.saveWindowState(true));
    window.on('closed', () => {
      clearInterval(this.hoverTimer);
      clearInterval(this.ambientTimer);
      this.window = null;
      this.guest = null;
    });
    this.#startHoverTracking();
    return window;
  }

  send(channel, payload) {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send(channel, payload);
  }

  handleInput(input, fromGuest) {
    if (input.type !== 'keyDown' || !this.window) return false;
    const key = String(input.key || '').toLowerCase();
    const control = input.control || input.meta;
    if (key === 'f1' && fromGuest) { this.send('app:shortcut', { name: 'help' }); return true; }
    if (control && key === 'v') {
      const url = this.clipboard.readText().trim();
      if (url) this.send('app:shortcut', { name: 'load-url', url });
      return true;
    }
    if (control && key === 'l') {
      this.send('app:shortcut', { name: 'toast', text: 'YouTube-Link kopieren und Strg+V drücken' });
      return true;
    }
    if (control && key === 'p') { this.togglePin(); return true; }
    if (control && key === 'w') { this.window.close(); return true; }
    if (control && ['arrowleft', 'arrowright'].includes(key)) {
      this.send('app:shortcut', { name: key === 'arrowright' ? 'next' : 'previous' });
      return true;
    }
    if (control && ['arrowup', 'arrowdown'].includes(key)) {
      const delta = key === 'arrowup' ? 0.05 : -0.05;
      this.store.patch((state) => { state.opacity = Math.min(1, Math.max(0.2, Number((state.opacity + delta).toFixed(2)))); });
      this.window.setOpacity(this.store.value.opacity);
      this.send('app:shortcut', { name: 'toast', text: `Deckkraft ${Math.round(this.store.value.opacity * 100)} %` });
      return true;
    }
    if (control && key === ',') { this.send('app:shortcut', { name: 'menu' }); return true; }
    if (control && key === 'b') { this.toggleGlow(); return true; }
    if (control && key === 'u') {
      this.store.patch((state) => { state.sharpen = !state.sharpen; });
      this.send('setting:changed', { name: 'sharpen', value: this.store.value.sharpen });
      this.broadcastVisualState();
      return true;
    }
    if (control && input.shift && key === 'a') {
      this.store.patch((state) => { state.lockAspect = !state.lockAspect; });
      this.window.setAspectRatio(this.store.value.lockAspect ? this.store.value.window.aspect : 0);
      this.send('app:shortcut', { name: 'toast', text: this.store.value.lockAspect ? 'Videoformat fixiert' : 'Seitenverhältnis frei' });
      return true;
    }
    if (fromGuest && (key === ' ' || key === 'k')) { this.send('app:shortcut', { name: 'play-pause' }); return true; }
    if (fromGuest && key === 'm') { this.send('app:shortcut', { name: 'mute' }); return true; }
    if (fromGuest && key === 'f') { this.toggleFullscreen(); return true; }
    if (key === 'escape' && (this.fullscreen || this.window.isFullScreen())) { this.leaveFullscreen(); return true; }
    if (key === 'escape') {
      this.send('app:shortcut', { name: 'escape' });
      return fromGuest;
    }
    return false;
  }

  saveWindowState(immediate = false) {
    if (!this.window || this.window.isDestroyed() || this.fullscreen || this.restoreBounds) return;
    const bounds = this.window.getBounds();
    const scale = outerScale(this.store.value.glow);
    this.store.value.window.videoWidth = Math.max(90, Math.round(bounds.width / scale));
    this.store.value.window.videoHeight = Math.max(90, Math.round(bounds.height / scale));
    this.store.value.window.x = bounds.x;
    this.store.value.window.y = bounds.y;
    if (immediate) this.store.flush();
    else this.store.schedule();
  }

  #scheduleStateSave() {
    this.saveWindowState(false);
  }

  togglePin() {
    if (!this.window) return;
    this.store.patch((state) => { state.pinned = !state.pinned; });
    this.window.setAlwaysOnTop(this.store.value.pinned, 'screen-saver');
    this.send('window:pin', this.store.value.pinned);
  }

  toggleGlow() {
    if (!this.window || this.fullscreen) return;
    const bounds = this.window.getBounds();
    const oldScale = outerScale(this.store.value.glow);
    const videoWidth = Math.max(90, Math.round(bounds.width / oldScale));
    const videoHeight = Math.max(90, Math.round(bounds.height / oldScale));
    this.store.value.glow = !this.store.value.glow;
    this.store.value.window.videoWidth = videoWidth;
    this.store.value.window.videoHeight = videoHeight;
    const newScale = outerScale(this.store.value.glow);
    const width = Math.round(videoWidth * newScale);
    const height = Math.round(videoHeight * newScale);
    const minimum = minimumWindowSize(this.store.value.window.aspect, this.store.value.glow);
    this.window.setResizable(!this.store.value.glow);
    this.window.setMinimumSize(minimum.width, minimum.height);
    this.#setBounds({ x: bounds.x - (width - bounds.width) / 2, y: bounds.y - (height - bounds.height) / 2, width, height });
    this.store.schedule();
    this.send('setting:changed', { name: 'glow', value: this.store.value.glow });
  }

  setAspect(value) {
    if (!this.window) return;
    const next = normalizeAspect(value, this.store.value.window.aspect);
    if (Math.abs(Math.log(next / this.store.value.window.aspect)) <= ASPECT_EPSILON) return;
    this.store.value.window.aspect = next;
    this.send('window:aspect', next);
    const source = this.fullscreen ? this.restoreBounds : this.window.getBounds();
    if (!source || (!this.store.value.lockAspect && !this.fullscreen)) {
      this.store.schedule();
      return;
    }
    const workArea = this.screen.getDisplayMatching(source).workArea;
    const target = reshapeForAspect(source, next, this.store.value.glow, workArea);
    const scale = outerScale(this.store.value.glow);
    this.store.value.window.videoWidth = Math.max(90, Math.round(target.width / scale));
    this.store.value.window.videoHeight = Math.max(90, Math.round(target.height / scale));
    if (this.fullscreen) this.restoreBounds = target;
    else {
      const minimum = minimumWindowSize(next, this.store.value.glow);
      this.window.setAspectRatio(0);
      this.window.setMinimumSize(minimum.width, minimum.height);
      this.#setBounds(target);
      if (this.store.value.lockAspect) this.window.setAspectRatio(next);
    }
    this.store.schedule();
  }

  startDrag({ x, y }) {
    if (!this.window || this.fullscreen || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.drag = { x, y, bounds: this.window.getBounds() };
  }

  moveDrag({ x, y }) {
    if (!this.drag || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.#setBounds({
      x: this.drag.bounds.x + x - this.drag.x,
      y: this.drag.bounds.y + y - this.drag.y,
      width: this.drag.bounds.width,
      height: this.drag.bounds.height,
    });
  }

  endDrag() {
    if (!this.drag) return;
    this.drag = null;
    this.saveWindowState();
  }

  startResize({ direction, x, y }) {
    if (!this.window || !this.store.value.glow || this.fullscreen) return;
    if (!/^(n|s|e|w|ne|nw|se|sw)$/.test(direction) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.resize = { direction, x, y, bounds: this.window.getBounds() };
    this.#beginVisualResize();
  }

  moveResize({ x, y }) {
    if (!this.resize || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const target = resizeFromDirection({
      start: this.resize.bounds,
      direction: this.resize.direction,
      cursorX: x,
      cursorY: y,
      originX: this.resize.x,
      originY: this.resize.y,
      aspect: this.store.value.window.aspect,
      glow: true,
      lockAspect: this.store.value.lockAspect,
    });
    this.#setBounds(target);
  }

  endResize() {
    if (!this.resize) return;
    this.resize = null;
    this.#endVisualResize();
    this.saveWindowState();
  }

  toggleFullscreen() {
    this.fullscreen ? this.leaveFullscreen() : this.enterFullscreen();
  }

  enterFullscreen() {
    if (!this.window || this.fullscreen) return;
    this.restoreBounds = this.window.getNormalBounds();
    this.fullscreen = true;
    this.drag = null;
    this.resize = null;
    this.send('window:fullscreen', true);
    this.window.setAspectRatio(0);
    this.window.setResizable(false);
    this.window.setKiosk(true);
    this.broadcastVisualState();
  }

  leaveFullscreen() {
    if (!this.window || (!this.fullscreen && !this.restoreBounds)) return;
    const restore = this.restoreBounds;
    this.fullscreen = false;
    this.window.setKiosk(false);
    if (this.window.isFullScreen()) this.window.setFullScreen(false);
    this.send('window:fullscreen', false);
    this.broadcastVisualState();
    setTimeout(() => {
      if (!this.window) return;
      if (restore) this.#setBounds(restore);
      const minimum = minimumWindowSize(this.store.value.window.aspect, this.store.value.glow);
      this.window.setMinimumSize(minimum.width, minimum.height);
      this.window.setResizable(!this.store.value.glow);
      this.window.setAspectRatio(this.store.value.lockAspect ? this.store.value.window.aspect : 0);
      this.window.setAlwaysOnTop(this.store.value.pinned, 'screen-saver');
      this.restoreBounds = null;
      this.saveWindowState();
    }, 50);
  }

  broadcastVisualState() {
    if (!this.guest || this.guest.isDestroyed()) return;
    const visual = { sharpen: this.store.value.sharpen, fullscreen: this.fullscreen };
    try {
      for (const frame of this.guest.mainFrame.framesInSubtree) frame.send('guest-visual', visual);
    } catch {}
  }

  #attachGuest(contents) {
    this.guest = contents;
    contents.on('before-input-event', (event, input) => {
      if (this.handleInput(input, true)) event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const guard = (event, url) => { if (!isAllowedGuestUrl(url, this.baseUrl)) event.preventDefault(); };
    contents.on('will-navigate', guard);
    contents.on('will-redirect', guard);
    contents.on('enter-html-full-screen', () => this.enterFullscreen());
    contents.on('leave-html-full-screen', () => this.leaveFullscreen());
    contents.on('did-frame-finish-load', () => this.broadcastVisualState());
    contents.on('destroyed', () => { if (this.guest === contents) this.guest = null; });
    this.#startAmbientCapture();
  }

  #beginVisualResize() {
    if (this.visualResize) return;
    this.visualResize = true;
    this.send('window:resize-phase', 'start');
  }

  #endVisualResize() {
    if (!this.visualResize) return;
    this.visualResize = false;
    this.send('window:resize-phase', 'end');
  }

  #setBounds(bounds) {
    if (!this.window) return;
    const scaleFactor = this.screen.getDisplayMatching(bounds).scaleFactor;
    this.window.setBounds(snapBounds(bounds, scaleFactor));
  }

  #pointIsVisible(x, y) {
    return this.screen.getAllDisplays().some(({ workArea }) => x >= workArea.x - 50 && y >= workArea.y - 50 && x < workArea.x + workArea.width && y < workArea.y + workArea.height);
  }

  #startHoverTracking() {
    clearInterval(this.hoverTimer);
    let previous = false;
    this.hoverTimer = setInterval(() => {
      if (!this.window || !this.window.isVisible() || this.window.isMinimized()) return;
      const pointer = this.screen.getCursorScreenPoint();
      const video = videoRect(this.window.getBounds(), this.store.value.window.aspect, this.store.value.glow);
      const near = pointer.x >= video.x && pointer.x < video.x + video.width && pointer.y >= video.y && pointer.y < video.y + HOVER_HEIGHT;
      if (near !== previous) {
        previous = near;
        this.send('window:hover', near);
      }
    }, 120);
  }

  #startAmbientCapture() {
    clearInterval(this.ambientTimer);
    this.ambientTimer = setInterval(() => void this.#captureAmbient(), AMBIENT_INTERVAL);
    void this.#captureAmbient();
  }

  async #captureAmbient() {
    if (this.ambientBusy || !this.store.value.glow || this.fullscreen) return;
    if (!this.window || this.window.isMinimized() || !this.window.isVisible() || !this.guest || this.guest.isDestroyed()) return;
    this.ambientBusy = true;
    try {
      const image = await this.guest.capturePage();
      if (image.isEmpty()) return;
      const small = image.resize({ width: AMBIENT_WIDTH, height: AMBIENT_HEIGHT, quality: 'good' });
      const bitmap = small.toBitmap({ scaleFactor: 1 });
      this.send('ambient:frame', { width: AMBIENT_WIDTH, height: AMBIENT_HEIGHT, pixels: new Uint8Array(bitmap) });
    } catch {
      // The next frame will retry after navigations and surface swaps.
    } finally {
      this.ambientBusy = false;
    }
  }
}

module.exports = { WindowController, isAllowedGuestUrl };
