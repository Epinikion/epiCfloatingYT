'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  GLOW_SCALE,
  minimumWindowSize,
  reshapeForAspect,
  resizeFromDirection,
  snapBounds,
  videoRect,
} = require('../src/main/geometry.cjs');

test('keeps the video rectangle centered inside the ambient margin', () => {
  const bounds = { x: 100, y: 50, width: Math.round(640 * GLOW_SCALE), height: Math.round(360 * GLOW_SCALE) };
  const rect = videoRect(bounds, 16 / 9, true);
  assert.equal(rect.width, 640);
  assert.equal(rect.height, 360);
  assert.equal(rect.x, 148);
  assert.equal(rect.y, 77);
});

test('reshapes portrait videos around the existing center and within the display', () => {
  const result = reshapeForAspect(
    { x: 300, y: 200, width: 736, height: 414 },
    9 / 16,
    true,
    { x: 0, y: 0, width: 1920, height: 1080 },
  );
  assert.ok(result.height > result.width);
  assert.ok(result.x >= 0 && result.y >= 0);
  assert.ok(result.x + result.width <= 1920);
  assert.ok(result.y + result.height <= 1080);
});

test('custom resizing respects aspect and anchored edges', () => {
  const result = resizeFromDirection({
    start: { x: 100, y: 100, width: 736, height: 414 },
    direction: 'nw',
    cursorX: 50,
    cursorY: 70,
    originX: 100,
    originY: 100,
    aspect: 16 / 9,
    glow: true,
    lockAspect: true,
  });
  assert.equal(result.x + result.width, 836);
  assert.equal(result.y + result.height, 514);
  assert.ok(Math.abs(result.width / result.height - 16 / 9) < 0.01);
  const minimum = minimumWindowSize(16 / 9, true);
  assert.ok(result.width >= minimum.width && result.height >= minimum.height);
});

test('snaps bounds to the device-independent pixel grid', () => {
  assert.deepEqual(snapBounds({ x: 1, y: 3, width: 737, height: 415 }, 1.5), { x: 2, y: 4, width: 738, height: 416 });
});

