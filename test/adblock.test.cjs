'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { shouldBlock } = require('../src/main/adblock.cjs');

test('blocks advertising requests without broad host substring matching', () => {
  assert.equal(shouldBlock('https://static.doubleclick.net/instream/ad_status.js'), true);
  assert.equal(shouldBlock('https://www.youtube.com/api/stats/ads?ver=2'), true);
  assert.equal(shouldBlock('https://rr1---sn.example.googlevideo.com/videoplayback?vad_type=linear'), true);
  assert.equal(shouldBlock('https://www.youtube.com/watch?v=U9NEoHrkldM'), false);
  assert.equal(shouldBlock('https://notyoutube.com/video?adformat=1'), false);
  assert.equal(shouldBlock('not a url'), false);
});

