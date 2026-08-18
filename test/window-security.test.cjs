'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isAllowedGuestUrl } = require('../src/main/window-controller.cjs');

test('limits guest navigation to the local player, YouTube, and consent', () => {
  const origin = 'http://127.0.0.1:4321';
  assert.equal(isAllowedGuestUrl(`${origin}/embed.html`, origin), true);
  assert.equal(isAllowedGuestUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', origin), true);
  assert.equal(isAllowedGuestUrl('https://consent.google.com/m', origin), true);
  assert.equal(isAllowedGuestUrl('https://youtube.com.evil.test/', origin), false);
  assert.equal(isAllowedGuestUrl('file:///C:/secret.txt', origin), false);
  assert.equal(isAllowedGuestUrl('javascript:alert(1)', origin), false);
});

