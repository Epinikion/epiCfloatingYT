'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const manifest = JSON.parse(read('src/extension/manifest.json'));
const quality = read('src/extension/quality-main.js');
const responseFilter = read('src/extension/response-filter-main.js');
const content = read('src/extension/content.js');
const embed = read('src/player/embed.js');
const guest = read('src/guest/guest-preload.cjs');
const playback = read('src/renderer/playback-controller.mjs');

test('uses native quality choices for watch fallback and a fixed stream constraint for embeds', () => {
  assert.ok(manifest.content_scripts.some(({ js, world }) => world === 'MAIN' && js.includes('quality-main.js')));
  assert.match(quality, /\.ytp-settings-button/);
  assert.match(quality, /hd1440:\s*1440/);
  assert.match(quality, /qualityMenu\.click\(\)/);
  assert.match(quality, /target\.click\(\)/);
  assert.match(quality, /setPlaybackQualityRange/);
  assert.doesNotMatch(quality, /getClientRects/);
  assert.match(guest, /type:'quality'/);
  assert.match(content, /'quality-status'/);
  assert.match(embed, /currentTime:\s*player\.getCurrentTime/);
  assert.match(playback, /#reloadEmbedForQuality/);
  assert.match(playback, /buildEmbedUrl\(this\.baseUrl, this\.current\)/);
  assert.match(embed, /autoplay:\s*1/);
  assert.match(embed, /playerVars\.vq = initial\.quality/);
  assert.doesNotMatch(responseFilter, /delete streamingData\.serverAbrStreamingUrl/);
});

test('keeps only the selected embed resolution while preserving audio streams', () => {
  const context = vm.createContext({
    window: {},
    location: { search: '?vq=hd1440' },
    URLSearchParams,
    Response: undefined,
  });
  vm.runInContext(responseFilter, context);
  context.rawResponse = JSON.stringify({
    streamingData: {
      serverAbrStreamingUrl: 'https://example.invalid/sabr',
      formats: [{ itag: 18, height: 360 }, { itag: 22, height: 720 }],
      adaptiveFormats: [
        { itag: 140, mimeType: 'audio/mp4' },
        { itag: 137, height: 1080 },
        { itag: 271, height: 1440 },
        { itag: 313, height: 2160 },
      ],
    },
  });

  const result = vm.runInContext('JSON.parse(rawResponse)', context);
  // Removing this entry point makes the modern player fail with an error
  // screen instead of honouring the constrained format list.
  assert.equal(result.streamingData.serverAbrStreamingUrl, 'https://example.invalid/sabr');
  assert.deepEqual(
    Array.from(result.streamingData.adaptiveFormats, (format) => format.itag),
    [140, 271],
  );
  assert.deepEqual(Array.from(result.streamingData.formats), []);
});

test('selects the requested 1440p row through the native YouTube menu', async () => {
  let listener = null;
  let rows = [];
  let selected = '';
  const reports = [];
  const row = (label, onClick = () => {}) => ({
    textContent: label,
    getAttribute: () => '',
    getClientRects: () => [{}],
    querySelector: () => ({ textContent: label }),
    click: onClick,
  });
  const qualityMenu = row('Qualität Auto (720p)', () => {
    rows = [
      row('1440p HD', () => { selected = '1440p'; }),
      row('1080p HD', () => { selected = '1080p'; }),
      row('Automatisch'),
    ];
  });
  const player = { setPlaybackQualityRange() {}, setPlaybackQuality() {} };
  const settings = { click: () => { rows = [qualityMenu]; } };
  const window = {
    parent: null,
    addEventListener: (_type, callback) => { listener = callback; },
    postMessage: (message) => reports.push(message),
  };
  window.parent = window;
  const document = {
    documentElement: { dataset: {} },
    querySelector: (selector) => selector === '.html5-video-player' ? player : settings,
    querySelectorAll: () => rows,
  };
  vm.runInNewContext(quality, {
    window,
    document,
    location: { origin: 'https://www.youtube-nocookie.com' },
    URL,
    Set,
    Object,
    Promise,
    setTimeout: (callback) => { callback(); return 1; },
  });

  listener({
    source: window,
    origin: 'https://www.youtube-nocookie.com',
    data: { source: 'floatingyt-host', type: 'quality', payload: { value: 'hd1440' } },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(selected, '1440p');
  assert.equal(document.documentElement.dataset.floatingQuality, 'hd1440');
  assert.equal(reports.at(-1).payload.applied, true);
});
