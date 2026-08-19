import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { searchResultMeta } from '../src/renderer/search-controller.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(directory, '..', file), 'utf8');
const html = read('src/renderer/index.html');
const styles = read('src/renderer/styles.css');
const app = read('src/renderer/app.mjs');
const controller = read('src/renderer/search-controller.mjs');
const preload = read('src/preload/app-preload.cjs');
const main = read('src/main/window-controller.cjs');

test('exposes an accessible responsive search surface', () => {
  for (const id of ['search', 'search-box', 'url-input', 'search-clear', 'search-feedback', 'search-results']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /role="combobox"[^>]*aria-controls="search-results"/);
  assert.match(html, /role="listbox"/);
  assert.match(styles, /#search-results\s*\{[^}]*overflow:\s*auto/s);
  assert.match(styles, /@media \(max-width: 360px\)/);
  assert.match(styles, /@media \(max-height: 360px\)/);
  assert.match(styles, /#stage\s*\{[^}]*container-type:\s*size/s);
  assert.match(styles, /@container \(max-height: 180px\)[\s\S]*#search-results\s*\{[^}]*overflow-x:\s*auto/);
});

test('wires debounced search and global discoverable shortcuts', () => {
  assert.match(preload, /searchVideos:\s*\(query\)\s*=>\s*ipcRenderer\.invoke\('video:search', query\)/);
  assert.match(controller, /const SEARCH_DELAY = 260/);
  assert.match(controller, /event\.key === 'ArrowDown'/);
  assert.match(controller, /event\.key === 'ArrowUp'/);
  assert.match(controller, /event\.key === 'Enter'/);
  assert.match(app, /case 'search': this\.toggleSearch\(true\)/);
  assert.match(app, /\(event\.ctrlKey \|\| event\.metaKey\) && \['f', 'l'\]\.includes\(key\)/);
  assert.match(main, /control && \['f', 'l'\]\.includes\(key\)/);
});

test('builds compact readable search metadata', () => {
  assert.equal(searchResultMeta({ channel: 'Kanal', published: 'vor 1 Jahr', views: '2 Mio. Aufrufe' }), 'Kanal · vor 1 Jahr · 2 Mio. Aufrufe');
  assert.equal(searchResultMeta({ channel: 'Kanal' }), 'Kanal');
});
