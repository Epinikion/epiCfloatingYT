'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'player', 'local.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '..', 'src', 'player', 'local.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'player', 'local.css'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'app-preload.cjs'), 'utf8');
const guestPreload = fs.readFileSync(path.join(__dirname, '..', 'src', 'guest', 'guest-preload.cjs'), 'utf8');
const rendererHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
const rendererCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');

test('provides a focused local HTML5 video player with matching controls', () => {
  assert.match(html, /<video id="video"[^>]*autoplay/);
  assert.match(html, /id="play"/);
  assert.match(html, /id="timeline"[^>]*type="range"/);
  assert.match(html, /id="time"[^>]*role="timer"/);
  assert.match(script, /command\.name === 'volume-step'/);
  assert.match(script, /command\.name === 'boost'/);
  assert.match(script, /createMediaElementSource\(video\)/);
  assert.match(script, /window\.floatingHost\.emit\('local-status'/);
  assert.match(script, /video\.addEventListener\('error'/);
  assert.match(css, /linear-gradient\(90deg,[\s\S]*--brand-pink/);
  assert.match(css, /body\.controls-hidden #play/);
});

test('captures file and folder drops in both host and guest surfaces', () => {
  for (const source of [preload, guestPreload]) {
    assert.match(source, /webUtils\.getPathForFile/);
    assert.match(source, /local-media:open/);
    assert.match(source, /addEventListener\('drop'/);
  }
  assert.match(rendererHtml, /id="drop-overlay"/);
  assert.match(rendererCss, /body\.drop-active #drop-overlay[\s\S]*pointer-events:\s*auto/);
  assert.match(rendererHtml, /Videodatei oder Ordner hier ablegen/);
  for (const id of ['playlist', 'playlist-panel', 'playlist-list', 'playlist-count']) {
    assert.match(rendererHtml, new RegExp(`id="${id}"`));
  }
  assert.match(rendererCss, /#playlist-panel[\s\S]*backdrop-filter:\s*blur/);
  assert.match(rendererCss, /\.playlist-item\[aria-selected="true"\]/);
});
