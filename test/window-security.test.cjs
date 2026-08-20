'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { WindowController, isAllowedGuestUrl, shouldPassMouseThrough } = require('../src/main/window-controller.cjs');

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
