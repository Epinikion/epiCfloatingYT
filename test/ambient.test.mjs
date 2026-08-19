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
