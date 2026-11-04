import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { guideProgress, matchesGuideQuery } from '../src/renderer/guide-panel.mjs';

const require = createRequire(import.meta.url);
const { MagentaGuide, nowAndNext, parseChannels, parseListings, slug } = require('../src/main/magenta-guide.cjs');

const SCHEDULE = 'http://data.entertainment.tv.theplatform.eu/entertainment/data/ChannelSchedule/';
const station = (title, serviceId, isHd, logo = '') => ({
  s: { title, isHd, 'dt$serviceId': serviceId, thumbnails: logo ? { stationLogoColored: { url: logo } } : {} },
});
const stations = {
  entries: [
    { id: `${SCHEDULE}259549736360`, 'dt$displayChannelNumber': 1, stations: station('Das Erste', 'das-erste', true, 'https://dt-image-storage.broadpeak-vcdn.com/erste.png') },
    { id: `${SCHEDULE}262270504164`, 'dt$displayChannelNumber': 4, stations: station('SAT.1', 'sat.1', true) },
    { id: `${SCHEDULE}262269992391`, 'dt$displayChannelNumber': 4, stations: station('SAT.1', 'sat.1', false, 'https://dt-image-storage.broadpeak-vcdn.com/sat1.png') },
    { id: `${SCHEDULE}274350120287`, 'dt$displayChannelNumber': 6, stations: station('VOX SD', 'vox', false) },
    { id: `${SCHEDULE}1`, 'dt$displayChannelNumber': 9, stations: station('Broken', 'bad id!', false) },
  ],
};
const at = (hours, minutes = 0) => Date.UTC(2026, 10, 4, hours, minutes);
const schedules = {
  entries: [
    { id: `${SCHEDULE}259549736360`, listings: [
      { startTime: at(15, 10), endTime: at(16, 0), program: { title: 'Seelöwe & Co.', secondaryTitle: '' } },
      { startTime: at(16, 0), endTime: at(16, 10), program: { title: 'Tagesschau', secondaryTitle: 'vom 04.11.2026' } },
      { startTime: at(14, 0), endTime: at(15, 10), program: { title: '' } },
    ] },
    { id: `${SCHEDULE}262269992391`, listings: [{ startTime: at(15, 0), endTime: at(16, 0), program: { title: 'Auf Streife' } }] },
  ],
};

test('builds one guide row per channel with the link MagentaTV tiles use', () => {
  const channels = parseChannels(stations);
  assert.deepEqual(channels.map(({ number, title, url, scheduleIds }) => ({ number, title, url, scheduleIds })), [
    { number: 1, title: 'Das Erste', url: 'https://www.magenta.tv/streamen-tv/das-erste/das-erste', scheduleIds: ['259549736360'] },
    { number: 4, title: 'SAT.1', url: 'https://www.magenta.tv/streamen-tv/sat-1/sat.1', scheduleIds: ['262270504164', '262269992391'] },
    { number: 6, title: 'VOX', url: 'https://www.magenta.tv/streamen-tv/vox/vox', scheduleIds: ['274350120287'] },
  ]);
  assert.equal(channels[1].logo, `https://ngiss.t-online.de/iss?client=ftp22&out=webp&x=104&y=44&ar=keep&src=${encodeURIComponent('https://dt-image-storage.broadpeak-vcdn.com/sat1.png')}`);
  assert.equal(slug('Kabel Eins Doku'), 'kabel-eins-doku');
  assert.equal(slug('Münchner Zürich-Sender'), 'muenchner-zuerich-sender');
});

test('finds what runs now and next from any schedule variant', () => {
  const [erste, sat1, vox] = parseChannels(stations);
  const listings = parseListings([schedules]);
  const now = at(15, 35);
  const first = nowAndNext(erste, listings, now);
  assert.equal(first.now.title, 'Seelöwe & Co.');
  assert.equal(first.next.title, 'Tagesschau');
  assert.equal(nowAndNext(sat1, listings, now).now.title, 'Auf Streife');
  assert.deepEqual(nowAndNext(vox, listings, now), { now: null, next: null });
});

test('reads the feeds page by page and reports an unreachable source', async () => {
  const urls = [];
  const guide = new MagentaGuide({
    now: () => at(15, 35),
    fetchImpl: async (url) => {
      urls.push(url);
      const body = url.includes('channel-stations') ? stations : url.includes('range=1-100') ? schedules : { entries: [] };
      return { ok: true, json: async () => body };
    },
  });
  const result = await guide.guide();
  assert.equal(result.error, null);
  assert.deepEqual(result.channels.map((channel) => [channel.title, channel.now?.title || null]), [['Das Erste', 'Seelöwe & Co.'], ['SAT.1', 'Auf Streife'], ['VOX', null]]);
  assert.deepEqual(result.channels[1].ids, ['262270504164', '262269992391']);
  assert.ok(urls.every((url) => url.includes('fields=')), 'every request limits its fields');
  await guide.guide();
  assert.equal(urls.length, 2, 'channels and schedules are cached');

  const offline = await new MagentaGuide({ fetchImpl: async () => ({ ok: false, status: 503 }) }).guide();
  assert.deepEqual(offline.channels, []);
  assert.equal(offline.error, 'Programmdaten nicht erreichbar');
});

test('filters guide rows by name, number or show and measures progress', () => {
  const channel = { number: 13, title: 'ntv', now: { title: 'News Spezial', subtitle: '', start: 0, end: 100 } };
  assert.equal(matchesGuideQuery(channel, ''), true);
  assert.equal(matchesGuideQuery(channel, 'NTV'), true);
  assert.equal(matchesGuideQuery(channel, 'spezial'), true);
  assert.equal(matchesGuideQuery(channel, '13'), true);
  assert.equal(matchesGuideQuery(channel, '1'), true);
  assert.equal(matchesGuideQuery(channel, '2'), false);
  assert.equal(matchesGuideQuery(channel, 'zdf'), false);
  assert.equal(guideProgress(channel.now, 25), 0.25);
  assert.equal(guideProgress(channel.now, 400), 1);
  assert.equal(guideProgress(null, 25), 0);
});
