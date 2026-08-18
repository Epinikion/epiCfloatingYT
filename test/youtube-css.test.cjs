'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension', 'youtube.css'), 'utf8');

test('hides classic and localized YouTube theater-mode controls in fallback playback', () => {
  assert.match(css, /\.ytp-size-button/);
  assert.match(css, /aria-label\*="theater mode"/i);
  assert.match(css, /aria-label\*="theatre mode"/i);
  assert.match(css, /aria-label\*="kinomodus"/i);
});
