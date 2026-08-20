'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MEDIA_TYPES = new Map([
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.ogv', 'video/ogg'],
  ['.ogg', 'video/ogg'],
  ['.mov', 'video/quicktime'],
  ['.mkv', 'video/x-matroska'],
  ['.avi', 'video/x-msvideo'],
  ['.wmv', 'video/x-ms-wmv'],
]);
const DEFAULT_LIMIT = 2_000;
const DEFAULT_DEPTH = 12;
const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

function mediaType(filePath) {
  return MEDIA_TYPES.get(path.extname(String(filePath || '')).toLowerCase()) || null;
}

function pathKey(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function collectMediaFiles(inputPaths, options = {}) {
  const limit = Math.max(1, Math.min(10_000, Number(options.limit) || DEFAULT_LIMIT));
  const maxDepth = Math.max(0, Math.min(32, Number(options.maxDepth) || DEFAULT_DEPTH));
  const files = [];
  const seen = new Set();
  let truncated = false;

  const add = (filePath) => {
    if (!mediaType(filePath)) return;
    const resolved = path.resolve(filePath);
    const key = pathKey(resolved);
    if (seen.has(key)) return;
    if (files.length >= limit) { truncated = true; return; }
    seen.add(key);
    files.push(resolved);
  };

  const visit = async (target, depth) => {
    if (files.length >= limit) { truncated = true; return; }
    let stats;
    try { stats = await fs.promises.lstat(target); } catch { return; }
    if (stats.isSymbolicLink()) return;
    if (stats.isFile()) { add(target); return; }
    if (!stats.isDirectory() || depth >= maxDepth) return;
    let entries;
    try { entries = await fs.promises.readdir(target, { withFileTypes: true }); } catch { return; }
    entries.sort((left, right) => collator.compare(left.name, right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      await visit(path.join(target, entry.name), depth + 1);
      if (files.length >= limit) { truncated = true; break; }
    }
  };

  for (const input of Array.isArray(inputPaths) ? inputPaths.slice(0, 128) : []) {
    if (typeof input !== 'string' || !input.trim()) continue;
    await visit(path.resolve(input), 0);
  }
  return { files, truncated };
}

module.exports = { MEDIA_TYPES, collectMediaFiles, mediaType };
