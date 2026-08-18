'use strict';

const { execFile } = require('node:child_process');
const crypto = require('node:crypto');

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{2,128}$/;
const TIMEOUT_MS = 30_000;
const MAX_CAPTURE = 96 * 1024 * 1024;
const QUEUE_LIMIT = 50;
const MAX_HEIGHT = 1080;

function runYtDlp(args, options = {}) {
  return new Promise((resolve) => {
    execFile('yt-dlp', args, {
      timeout: TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: options.maxBuffer || MAX_CAPTURE,
    }, (error, stdout, stderr) => resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

function isHttpsFormat(format) {
  return format && format.protocol === 'https' && typeof format.url === 'string' && format.url.startsWith('https://');
}

function formatScore(format) {
  const height = Number(format.height) || 0;
  const bitrate = Number(format.tbr) || Number(format.abr) || 0;
  return Math.min(height, MAX_HEIGHT) * 1_000_000 + bitrate;
}

function chooseFormats(formats) {
  const available = Array.isArray(formats) ? formats.filter(isHttpsFormat) : [];
  const video = available
    .filter((format) => format.acodec === 'none' && format.ext === 'mp4' && String(format.vcodec).startsWith('avc1') && (format.height || 0) <= MAX_HEIGHT)
    .sort((a, b) => formatScore(b) - formatScore(a))[0];
  const audio = available
    .filter((format) => format.vcodec === 'none' && (format.ext === 'm4a' || String(format.acodec).startsWith('mp4a')))
    .sort((a, b) => formatScore(b) - formatScore(a))[0];

  if (video && audio) {
    return {
      video: { url: video.url, headers: video.http_headers || {} },
      audio: { url: audio.url, headers: audio.http_headers || {} },
      height: video.height || null,
    };
  }

  const combined = available
    .filter((format) => format.vcodec !== 'none' && format.acodec !== 'none' && format.ext === 'mp4')
    .filter((format) => !format.height || format.height <= MAX_HEIGHT)
    .sort((a, b) => formatScore(b) - formatScore(a))[0];
  return combined
    ? { video: { url: combined.url, headers: combined.http_headers || {} }, audio: null, height: combined.height || null }
    : null;
}

function normalizeYtDlpError(error) {
  if (!error) return null;
  return error.code === 'ENOENT' ? 'yt-dlp fehlt' : error.killed ? 'yt-dlp-Zeitüberschreitung' : 'yt-dlp fehlgeschlagen';
}

class MediaResolver {
  constructor({ cookieBrowser = () => '' } = {}) {
    this.cookieBrowser = cookieBrowser;
  }

  async resolveStream(id) {
    if (!VIDEO_ID.test(String(id || ''))) return { error: 'ungültige Video-Kennung' };
    const result = await runYtDlp(['-J', '--no-playlist', '--no-warnings', `https://www.youtube.com/watch?v=${id}`]);
    if (result.error) return { error: normalizeYtDlpError(result.error) };
    try {
      const metadata = JSON.parse(result.stdout);
      const selected = chooseFormats(metadata.formats);
      if (!selected) return { error: 'kein kompatibles MP4-Format' };
      return {
        ...selected,
        id,
        title: String(metadata.title || ''),
        duration: Number(metadata.duration) || 0,
      };
    } catch {
      return { error: 'yt-dlp-Antwort unlesbar' };
    }
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

class MediaSessionRegistry {
  constructor({ ttlMs = 2 * 60 * 60 * 1000, limit = 8 } = {}) {
    this.ttlMs = ttlMs;
    this.limit = limit;
    this.sessions = new Map();
  }

  add(stream) {
    this.prune();
    const token = crypto.randomBytes(18).toString('base64url');
    this.sessions.set(token, { createdAt: Date.now(), video: stream.video, audio: stream.audio });
    while (this.sessions.size > this.limit) this.sessions.delete(this.sessions.keys().next().value);
    return token;
  }

  get(token, track) {
    this.prune();
    const session = this.sessions.get(token);
    return session && (track === 'video' || track === 'audio') ? session[track] : null;
  }

  prune(now = Date.now()) {
    for (const [token, session] of this.sessions) {
      if (now - session.createdAt > this.ttlMs) this.sessions.delete(token);
    }
  }
}

module.exports = {
  MediaResolver,
  MediaSessionRegistry,
  chooseFormats,
  normalizeYtDlpError,
  validation: { VIDEO_ID, LIST_ID },
};

