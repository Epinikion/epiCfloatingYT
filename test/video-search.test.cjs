'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  VideoSearchService,
  extractInitialData,
  normalizeSearchQuery,
  parseSearchResults,
  readLimitedText,
} = require('../src/main/video-search.cjs');

const initialData = {
  contents: [{ sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [
    { videoRenderer: {
      videoId: 'AAAAAAAAAAA',
      title: { runs: [{ text: 'Erstes Video' }] },
      ownerText: { runs: [{ text: 'Kanal A' }] },
      lengthText: { simpleText: '12:34' },
      shortViewCountText: { simpleText: '1,2 Mio. Aufrufe' },
      publishedTimeText: { simpleText: 'vor 2 Jahren' },
    } },
    { videoRenderer: {
      videoId: 'BBBBBBBBBBB',
      title: { simpleText: 'Live & direkt' },
      longBylineText: { runs: [{ text: 'Kanal B' }] },
      badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW', label: 'LIVE' } }],
    } },
    { videoRenderer: { videoId: 'invalid', title: { simpleText: 'Nicht übernehmen' } } },
  ] } }] } }],
};
const html = `<script>var ytInitialData = ${JSON.stringify(initialData)};</script>`;

test('normalizes bounded human search terms', () => {
  assert.equal(normalizeSearchQuery('  sims\n  soundtrack  '), 'sims soundtrack');
  assert.equal(normalizeSearchQuery(`x${'a'.repeat(300)}`).length, 160);
});

test('extracts and sanitizes public YouTube video results', () => {
  assert.deepEqual(extractInitialData(html), initialData);
  const results = parseSearchResults(html);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    id: 'AAAAAAAAAAA',
    title: 'Erstes Video',
    channel: 'Kanal A',
    duration: '12:34',
    views: '1,2 Mio. Aufrufe',
    published: 'vor 2 Jahren',
    live: false,
    thumbnail: 'https://i.ytimg.com/vi/AAAAAAAAAAA/mqdefault.jpg',
  });
  assert.equal(results[1].live, true);
});

test('deduplicates concurrent searches and caches successful results', async () => {
  let requests = 0;
  const search = new VideoSearchService({
    fetchImpl: async () => {
      requests += 1;
      return { ok: true, text: async () => html };
    },
  });
  const [first, second] = await Promise.all([search.search('Sims'), search.search('sims')]);
  const third = await search.search('SIMS');
  assert.equal(requests, 1);
  assert.equal(first.results.length, 2);
  assert.deepEqual(second.results, first.results);
  assert.deepEqual(third.results, first.results);
});

test('rejects oversized search responses before reading their body', async () => {
  let read = false;
  await assert.rejects(() => readLimitedText({
    headers: { get: () => String(7 * 1024 * 1024) },
    text: async () => { read = true; return ''; },
  }));
  assert.equal(read, false);
});
