'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { StateStore, sanitizeState } = require('../src/main/state-store.cjs');

test('migrates the legacy flat state and clamps unsafe values', () => {
  const state = sanitizeState({
    stateVersion: 3,
    videoWidth: 800,
    videoHeight: 450,
    aspect: 99,
    x: 12,
    y: 24,
    glow: false,
    opacity: -2,
    cookieBrowser: 'FIREFOX',
  });
  assert.deepEqual(state.window, { videoWidth: 800, videoHeight: 450, x: 12, y: 24, aspect: 3 });
  assert.equal(state.opacity, 0.2);
  assert.equal(state.cookieBrowser, 'firefox');
  assert.equal(state.caption, null);
});

test('persists and reloads state from an explicit path', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'floatingyt-state-'));
  const file = path.join(directory, 'state.json');
  const store = new StateStore(file);
  store.patch((state) => { state.pinned = false; state.window.videoWidth = 777; state.caption = 'de'; });
  store.flush();
  const reloaded = new StateStore(file);
  assert.equal(reloaded.value.pinned, false);
  assert.equal(reloaded.value.window.videoWidth, 777);
  assert.equal(reloaded.value.caption, 'de');
});

test('sanitizes and persists the preferred caption track', () => {
  assert.equal(sanitizeState({ caption: 'de-DE' }).caption, 'de-DE');
  assert.equal(sanitizeState({ caption: '<script>' }).caption, null);
});
