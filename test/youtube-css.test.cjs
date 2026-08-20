'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension', 'youtube.css'), 'utf8');
const content = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension', 'content.js'), 'utf8');

test('hides classic and localized YouTube theater-mode controls in fallback playback', () => {
  assert.match(css, /\.ytp-size-button/);
  assert.match(css, /aria-label\*="theater mode"/i);
  assert.match(css, /aria-label\*="theatre mode"/i);
  assert.match(css, /aria-label\*="kinomodus"/i);
});

test('keeps only play-pause and the raised timeline in fallback controls', () => {
  assert.match(css, /--floating-timeline-bottom:\s*clamp\(18px,/);
  assert.match(css, /\.ytp-chrome-bottom \.ytp-button:not\(\.ytp-play-button\)/);
  assert.match(css, /\.ytp-time-contents/);
  assert.match(css, /\.ytp-autonav-toggle/);
  assert.match(css, /\.ytp-play-button, \.player-control-play-pause-icon/);
  assert.match(css, /left:\s*50%\s*!important/);
  assert.match(css, /margin:\s*0\s*!important/);
  assert.match(css, /background:\s*transparent\s*!important/);
  assert.match(css, /filter:\s*drop-shadow/);
  assert.match(css, /player-middle-controls button:not\(\.player-control-play-pause-icon\)/);
  assert.match(css, /player-middle-controls\s*\{[\s\S]*width:\s*100vw\s*!important/);
  assert.match(css, /player-middle-controls\s*\{[\s\S]*transform:\s*none\s*!important/);
  assert.match(css, /player-middle-controls \.player-control-play-pause-icon/);
  assert.match(css, /\.player-controls-bottom/);
  assert.match(css, /::before,/);
  assert.match(css, /::after\s*\{/);
  assert.match(css, /--floating-brand-warm:\s*#ff4b36/);
  assert.match(css, /--floating-brand-pink:\s*#ff238f/);
  assert.match(css, /\.ytp-play-progress, \.ytPlayerProgressBarPlayed/);
  assert.match(css, /\.ytProgressBarLineProgressBarPlayed/);
  assert.match(css, /#__floating-time-display\s*\{/);
  assert.match(css, /bottom:\s*calc\(var\(--floating-timeline-bottom\) \+ 27px\)/);
  assert.match(css, /font:\s*500[^;]*"Segoe UI"/);
  assert.match(content, /formatTime\(video\.currentTime\)/);
  assert.match(content, /formatTime\(duration\)/);
  assert.doesNotMatch(css, /\.ytp-scrubber-button/);
});

test('keeps plain video clicks inert while preserving explicit controls', () => {
  assert.match(content, /document\.addEventListener\('click',[\s\S]*if \(isControl\(event\)\) return;[\s\S]*stopImmediatePropagation\(\)/);
  assert.doesNotMatch(content, /if \(!moved \|\| isControl\(event\)\) return/);
});

test('blocks the YouTube and native video context menus', () => {
  assert.match(content, /addEventListener\('contextmenu'/);
  assert.match(content, /event\.preventDefault\(\)/);
  assert.match(content, /event\.stopImmediatePropagation\(\)/);
  assert.match(content, /if \(youtube\) installContextMenuBlocker\(\)/);
});
