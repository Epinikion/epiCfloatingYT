'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { mediaType } = require('./local-media.cjs');

const STATIC_FILES = new Map([
  ['/embed.html', ['embed.html', 'text/html; charset=utf-8']],
  ['/embed.js', ['embed.js', 'text/javascript; charset=utf-8']],
  ['/embed.css', ['embed.css', 'text/css; charset=utf-8']],
  ['/local.html', ['local.html', 'text/html; charset=utf-8']],
  ['/local.js', ['local.js', 'text/javascript; charset=utf-8']],
  ['/local.css', ['local.css', 'text/css; charset=utf-8']],
]);

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(header).trim());
  if (!match || (!match[1] && !match[2])) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) return false;
  }
  if (start >= size) return false;
  return { start, end: Math.min(end, size - 1) };
}

class LocalPlayerServer {
  constructor({ playerDirectory }) {
    this.playerDirectory = playerDirectory;
    this.server = null;
    this.baseUrl = null;
    this.media = new Map();
  }

  start() {
    if (this.server) return Promise.resolve(this.baseUrl);
    return new Promise((resolve, reject) => {
      this.server = http.createServer((request, response) => this.#handle(request, response));
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.removeListener('error', reject);
        this.server.on('error', () => {});
        this.baseUrl = `http://127.0.0.1:${this.server.address().port}`;
        resolve(this.baseUrl);
      });
    });
  }

  close() {
    this.server?.close();
    this.server = null;
  }

  registerMedia(filePaths) {
    this.media.clear();
    const items = [];
    for (const filePath of filePaths) {
      const type = mediaType(filePath);
      if (!type) continue;
      const id = crypto.randomBytes(18).toString('hex');
      const entry = { filePath: path.resolve(filePath), type, name: path.basename(filePath) };
      this.media.set(id, entry);
      items.push({ id, name: entry.name });
    }
    return items;
  }

  #handle(request, response) {
    let url;
    try {
      url = new URL(request.url, 'http://127.0.0.1');
    } catch {
      response.writeHead(400).end();
      return;
    }

    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(404).end();
      return;
    }
    if (url.pathname.startsWith('/media/')) {
      this.#serveMedia(request, response, url.pathname.slice('/media/'.length));
      return;
    }
    const staticEntry = STATIC_FILES.get(url.pathname);
    if (!staticEntry) {
      response.writeHead(404).end();
      return;
    }
    const [fileName, contentType] = staticEntry;
    fs.readFile(path.join(this.playerDirectory, fileName), (error, data) => {
      if (error) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'content-type': contentType,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': [
          "default-src 'none'",
          "script-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
          "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
          // The YouTube IFrame API applies sizing styles to the iframe it
          // creates inside this otherwise fully local, controlled document.
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "media-src 'self'",
          "connect-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
        ].join('; '),
      });
      response.end(request.method === 'HEAD' ? undefined : data);
    });
  }

  #serveMedia(request, response, id) {
    const entry = /^[a-f0-9]{36}$/.test(id) ? this.media.get(id) : null;
    if (!entry) { response.writeHead(404).end(); return; }
    fs.stat(entry.filePath, (error, stats) => {
      if (error || !stats.isFile() || stats.size <= 0) { response.writeHead(404).end(); return; }
      const range = parseRange(request.headers.range, stats.size);
      if (range === false) {
        response.writeHead(416, { 'content-range': `bytes */${stats.size}` }).end();
        return;
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? stats.size - 1;
      const headers = {
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
        'content-length': String(end - start + 1),
        'content-type': entry.type,
        'x-content-type-options': 'nosniff',
      };
      if (range) headers['content-range'] = `bytes ${start}-${end}/${stats.size}`;
      response.writeHead(range ? 206 : 200, headers);
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = fs.createReadStream(entry.filePath, { start, end });
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    });
  }
}

module.exports = { LocalPlayerServer, parseRange };
