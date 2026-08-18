'use strict';

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const MAX_CHUNK = 1024 * 1024;
const MIN_CHUNK = 64 * 1024;
const MAX_REDIRECTS = 4;
const STATIC_FILES = new Map([
  ['/embed.html', ['embed.html', 'text/html; charset=utf-8']],
  ['/embed.js', ['embed.js', 'text/javascript; charset=utf-8']],
  ['/embed.css', ['embed.css', 'text/css; charset=utf-8']],
  ['/stream.html', ['stream.html', 'text/html; charset=utf-8']],
  ['/stream.js', ['stream.js', 'text/javascript; charset=utf-8']],
  ['/stream.css', ['stream.css', 'text/css; charset=utf-8']],
]);

function boundedRange(header, chunkSize = MAX_CHUNK) {
  const match = /^bytes=(\d+)-(\d*)$/i.exec(String(header || '').trim());
  const start = match ? Number(match[1]) : 0;
  const requestedEnd = match && match[2] ? Number(match[2]) : Number.POSITIVE_INFINITY;
  const end = Math.min(requestedEnd, start + chunkSize - 1);
  return { start: Number.isSafeInteger(start) ? start : 0, end: Number.isSafeInteger(end) ? end : start + chunkSize - 1 };
}

function forwardHeaders(source) {
  const headers = {};
  for (const [name, value] of Object.entries(source || {})) {
    const lower = name.toLowerCase();
    if (['user-agent', 'referer', 'origin', 'accept', 'accept-language'].includes(lower) && typeof value === 'string') {
      headers[name] = value;
    }
  }
  return headers;
}

function proxyTrack(clientRequest, clientResponse, track) {
  const requested = boundedRange(clientRequest.headers.range);
  let closed = false;
  let activeRequest = null;
  clientRequest.once('close', () => {
    closed = true;
    activeRequest?.destroy();
  });

  const fetchRange = (url, start, end, redirects = MAX_REDIRECTS, retries = 0) => {
    if (closed) return;
    let parsed;
    try {
      parsed = new URL(url);
      if (parsed.protocol !== 'https:') throw new Error('unsupported protocol');
    } catch {
      clientResponse.writeHead(502).end();
      return;
    }

    const headers = { ...forwardHeaders(track.headers), Range: `bytes=${start}-${end}` };
    activeRequest = https.request(parsed, { headers }, (upstream) => {
      const location = upstream.headers.location;
      if (upstream.statusCode >= 300 && upstream.statusCode < 400 && location && redirects > 0) {
        upstream.resume();
        fetchRange(new URL(location, parsed).toString(), start, end, redirects - 1, retries);
        return;
      }
      if (upstream.statusCode === 403 && retries < 3 && end - start + 1 > MIN_CHUNK) {
        upstream.resume();
        fetchRange(url, start, start + Math.floor((end - start) / 2), redirects, retries + 1);
        return;
      }
      const responseHeaders = { 'cache-control': 'no-store' };
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        if (upstream.headers[name]) responseHeaders[name] = upstream.headers[name];
      }
      clientResponse.writeHead(upstream.statusCode || 502, responseHeaders);
      upstream.pipe(clientResponse);
    });
    activeRequest.once('error', () => {
      if (!clientResponse.headersSent) clientResponse.writeHead(502);
      clientResponse.end();
    });
    activeRequest.end();
  };

  fetchRange(track.url, requested.start, requested.end);
}

class LocalPlayerServer {
  constructor({ playerDirectory, mediaSessions }) {
    this.playerDirectory = playerDirectory;
    this.mediaSessions = mediaSessions;
    this.server = null;
    this.baseUrl = null;
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

  #handle(request, response) {
    let url;
    try {
      url = new URL(request.url, 'http://127.0.0.1');
    } catch {
      response.writeHead(400).end();
      return;
    }

    const media = /^\/media\/([A-Za-z0-9_-]+)\/(video|audio)$/.exec(url.pathname);
    if (media) {
      const track = this.mediaSessions.get(media[1], media[2]);
      if (!track) response.writeHead(404).end();
      else proxyTrack(request, response, track);
      return;
    }

    const staticEntry = STATIC_FILES.get(url.pathname);
    if (!staticEntry || !['GET', 'HEAD'].includes(request.method)) {
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
          "media-src 'self'",
          "img-src 'self' data:",
          "connect-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
        ].join('; '),
      });
      response.end(request.method === 'HEAD' ? undefined : data);
    });
  }
}

module.exports = { LocalPlayerServer, boundedRange, forwardHeaders, proxyTrack };
