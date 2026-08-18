'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { boundedRange, forwardHeaders } = require('../src/main/local-server.cjs');
const { MediaSessionRegistry, chooseFormats } = require('../src/main/media-resolver.cjs');

test('selects the best browser-compatible split stream up to 1080p', () => {
  const selected = chooseFormats([
    { protocol: 'https', url: 'https://media/4k', acodec: 'none', vcodec: 'avc1.1', ext: 'mp4', height: 2160, tbr: 10000 },
    { protocol: 'https', url: 'https://media/720', acodec: 'none', vcodec: 'avc1.1', ext: 'mp4', height: 720, tbr: 2000, http_headers: { Referer: 'x' } },
    { protocol: 'https', url: 'https://media/1080', acodec: 'none', vcodec: 'avc1.1', ext: 'mp4', height: 1080, tbr: 4000 },
    { protocol: 'https', url: 'https://media/audio', acodec: 'mp4a.40.2', vcodec: 'none', ext: 'm4a', abr: 160 },
  ]);
  assert.equal(selected.video.url, 'https://media/1080');
  assert.equal(selected.audio.url, 'https://media/audio');
  assert.equal(selected.height, 1080);
});

test('bounds open-ended ranges and only forwards media request headers', () => {
  assert.deepEqual(boundedRange('bytes=200-'), { start: 200, end: 1_048_775 });
  assert.deepEqual(boundedRange('bytes=200-499'), { start: 200, end: 499 });
  assert.deepEqual(forwardHeaders({ 'User-Agent': 'x', Cookie: 'secret', Referer: 'https://youtube.com/' }), {
    'User-Agent': 'x', Referer: 'https://youtube.com/',
  });
});

test('isolates media sessions by unguessable token and track', () => {
  const registry = new MediaSessionRegistry({ ttlMs: 1000, limit: 2 });
  const token = registry.add({ video: { url: 'https://video' }, audio: { url: 'https://audio' } });
  assert.match(token, /^[A-Za-z0-9_-]{20,}$/);
  assert.equal(registry.get(token, 'video').url, 'https://video');
  assert.equal(registry.get(token, 'other'), null);
  assert.equal(registry.get('wrong', 'video'), null);
});

