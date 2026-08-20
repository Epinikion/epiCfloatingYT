'use strict';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const BATCH_LIMIT = 50;
const CONCURRENCY = 6;
const REQUEST_TIMEOUT = 8_000;
const RESPONSE_LIMIT = 64 * 1024;
const CACHE_LIMIT = 500;

function normalizeIds(values) {
  const ids = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const id = String(value || '');
    if (!VIDEO_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= BATCH_LIMIT) break;
  }
  return ids;
}

function normalizeTitle(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

class VideoMetadataService {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetchImpl = fetchImpl;
    this.cache = new Map();
  }

  async resolve(values) {
    const ids = normalizeIds(values);
    if (!ids.length) return { items: [] };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    const resolved = new Map();
    let cursor = 0;
    const worker = async () => {
      while (!controller.signal.aborted) {
        const position = cursor++;
        if (position >= ids.length) return;
        const id = ids[position];
        resolved.set(id, await this.#resolveOne(id, controller.signal));
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
    } finally {
      clearTimeout(timer);
    }
    return {
      items: ids.map((id) => resolved.get(id) || {
        id,
        title: '',
        thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      }),
    };
  }

  async #resolveOne(id, signal) {
    const cached = this.cache.get(id);
    if (cached) {
      this.cache.delete(id);
      this.cache.set(id, cached);
      return cached;
    }
    const fallback = { id, title: '', thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` };
    if (typeof this.fetchImpl !== 'function') return fallback;
    try {
      const watchUrl = `https://www.youtube.com/watch?v=${id}`;
      const response = await this.fetchImpl(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`, {
        method: 'GET',
        redirect: 'follow',
        signal,
        headers: { Accept: 'application/json' },
      });
      const announced = Number(response?.headers?.get?.('content-length'));
      if (!response?.ok || (Number.isFinite(announced) && announced > RESPONSE_LIMIT)) return fallback;
      const text = await response.text();
      if (text.length > RESPONSE_LIMIT) return fallback;
      const title = normalizeTitle(JSON.parse(text)?.title);
      if (!title) return fallback;
      const item = { ...fallback, title };
      this.cache.set(id, item);
      while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
      return item;
    } catch {
      return fallback;
    }
  }
}

module.exports = { VideoMetadataService, normalizeIds, normalizeTitle };
