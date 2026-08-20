'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MediaResolver, normalizeYtDlpError, validation } = require('../src/main/media-resolver.cjs');

test('validates YouTube identifiers before resolving a personal list', async () => {
  assert.equal(validation.VIDEO_ID.test('AAAAAAAAAAA'), true);
  assert.equal(validation.VIDEO_ID.test('too-short'), false);
  assert.equal(validation.LIST_ID.test('RDMMabc'), true);
  assert.deepEqual(await new MediaResolver().resolveQueue({ id: 'bad', list: 'RDMMabc' }), {
    error: 'ungültige Liste',
  });
});

test('maps yt-dlp process failures to stable user-facing errors', () => {
  assert.equal(normalizeYtDlpError(null), null);
  assert.equal(normalizeYtDlpError({ code: 'ENOENT' }), 'yt-dlp fehlt');
  assert.equal(normalizeYtDlpError({ killed: true }), 'yt-dlp-Zeitüberschreitung');
  assert.equal(normalizeYtDlpError({}), 'yt-dlp fehlgeschlagen');
});
