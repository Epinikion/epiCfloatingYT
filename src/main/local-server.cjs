'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const STATIC_FILES = new Map([
  ['/embed.html', ['embed.html', 'text/html; charset=utf-8']],
  ['/embed.js', ['embed.js', 'text/javascript; charset=utf-8']],
  ['/embed.css', ['embed.css', 'text/css; charset=utf-8']],
]);

class LocalPlayerServer {
  constructor({ playerDirectory }) {
    this.playerDirectory = playerDirectory;
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
          "img-src 'self' data:",
          "connect-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
        ].join('; '),
      });
      response.end(request.method === 'HEAD' ? undefined : data);
    });
  }
}

module.exports = { LocalPlayerServer };
