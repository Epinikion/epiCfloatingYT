'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { sanitizePlayerResponse } = require('../src/guest/response-filter.cjs');

test('removes ad metadata while preserving playback data', () => {
  const result = sanitizePlayerResponse({
    playerAds: [{ id: 1 }],
    adPlacements: [{ id: 2 }],
    adSlots: [{ id: 3 }],
    adBreakParams: 'blocked',
    streamingData: { formats: [{ itag: 18 }] },
  });
  assert.deepEqual(result.playerAds, []);
  assert.deepEqual(result.adPlacements, []);
  assert.deepEqual(result.adSlots, []);
  assert.equal(result.adBreakParams, undefined);
  assert.equal(result.streamingData.formats[0].itag, 18);
});

test('sanitizes nested playerResponse JSON', () => {
  const result = sanitizePlayerResponse({ playerResponse: JSON.stringify({ playerAds: [1], videoDetails: { videoId: 'dQw4w9WgXcQ' } }) });
  const nested = JSON.parse(result.playerResponse);
  assert.deepEqual(nested.playerAds, []);
  assert.equal(nested.videoDetails.videoId, 'dQw4w9WgXcQ');
});

