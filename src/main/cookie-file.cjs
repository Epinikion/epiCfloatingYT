'use strict';

const fs = require('node:fs/promises');

const HEADER = /^#\s*(Netscape\s+)?HTTP Cookie File/i;
const YOUTUBE_LINE = /^(#HttpOnly_)?\.?([\w-]+\.)*youtube\.com\t/im;

// Copies a cookies.txt exported from a browser into the app's own folder, so
// the export can be deleted and yt-dlp may refresh the copy as it runs.
async function importCookieFile(source, target) {
  let text;
  try {
    text = await fs.readFile(source, 'utf8');
  } catch {
    return { error: 'Datei nicht lesbar' };
  }
  if (!HEADER.test(text.trimStart())) return { error: 'Keine cookies.txt im Netscape-Format' };
  if (!YOUTUBE_LINE.test(text)) return { error: 'Keine YouTube-Cookies in der Datei' };
  await fs.writeFile(target, text, { mode: 0o600 });
  return { error: null };
}

module.exports = { importCookieFile };
