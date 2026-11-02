import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { buildTwitchUrl, isSupportedVideoLink, parseTwitchInput } from '../src/shared/twitch-url.mjs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('parses Twitch VODs, live channels and timestamps without trusting lookalike hosts', () => {
  assert.deepEqual(parseTwitchInput('https://www.twitch.tv/videos/2913876098'), { platform: 'twitch', video: '2913876098', channel: null, start: 0 });
  assert.deepEqual(parseTwitchInput('twitch.tv/videos/2913876098?t=1h2m3s'), { platform: 'twitch', video: '2913876098', channel: null, start: 3723 });
  assert.deepEqual(parseTwitchInput('https://m.twitch.tv/handofblood/v/2913876098'), { platform: 'twitch', video: '2913876098', channel: null, start: 0 });
  assert.deepEqual(parseTwitchInput('https://player.twitch.tv/?video=v2913876098&parent=x'), { platform: 'twitch', video: '2913876098', channel: null, start: 0 });
  assert.deepEqual(parseTwitchInput('https://www.twitch.tv/HandOfBlood'), { platform: 'twitch', video: null, channel: 'handofblood', start: 0 });
  assert.deepEqual(parseTwitchInput('https://clips.twitch.tv/FunnyClip-abc_123'), { platform: 'twitch', clip: 'FunnyClip-abc_123' });
  assert.deepEqual(parseTwitchInput('https://www.twitch.tv/handofblood/clip/FunnyClip-abc_123'), { platform: 'twitch', clip: 'FunnyClip-abc_123' });

  for (const input of [
    'https://www.twitch.tv/directory', 'https://www.twitch.tv/videos/abc', 'https://www.twitch.tv/handofblood/about',
    'https://twitch.tv.evil.test/videos/2913876098', 'https://example.com/videos/2913876098', 'handofblood', '',
  ]) assert.equal(parseTwitchInput(input), null, input);

  assert.equal(isSupportedVideoLink('https://www.twitch.tv/videos/2913876098'), true);
  assert.equal(isSupportedVideoLink('dQw4w9WgXcQ'), true);
  assert.equal(isSupportedVideoLink('lofi hip hop'), false);
});

test('builds the local Twitch player URL', () => {
  assert.equal(buildTwitchUrl('http://127.0.0.1:1234/', { video: '2913876098', start: 90 }), 'http://127.0.0.1:1234/twitch.html?video=2913876098&start=90');
  assert.equal(buildTwitchUrl('http://127.0.0.1:1234', { channel: 'handofblood', start: 90 }), 'http://127.0.0.1:1234/twitch.html?channel=handofblood');
});

test('serves the Twitch player locally with the app controls and window gestures', () => {
  const server = read('src/main/local-server.cjs');
  const player = read('src/player/twitch.js');
  const preload = read('src/guest/guest-preload.cjs');
  const content = read('src/extension/content.js');
  const manifest = JSON.parse(read('src/extension/manifest.json'));

  assert.match(server, /\['\/twitch\.html', \['twitch\.html'/);
  assert.match(server, /TWITCH_ORIGINS = 'https:\/\/player\.twitch\.tv'/);
  assert.match(read('src/player/twitch.html'), /src="https:\/\/player\.twitch\.tv\/js\/embed\/v1\.js"/);
  assert.match(player, /parent: \[location\.hostname\]/);
  for (const name of ['boost', 'toggle', 'mute-toggle', 'volume-step', 'seek', 'quality', 'info']) assert.match(player, new RegExp(`command\.name === '${name}'`));
  assert.match(preload, /host === 'player\.twitch\.tv'/);
  assert.match(preload, /'twitch-title'/);
  assert.match(content, /if \(twitch\) \{\s*installGestures\(\);/);
  assert.ok(manifest.content_scripts.some(({ matches, js, world }) => matches.includes('https://player.twitch.tv/*') && js.includes('content.js') && !world));
  assert.ok(manifest.content_scripts.some(({ matches, js, world }) => matches.includes('https://player.twitch.tv/*') && js.includes('audio-boost-main.js') && world === 'MAIN'));
});
