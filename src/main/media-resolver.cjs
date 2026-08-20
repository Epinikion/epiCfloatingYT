'use strict';

const { execFile } = require('node:child_process');

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{2,128}$/;
const TIMEOUT_MS = 30_000;
const MAX_CAPTURE = 96 * 1024 * 1024;
const QUEUE_LIMIT = 50;

function runYtDlp(args, options = {}) {
  return new Promise((resolve) => {
    execFile('yt-dlp', args, {
      timeout: TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: options.maxBuffer || MAX_CAPTURE,
    }, (error, stdout, stderr) => resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

function normalizeYtDlpError(error) {
  if (!error) return null;
  return error.code === 'ENOENT' ? 'yt-dlp fehlt' : error.killed ? 'yt-dlp-Zeitüberschreitung' : 'yt-dlp fehlgeschlagen';
}

class MediaResolver {
  constructor({ cookieBrowser = () => '' } = {}) {
    this.cookieBrowser = cookieBrowser;
  }

  async resolveQueue({ id = '', list = '', index = 0 }) {
    if ((id && !VIDEO_ID.test(id)) || !LIST_ID.test(list)) return { error: 'ungültige Liste' };
    const query = new URLSearchParams();
    if (id) query.set('v', id);
    query.set('list', list);
    if (index > 0) query.set('index', String(index));
    const url = id ? `https://www.youtube.com/watch?${query}` : `https://www.youtube.com/playlist?${query}`;
    const browser = String(this.cookieBrowser() || '');
    const cookieArgs = browser ? ['--cookies-from-browser', browser] : [];
    const result = await runYtDlp([
      ...cookieArgs,
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
  validation: { VIDEO_ID, LIST_ID },
};

