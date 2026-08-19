'use strict';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const QUERY_LIMIT = 160;
const RESULT_LIMIT = 12;
const RESPONSE_LIMIT = 6 * 1024 * 1024;
const REQUEST_TIMEOUT = 10_000;
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_LIMIT = 24;

function normalizeSearchQuery(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, QUERY_LIMIT);
}

function textValue(value) {
  if (!value || typeof value !== 'object') return '';
  if (typeof value.simpleText === 'string') return value.simpleText.trim();
  if (!Array.isArray(value.runs)) return '';
  return value.runs.map((run) => typeof run?.text === 'string' ? run.text : '').join('').trim();
}

function extractInitialData(html) {
  const source = String(html || '');
  const marker = /(?:var\s+ytInitialData|window\["ytInitialData"\]|ytInitialData)\s*=\s*/g;
  let match;
  while ((match = marker.exec(source))) {
    const start = source.indexOf('{', match.index + match[0].length);
    if (start < 0) continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === '{') depth += 1;
      else if (character === '}' && --depth === 0) {
        try { return JSON.parse(source.slice(start, index + 1)); } catch { break; }
      }
    }
  }
  return null;
}

function isLiveVideo(renderer) {
  const labels = [
    ...(Array.isArray(renderer.badges) ? renderer.badges : []),
    ...(Array.isArray(renderer.thumbnailOverlays) ? renderer.thumbnailOverlays : []),
  ];
  return labels.some((entry) => /live|jetzt|direkt/i.test(JSON.stringify(entry)));
}

function normalizeVideoRenderer(renderer) {
  const id = String(renderer?.videoId || '');
  const title = textValue(renderer?.title).slice(0, 240);
  if (!VIDEO_ID.test(id) || !title) return null;
  const channel = (textValue(renderer.ownerText) || textValue(renderer.longBylineText) || textValue(renderer.shortBylineText)).slice(0, 120);
  const duration = textValue(renderer.lengthText).slice(0, 24);
  const views = (textValue(renderer.shortViewCountText) || textValue(renderer.viewCountText)).slice(0, 80);
  const published = textValue(renderer.publishedTimeText).slice(0, 80);
  return {
    id,
    title,
    channel,
    duration,
    views,
    published,
    live: isLiveVideo(renderer),
    thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
  };
}

function parseSearchResults(html, limit = RESULT_LIMIT) {
  const data = extractInitialData(html);
  if (!data) return [];
  const results = [];
  const ids = new Set();
  let visited = 0;
  const visit = (node) => {
    if (results.length >= limit || visited++ > 100_000 || node == null) return;
    if (Array.isArray(node)) {
      for (const value of node) visit(value);
      return;
    }
    if (typeof node !== 'object') return;
    if (node.videoRenderer) {
      const video = normalizeVideoRenderer(node.videoRenderer);
      if (video && !ids.has(video.id)) {
        ids.add(video.id);
        results.push(video);
      }
      return;
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(data);
  return results;
}

async function readLimitedText(response, limit = RESPONSE_LIMIT) {
  const announced = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(announced) && announced > limit) throw new Error('response too large');
  if (!response?.body?.getReader) {
    const text = await response.text();
    if (text.length > limit) throw new Error('response too large');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel();
      throw new Error('response too large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

class VideoSearchService {
  constructor({ fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.cache = new Map();
    this.inflight = new Map();
  }

  search(input) {
    const query = normalizeSearchQuery(input);
    if (query.length < 2) return Promise.resolve({ query, results: [], error: 'Suchbegriff zu kurz' });
    const key = query.toLocaleLowerCase('de-DE');
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.createdAt < CACHE_TTL) return Promise.resolve({ query, results: cached.results });
    if (this.inflight.has(key)) return this.inflight.get(key);
    const request = this.#request(query)
      .then((result) => {
        if (!result.error) this.#remember(key, result.results);
        return result;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }

  async #request(query) {
    if (typeof this.fetchImpl !== 'function') return { query, results: [], error: 'YouTube-Suche nicht verfügbar' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=de`;
      const response = await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'de-DE,de;q=0.9,en;q=0.7',
        },
      });
      if (!response?.ok) throw new Error(`HTTP ${response?.status || 0}`);
      const html = await readLimitedText(response);
      const results = parseSearchResults(html);
      if (!results.length && !extractInitialData(html)) throw new Error('search data missing');
      return { query, results };
    } catch (error) {
      const timedOut = error?.name === 'AbortError';
      return { query, results: [], error: timedOut ? 'YouTube-Suche dauert zu lange' : 'YouTube-Suche nicht erreichbar' };
    } finally {
      clearTimeout(timer);
    }
  }

  #remember(key, results) {
    this.cache.delete(key);
    this.cache.set(key, { createdAt: this.now(), results });
    while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
  }
}

module.exports = {
  VideoSearchService,
  extractInitialData,
  normalizeSearchQuery,
  normalizeVideoRenderer,
  parseSearchResults,
  readLimitedText,
};
