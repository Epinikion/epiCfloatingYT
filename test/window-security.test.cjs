'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { WindowController, isAllowedGuestUrl, shouldGhost, shouldPassMouseThrough } = require('../src/main/window-controller.cjs');

test('limits guest navigation to the local player, YouTube, and consent', () => {
  const origin = 'http://127.0.0.1:4321';
  assert.equal(isAllowedGuestUrl(`${origin}/embed.html`, origin), true);
  assert.equal(isAllowedGuestUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', origin), true);
  assert.equal(isAllowedGuestUrl('https://consent.google.com/m', origin), true);
  assert.equal(isAllowedGuestUrl('https://youtube.com.evil.test/', origin), false);
  assert.equal(isAllowedGuestUrl('file:///C:/secret.txt', origin), false);
  assert.equal(isAllowedGuestUrl('javascript:alert(1)', origin), false);
});

test('keeps the ambient margin interactive throughout a custom resize', () => {
  const base = { glow: true, fullscreen: false, dragging: false, overWindow: true, overVideo: false };
  assert.equal(shouldPassMouseThrough({ ...base, resizing: false }), true);
  assert.equal(shouldPassMouseThrough({ ...base, resizing: true }), false);
  assert.equal(shouldPassMouseThrough({ ...base, resizing: false, dragging: true }), false);
});

test('opens the playlist shortcut without toggling always-on-top', () => {
  const controller = new WindowController({});
  const messages = [];
  let pinToggles = 0;
  controller.window = {};
  controller.send = (channel, payload) => messages.push({ channel, payload });
  controller.togglePin = () => { pinToggles += 1; };

  assert.equal(controller.handleInput({ type: 'keyDown', key: 'p', control: true, shift: true }, false), true);
  assert.deepEqual(messages, [{ channel: 'app:shortcut', payload: { name: 'playlist' } }]);
  assert.equal(pinToggles, 0);
});

test('turns arrow keys and J/L inside the player into ten-second seeks', () => {
  const controller = new WindowController({});
  const messages = [];
  controller.window = {};
  controller.send = (channel, payload) => messages.push({ channel, payload });

  assert.equal(controller.handleInput({ type: 'keyDown', key: 'ArrowLeft' }, true), true);
  assert.equal(controller.handleInput({ type: 'keyDown', key: 'l' }, true), true);
  assert.equal(controller.handleInput({ type: 'keyDown', key: 'ArrowRight', control: true }, true), true);
  assert.equal(controller.handleInput({ type: 'keyDown', key: 'ArrowRight' }, false), false);
  assert.deepEqual(messages.map(({ payload }) => payload), [
    { name: 'seek', delta: -10 },
    { name: 'seek', delta: 10 },
    { name: 'next' },
  ]);
});

test('keeps the stored video size when Windows rounds the window up', () => {
  const store = {
    value: { glow: true, window: { videoWidth: 1078, videoHeight: 609, x: 0, y: 0, aspect: 16 / 9 } },
    schedule() {},
    flush() {},
  };
  const controller = new WindowController({ store });
  controller.window = { isDestroyed: () => false, getBounds: () => ({ x: 562, y: 244, width: 1245, height: 706 }) };

  controller.saveWindowState(true);
  assert.deepEqual(store.value.window, { videoWidth: 1078, videoHeight: 609, x: 562, y: 244, aspect: 16 / 9 });

  controller.resize = { target: { x: 562, y: 244, width: 1380, height: 780 } };
  controller.endResize();
  assert.equal(store.value.window.videoWidth, 1200);
  assert.equal(store.value.window.videoHeight, 678);
});

test('fades for click-through only while the pointer rests on the video', () => {
  const base = { enabled: true, fullscreen: false, resizing: false, dragging: false, overVideo: true };
  assert.equal(shouldGhost(base), true);
  assert.equal(shouldGhost({ ...base, enabled: false }), false);
  assert.equal(shouldGhost({ ...base, overVideo: false }), false);
  assert.equal(shouldGhost({ ...base, fullscreen: true }), false);
  assert.equal(shouldGhost({ ...base, dragging: true }), false);
  assert.equal(shouldGhost({ ...base, resizing: true }), false);
});

test('restores the chosen opacity when click-through is switched off', () => {
  const store = { value: { ghost: false, opacity: 0.8 }, patch(mutator) { mutator(this.value); }, schedule() {} };
  const controller = new WindowController({ store });
  const opacities = [];
  const messages = [];
  controller.window = { isDestroyed: () => false, setOpacity: (value) => opacities.push(value) };
  controller.send = (channel, payload) => messages.push({ channel, payload });

  assert.equal(controller.toggleGhost(), true);
  assert.deepEqual(opacities, []);
  controller.ghostActive = true;
  assert.equal(controller.toggleGhost(), false);
  assert.deepEqual(opacities, [0.8]);
  assert.equal(controller.ghostActive, false);
  assert.deepEqual(messages.map(({ payload }) => payload), [{ name: 'ghost', value: true }, { name: 'ghost', value: false }]);
});
