'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MediaResolver, normalizeYtDlpError, parseResumeTimes, validation } = require('../src/main/media-resolver.cjs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { importCookieFile } = require('../src/main/cookie-file.cjs');

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

test('reads YouTube resume points and the login state from the signed-in history', async () => {
  const page = '"watchEndpoint":{"videoId":"viyGj8-jl5s","params":"x","startTimeSeconds":1216}'
    + '"watchEndpoint":{"videoId":"viyGj8-jl5s","startTimeSeconds":5}'
    + '"watchEndpoint":{"videoId":"BSjRjyuET74","startTimeSeconds":3}';
  const dump = `[youtube:tab] Dumping request\n${Buffer.from(page.padEnd(1200, ' ')).toString('base64')}\n`;
  assert.deepEqual(parseResumeTimes(dump), { 'viyGj8-jl5s': 1216, BSjRjyuET74: 3 });

  let browser = '';
  let now = 0;
  const calls = [];
  let reply = { error: null, stdout: dump, stderr: '' };
  const resolver = new MediaResolver({ cookieBrowser: () => browser, now: () => now, run: async (args) => { calls.push(args); return reply; } });
  assert.deepEqual(await resolver.youtubeAccount(), { status: 'off', browser: '', times: {} });
  assert.equal(calls.length, 0);

  browser = 'firefox';
  assert.deepEqual(await resolver.youtubeAccount(), { status: 'ok', browser: 'firefox', times: { 'viyGj8-jl5s': 1216, BSjRjyuET74: 3 } });
  assert.deepEqual(calls[0].slice(0, 2), ['--cookies-from-browser', 'firefox']);
  assert.ok(calls[0].includes('--dump-pages') && calls[0].includes('https://www.youtube.com/feed/history'));
  now = 30_000;
  await resolver.youtubeAccount();
  assert.equal(calls.length, 1);

  reply = { error: { code: 1 }, stdout: '', stderr: 'ERROR: [youtube:tab] history: The playlist does not exist.' };
  assert.equal((await resolver.youtubeAccount({ refresh: true })).status, 'signed-out');
  reply = { error: { code: 1 }, stdout: '', stderr: 'ERROR: Could not copy Chrome cookie database. See issue 7271' };
  assert.equal((await resolver.youtubeAccount({ refresh: true })).error, 'Cookies nicht lesbar – Firefox schließen');
  browser = 'chrome';
  assert.equal((await resolver.youtubeAccount({ refresh: true })).error, 'Cookies verschlüsselt – Cookie-Datei nutzen');
  browser = 'firefox';
  reply = { error: { code: 'ENOENT' }, stdout: '', stderr: '' };
  resolver.forgetAccount();
  assert.deepEqual(await resolver.youtubeAccount(), { status: 'error', browser: 'firefox', error: 'yt-dlp fehlt', times: {} });
});

test('passes an exported cookie file to yt-dlp instead of browser cookies', async () => {
  const calls = [];
  let exists = false;
  const resolver = new MediaResolver({
    cookieBrowser: () => 'file',
    cookieFile: () => 'C:/data/youtube-cookies.txt',
    fileExists: () => exists,
    run: async (args) => { calls.push(args); return { error: null, stdout: 'AAAAAAAAAAA\nBBBBBBBBBBB\n', stderr: '' }; },
  });
  assert.deepEqual(await resolver.youtubeAccount(), { status: 'error', browser: 'file', error: 'Cookie-Datei fehlt', times: {} });
  assert.equal(calls.length, 0);

  exists = true;
  assert.equal((await resolver.youtubeAccount()).status, 'ok');
  assert.deepEqual(await resolver.resolveQueue({ list: 'WL' }), { ids: ['AAAAAAAAAAA', 'BBBBBBBBBBB'] });
  for (const args of calls) {
    assert.deepEqual(args.slice(0, 2), ['--cookies', 'C:/data/youtube-cookies.txt']);
    assert.ok(!args.includes('--cookies-from-browser'));
  }
});

test('imports only a Netscape cookie file that holds YouTube cookies', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'floatingyt-test-'));
  const source = path.join(directory, 'export.txt');
  const target = path.join(directory, 'youtube-cookies.txt');
  try {
    await fs.writeFile(source, 'name=value');
    assert.deepEqual(await importCookieFile(source, target), { error: 'Keine cookies.txt im Netscape-Format' });
    await fs.writeFile(source, '# Netscape HTTP Cookie File\n.google.com\tTRUE\t/\tTRUE\t0\tSID\tx\n');
    assert.deepEqual(await importCookieFile(source, target), { error: 'Keine YouTube-Cookies in der Datei' });
    const cookies = '# Netscape HTTP Cookie File\n#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1893456000\tLOGIN_INFO\tabc\n';
    await fs.writeFile(source, cookies);
    assert.deepEqual(await importCookieFile(source, target), { error: null });
    assert.equal(await fs.readFile(target, 'utf8'), cookies);
    assert.deepEqual(await importCookieFile(path.join(directory, 'missing.txt'), target), { error: 'Datei nicht lesbar' });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
