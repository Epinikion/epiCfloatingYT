'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { collectMediaFiles, mediaType } = require('../src/main/local-media.cjs');
const { LocalPlayerServer, parseRange } = require('../src/main/local-server.cjs');

test('discovers supported local videos recursively in natural order', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'floatingyt-media-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const nested = path.join(directory, 'Staffel 2');
  fs.mkdirSync(nested);
  for (const relative of ['Video 10.mp4', 'Video 2.webm', 'Notiz.txt', path.join('Staffel 2', 'Folge 1.mkv')]) {
    fs.writeFileSync(path.join(directory, relative), 'media');
  }

  const result = await collectMediaFiles([directory]);
  assert.deepEqual(result.files.map((file) => path.basename(file)), ['Folge 1.mkv', 'Video 2.webm', 'Video 10.mp4']);
  assert.equal(result.truncated, false);
  assert.equal(mediaType('movie.MP4'), 'video/mp4');
  assert.equal(mediaType('notes.txt'), null);
});

test('limits large dropped folders without exposing unsupported files', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'floatingyt-limit-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (let index = 1; index <= 4; index += 1) fs.writeFileSync(path.join(directory, `clip ${index}.mp4`), 'x');
  const result = await collectMediaFiles([directory], { limit: 2 });
  assert.equal(result.files.length, 2);
  assert.equal(result.truncated, true);
});

test('parses bounded HTTP byte ranges', () => {
  assert.deepEqual(parseRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseRange('bytes=7-', 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.equal(parseRange('bytes=20-30', 10), false);
  assert.equal(parseRange('items=0-2', 10), false);
});

test('streams only registered media tokens with seeking support', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'floatingyt-stream-'));
  const file = path.join(directory, 'Sample.mp4');
  fs.writeFileSync(file, Buffer.from('0123456789'));
  const server = new LocalPlayerServer({ playerDirectory: path.join(__dirname, '..', 'src', 'player') });
  context.after(() => { server.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  await server.start();
  const [item] = server.registerMedia([file]);

  assert.deepEqual(Object.keys(item).sort(), ['id', 'name']);
  assert.equal(item.name, 'Sample.mp4');
  const partial = await fetch(`${server.baseUrl}/media/${item.id}`, { headers: { range: 'bytes=2-5' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(partial.headers.get('accept-ranges'), 'bytes');
  assert.equal(await partial.text(), '2345');
  assert.equal((await fetch(`${server.baseUrl}/media/${'0'.repeat(36)}`)).status, 404);
  assert.equal((await fetch(`${server.baseUrl}/local.html`)).status, 200);
});
