'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_ASPECT, normalizeAspect } = require('./geometry.cjs');

const STATE_VERSION = 1;
const COOKIE_BROWSERS = Object.freeze(['', 'firefox', 'chrome', 'edge', 'brave', 'vivaldi', 'opera', 'chromium']);

function finite(value, min, max, fallback) {
  return Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
}

function cookieBrowser(value) {
  const normalized = String(value || '').toLowerCase();
  return COOKIE_BROWSERS.includes(normalized) ? normalized : '';
}

function caption(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim();
  return /^[A-Za-z0-9_.-]{1,32}$/.test(normalized) ? normalized : null;
}

function defaultState() {
  return {
    version: STATE_VERSION,
    window: { videoWidth: 640, videoHeight: 360, x: null, y: null, aspect: DEFAULT_ASPECT },
    pinned: true,
    opacity: 1,
    lockAspect: true,
    glow: true,
    sharpen: false,
    cookieBrowser: '',
    caption: null,
  };
}

function sanitizeState(raw) {
  const defaults = defaultState();
  const source = raw && typeof raw === 'object' ? raw : {};
  const oldGlow = typeof source.glow === 'boolean' ? source.glow : defaults.glow;
  const legacyScale = oldGlow ? 1.15 : 1;
  const windowSource = source.window && typeof source.window === 'object' ? source.window : source;
  const hasVideoDimensions = windowSource.videoWidth != null || windowSource.videoHeight != null;
  const widthFallback = hasVideoDimensions ? defaults.window.videoWidth : finite(source.width, 90, 10000, defaults.window.videoWidth * legacyScale) / legacyScale;
  const heightFallback = hasVideoDimensions ? defaults.window.videoHeight : finite(source.height, 90, 10000, defaults.window.videoHeight * legacyScale) / legacyScale;
  const videoWidth = Math.round(finite(windowSource.videoWidth, 90, 10000, widthFallback));
  const videoHeight = Math.round(finite(windowSource.videoHeight, 90, 10000, heightFallback));

  return {
    version: STATE_VERSION,
    window: {
      videoWidth,
      videoHeight,
      x: Number.isInteger(windowSource.x) ? windowSource.x : null,
      y: Number.isInteger(windowSource.y) ? windowSource.y : null,
      aspect: normalizeAspect(windowSource.aspect, videoWidth / videoHeight),
    },
    pinned: typeof source.pinned === 'boolean' ? source.pinned : defaults.pinned,
    opacity: finite(source.opacity, 0.2, 1, defaults.opacity),
    lockAspect: typeof source.lockAspect === 'boolean' ? source.lockAspect : defaults.lockAspect,
    glow: oldGlow,
    sharpen: typeof source.sharpen === 'boolean' ? source.sharpen : defaults.sharpen,
    cookieBrowser: cookieBrowser(source.cookieBrowser),
    caption: caption(source.caption),
  };
}

class StateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.timer = null;
    this.value = this.#read();
  }

  #read() {
    try {
      return sanitizeState(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
    } catch {
      return defaultState();
    }
  }

  patch(mutator) {
    mutator(this.value);
    this.value = sanitizeState(this.value);
    this.schedule();
    return this.value;
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.new`;
      fs.writeFileSync(temporary, JSON.stringify(this.value, null, 2));
      try {
        fs.renameSync(temporary, this.filePath);
      } catch (error) {
        if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
        fs.copyFileSync(temporary, this.filePath);
        fs.unlinkSync(temporary);
      }
    } catch {
      // Persistence is a convenience; playback must continue if it fails.
    }
  }
}

module.exports = { StateStore, STATE_VERSION, COOKIE_BROWSERS, defaultState, sanitizeState, cookieBrowser, caption };
