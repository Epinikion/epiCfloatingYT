import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { AmbientLight } from '../src/renderer/visual-effects.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const windowController = fs.readFileSync(path.join(directory, '..', 'src', 'main', 'window-controller.cjs'), 'utf8');

test('samples ambient light responsively without targeting full frame rate', () => {
  const interval = Number(windowController.match(/const AMBIENT_INTERVAL = (\d+);/)?.[1]);
  assert.ok(interval >= 60 && interval <= 80, `unexpected ambient interval: ${interval}`);
});

test('preserves black bars instead of stretching video content across them', () => {
  const drawCalls = [];
  const outputContext = {
    globalAlpha: 1,
    save() {},
    restore() {},
    drawImage(...arguments_) { drawCalls.push(arguments_); },
  };
  const sourceContext = { putImageData() {} };
  const canvas = { width: 80, height: 45, getContext: () => outputContext };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => sourceContext }) };
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) { Object.assign(this, { data, width, height }); }
  };

  const ambient = new AmbientLight(canvas);
  const pixels = new Uint8Array(80 * 45 * 4);
  for (let y = 0; y < 45; y += 1) {
    for (let x = 16; x < 64; x += 1) {
      const offset = (y * 80 + x) * 4;
      pixels[offset] = 40;
      pixels[offset + 1] = 100;
      pixels[offset + 2] = 220;
      pixels[offset + 3] = 255;
    }
  }

  ambient.update({ width: 80, height: 45, pixels });

  assert.equal(drawCalls.length, 1);
  assert.equal(drawCalls[0].length, 5, 'ambient rendering must use the complete captured frame');
  assert.deepEqual(drawCalls[0].slice(1), [0, 0, 80, 45]);
});

test('picks the toolbar tone per area by its worst-case contrast', async () => {
  const { GLYPH_LUMINANCE, areaLuminance, nextTone } = await import('../src/renderer/visual-effects.mjs');
  // Top rows bright on the left half and dark on the right, like a news overlay.
  const width = 80;
  const height = 45;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) pixels.fill(y < 3 && x < 40 ? 240 : 10, (y * width + x) * 4, (y * width + x) * 4 + 4);
  }
  const frame = { width, height, pixels };
  const leftArea = areaLuminance(frame, { left: 0, right: 0.25, top: 0, bottom: 0.06 });
  const rightArea = areaLuminance(frame, { left: 0.6, right: 1, top: 0, bottom: 0.06 });
  assert.ok(leftArea.low > 0.8 && leftArea.high > 0.8);
  assert.ok(rightArea.high < 0.01);
  assert.equal(areaLuminance({ width, height, pixels: new Uint8Array(10) }), null);

  assert.equal(nextTone('dark', leftArea, GLYPH_LUMINANCE.button), 'light');
  assert.equal(nextTone('light', rightArea, GLYPH_LUMINANCE.button), 'dark');
  // A mid-grey background reads about equally in both tones, so the tone stays.
  const grey = { low: 0.14, high: 0.16 };
  assert.equal(nextTone('dark', grey, GLYPH_LUMINANCE.button), 'dark');
  assert.equal(nextTone('light', grey, GLYPH_LUMINANCE.button), 'light');
  assert.equal(nextTone('light', null, GLYPH_LUMINANCE.button), 'light');
});

test('recognizes a frame that protected video left black', async () => {
  const { isBlankFrame } = await import('../src/renderer/visual-effects.mjs');
  const pixels = new Uint8Array(80 * 45 * 4).fill(3);
  assert.equal(isBlankFrame({ width: 80, height: 45, pixels }), true);
  pixels[4000] = 40;
  assert.equal(isBlankFrame({ width: 80, height: 45, pixels }), false);
  assert.equal(isBlankFrame(null), false);
});
