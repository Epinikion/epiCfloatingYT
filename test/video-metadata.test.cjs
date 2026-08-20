'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { VideoMetadataService, normalizeIds, normalizeTitle } = require('../src/main/video-metadata.cjs');

test('normalizes bounded YouTube metadata requests', () => {
  assert.deepEqual(normalizeIds(['AAAAAAAAAAA', 'bad', 'AAAAAAAAAAA', 'BBBBBBBBBBB']), ['AAAAAAAAAAA', 'BBBBBBBBBBB']);
  assert.equal(normalizeTitle('  Ein\n eleganter   Titel  '), 'Ein eleganter Titel');
});

test('loads and caches playlist titles while preserving the requested order', async () => {
  const calls = [];
  const service = new VideoMetadataService({
    fetchImpl: async (url) => {
      calls.push(url);
      const id = new URL(new URL(url).searchParams.get('url')).searchParams.get('v');
      return {
        ok: true,
        headers: { get: () => null },
        text: async () => JSON.stringify({ title: id === 'AAAAAAAAAAA' ? 'Erstes Video' : 'Zweites Video' }),
      };
    },
  });

  const first = await service.resolve(['BBBBBBBBBBB', 'AAAAAAAAAAA']);
  assert.deepEqual(first.items.map(({ id, title }) => ({ id, title })), [
    { id: 'BBBBBBBBBBB', title: 'Zweites Video' },
    { id: 'AAAAAAAAAAA', title: 'Erstes Video' },
  ]);
  await service.resolve(['AAAAAAAAAAA', 'BBBBBBBBBBB']);
  assert.equal(calls.length, 2);
});
