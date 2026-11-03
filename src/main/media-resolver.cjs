'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{2,128}$/;
const TIMEOUT_MS = 30_000;
const MAX_CAPTURE = 96 * 1024 * 1024;
const QUEUE_LIMIT = 50;
const ACCOUNT_CACHE_MS = 60_000;
const HISTORY_URL = 'https://www.youtube.com/feed/history';
// yt-dlp drops the resume point from flat history entries, so it is read from
// the watch endpoints in the history page that --dump-pages prints as base64.
const RESUME_ENTRY = /"watchEndpoint":\{"videoId":"([A-Za-z0-9_-]{11})"[^{}]*?"startTimeSeconds":(\d+)/g;
const SIGNED_OUT = /sign in|log in|login|does not exist|unavailable|private/i;
const COOKIES_UNREADABLE = /cookie database|decrypt|dpapi|could not find .* cookies/i;

function runYtDlp(args, options = {}) {
  return new Promise((resolve) => {
    execFile('yt-dlp', args, {
      timeout: TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: options.maxBuffer || MAX_CAPTURE,
    }, (error, stdout, stderr) => resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

function resumeTimesFromPage(page, times = {}) {
  for (const [, id, seconds] of String(page || '').matchAll(RESUME_ENTRY)) {
    if (!(id in times)) times[id] = Number(seconds);
  }
  return times;
}

function parseResumeTimes(stdout) {
  const times = {};
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (line.length < 1000 || !/^[A-Za-z0-9+/=]+$/.test(line)) continue;
    resumeTimesFromPage(Buffer.from(line, 'base64').toString('utf8'), times);
  }
  return times;
}

function normalizeYtDlpError(error) {
  if (!error) return null;
  return error.code === 'ENOENT' ? 'yt-dlp fehlt' : error.killed ? 'yt-dlp-Zeitüberschreitung' : 'yt-dlp fehlgeschlagen';
}

class MediaResolver {
  constructor({ cookieBrowser = () => '', cookieFile = () => '', fileExists = fs.existsSync, run = runYtDlp, now = Date.now } = {}) {
    this.cookieBrowser = cookieBrowser;
    this.cookieFile = cookieFile;
    this.fileExists = fileExists;
    this.run = run;
    this.now = now;
    this.account = null;
  }

  // 'file' is a cookies.txt exported from a browser, for browsers such as
  // Chrome whose cookie store yt-dlp cannot decrypt.
  #cookieArgs(browser) {
    if (browser === 'file') return ['--cookies', this.cookieFile()];
    return browser ? ['--cookies-from-browser', browser] : [];
  }

  // Reads the signed-in YouTube history through the chosen browser's cookies.
  // A readable history proves a valid login and carries YouTube's resume points.
  youtubeAccount({ refresh = false } = {}) {
    const browser = String(this.cookieBrowser() || '');
    if (!browser) return Promise.resolve({ status: 'off', browser, times: {} });
    if (browser === 'file' && !this.fileExists(this.cookieFile())) {
      return Promise.resolve({ status: 'error', browser, error: 'Cookie-Datei fehlt', times: {} });
    }
    const cached = this.account;
    if (cached && cached.browser === browser && (cached.pending || (!refresh && this.now() - cached.at < ACCOUNT_CACHE_MS))) return cached.result;
    const entry = { browser, at: this.now(), pending: true, result: null };
    entry.result = this.run([
      ...this.#cookieArgs(browser),
      '--flat-playlist',
      '--no-warnings',
      '--simulate',
      '--dump-pages',
      '-I', '1',
      HISTORY_URL,
    ]).then(({ error, stdout, stderr }) => {
      if (error?.code === 'ENOENT') return { status: 'error', browser, error: 'yt-dlp fehlt', times: {} };
      if (error && COOKIES_UNREADABLE.test(stderr)) {
        const hint = browser === 'firefox' ? 'Cookies nicht lesbar – Firefox schließen' : 'Cookies verschlüsselt – Cookie-Datei nutzen';
        return { status: 'error', browser, error: hint, times: {} };
      }
      if (error) return SIGNED_OUT.test(stderr)
        ? { status: 'signed-out', browser, times: {} }
        : { status: 'error', browser, error: normalizeYtDlpError(error), times: {} };
      return { status: 'ok', browser, times: parseResumeTimes(stdout) };
    }).finally(() => { entry.pending = false; entry.at = this.now(); });
    this.account = entry;
    return entry.result;
  }

  forgetAccount() {
    this.account = null;
  }

  async resolveQueue({ id = '', list = '', index = 0 }) {
    if ((id && !VIDEO_ID.test(id)) || !LIST_ID.test(list)) return { error: 'ungültige Liste' };
    const query = new URLSearchParams();
    if (id) query.set('v', id);
    query.set('list', list);
    if (index > 0) query.set('index', String(index));
    const url = id ? `https://www.youtube.com/watch?${query}` : `https://www.youtube.com/playlist?${query}`;
    const browser = String(this.cookieBrowser() || '');
    const result = await this.run([
      ...this.#cookieArgs(browser),
      '--flat-playlist',
      '--no-warnings',
      '--print', '%(id)s',
      '-I', `:${QUEUE_LIMIT}`,
      url,
    ], { maxBuffer: 8 * 1024 * 1024 });
    if (result.error) return { error: normalizeYtDlpError(result.error) || 'Liste nicht lesbar' };
    const ids = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => VIDEO_ID.test(line));
    return ids.length ? { ids: [...new Set(ids)] } : { error: 'Liste leer' };
  }
}

module.exports = {
  MediaResolver,
  normalizeYtDlpError,
  parseResumeTimes,
  validation: { VIDEO_ID, LIST_ID },
};

