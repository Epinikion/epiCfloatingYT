'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extension = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension', 'audio-boost-main.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'extension', 'manifest.json'), 'utf8'));
const embed = fs.readFileSync(path.join(__dirname, '..', 'src', 'player', 'embed.js'), 'utf8');
const guest = fs.readFileSync(path.join(__dirname, '..', 'src', 'guest', 'guest-preload.cjs'), 'utf8');

test('routes bounded sound boost commands through local and YouTube players', () => {
  assert.ok(manifest.content_scripts.some(({ js, world }) => world === 'MAIN' && js.includes('audio-boost-main.js')));
  assert.match(extension, /\[1, 1\.5, 2, 3\]\.includes/);
  assert.match(extension, /createMediaElementSource\(video\)/);
  assert.match(extension, /currentSrc[\s\S]*origin === location\.origin/);
  assert.match(extension, /attempts < 20/);
  assert.match(extension, /createDynamicsCompressor/);
  assert.match(embed, /relayToPlayer\('boost'/);
  assert.match(guest, /case 'boost'/);
  assert.match(guest, /'boost-status'/);
});
