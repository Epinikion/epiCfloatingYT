import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEmbedUrl,
  buildWatchUrl,
  isPersonalPlaylist,
  parseStartTime,
  parseYouTubeInput,
} from '../src/shared/youtube-url.mjs';

test('parses supported YouTube links without trusting lookalike hosts', () => {
  assert.deepEqual(parseYouTubeInput('dQw4w9WgXcQ'), { id: 'dQw4w9WgXcQ', list: null, index: 0, start: 0 });
  assert.deepEqual(parseYouTubeInput('youtu.be/dQw4w9WgXcQ?t=1m5s'), { id: 'dQw4w9WgXcQ', list: null, index: 0, start: 65 });
  assert.deepEqual(parseYouTubeInput('https://www.youtube.com/shorts/dQw4w9WgXcQ?list=PL-test_12&index=5'), {
    id: 'dQw4w9WgXcQ', list: 'PL-test_12', index: 5, start: 0,
  });
  assert.equal(parseYouTubeInput('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeInput('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeInput('too-short'), null);
});

test('parses playlist-only links and human-readable start times', () => {
  assert.deepEqual(parseYouTubeInput('https://www.youtube.com/playlist?list=RDMM-test_1'), {
    id: null, list: 'RDMM-test_1', index: 0, start: 0,
  });
  assert.equal(parseStartTime('1h2m3s'), 3723);
  assert.equal(parseStartTime('98'), 98);
  assert.equal(parseStartTime('nonsense'), 0);
  assert.equal(isPersonalPlaylist('RDMMabc'), true);
  assert.equal(isPersonalPlaylist('PLabc'), false);
});

test('builds mode-specific URLs and keeps personal queues out of embeds', () => {
  assert.equal(
    buildEmbedUrl('http://127.0.0.1:1234', { id: 'dQw4w9WgXcQ', list: 'RDMMabc', start: 12 }),
    'http://127.0.0.1:1234/embed.html?v=dQw4w9WgXcQ&start=12',
  );
  assert.equal(
    buildEmbedUrl('http://127.0.0.1:1234', { id: 'dQw4w9WgXcQ', start: 12, quality: 'hd1440' }),
    'http://127.0.0.1:1234/embed.html?v=dQw4w9WgXcQ&start=12&quality=hd1440',
  );
  assert.equal(
    buildEmbedUrl('http://127.0.0.1:1234', { id: 'dQw4w9WgXcQ', quality: 'invalid' }),
    'http://127.0.0.1:1234/embed.html?v=dQw4w9WgXcQ',
  );
  assert.equal(
    buildWatchUrl({ id: 'dQw4w9WgXcQ', list: 'PLabc', index: 3, start: 12 }),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc&index=3&t=12',
  );
});
