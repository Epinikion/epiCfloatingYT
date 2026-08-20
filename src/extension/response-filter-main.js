(() => {
  'use strict';
  if (window.__floatingYtResponseFilter) return;
  window.__floatingYtResponseFilter = true;
  const empty = new Set(['adPlacements', 'playerAds', 'adSlots']);
  const remove = new Set(['adBreakParams', 'adBreakHeartbeatParams', 'adPlaybackContextParams', 'adTrackingParams', 'adSafetyReason', 'ad3_module']);
  const originalParse = JSON.parse.bind(JSON);
  const originalStringify = JSON.stringify.bind(JSON);
  const requestedQuality = new URLSearchParams(location.search).get('vq') || '';
  const qualityHeights = Object.freeze({
    highres: Infinity,
    hd2880: 2880,
    hd2160: 2160,
    hd1440: 1440,
    hd1080: 1080,
    hd720: 720,
    large: 480,
    medium: 360,
    small: 240,
    tiny: 144,
  });

  const constrainQuality = (streamingData) => {
    const requestedHeight = qualityHeights[requestedQuality];
    if (!streamingData || requestedHeight == null) return;
    const collections = ['formats', 'adaptiveFormats']
      .map((key) => Array.isArray(streamingData[key]) ? streamingData[key] : [])
      .filter((formats) => formats.length);
    const heights = [...new Set(collections.flatMap((formats) => formats
      .map((format) => Number(format?.height) || 0)
      .filter((height) => height > 0)))].sort((left, right) => left - right);
    if (!heights.length) return;
    const selectedHeight = requestedHeight === Infinity
      ? heights.at(-1)
      : heights.includes(requestedHeight)
        ? requestedHeight
        : heights.filter((height) => height <= requestedHeight).at(-1) || heights[0];
    for (const key of ['formats', 'adaptiveFormats']) {
      if (!Array.isArray(streamingData[key])) continue;
      streamingData[key] = streamingData[key].filter((format) => {
        const height = Number(format?.height) || 0;
        return height === 0 || height === selectedHeight;
      });
    }
    // The server-side ABR entry point must stay: the modern player streams
    // exclusively through it and shows an error screen without it. Because it
    // negotiates from the format list left above, the retained audio and
    // exact-height video representations already pin the resolution.
  };

  const clean = (value, depth = 0, seen = new WeakSet()) => {
    if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return value;
    seen.add(value);
    if (value.streamingData && typeof value.streamingData === 'object') constrainQuality(value.streamingData);
    for (const key of Object.keys(value)) {
      if (empty.has(key)) value[key] = [];
      else if (remove.has(key)) delete value[key];
      else if (key === 'playerResponse' && typeof value[key] === 'string') {
        try { value[key] = originalStringify(clean(originalParse(value[key]), depth + 1, seen)); } catch {}
      } else clean(value[key], depth + 1, seen);
    }
    return value;
  };
  JSON.parse = (text, reviver) => clean(originalParse(text, reviver));
  if (typeof Response !== 'undefined' && Response.prototype.json) {
    const responseJson = Response.prototype.json;
    Response.prototype.json = function filteredResponseJson() { return responseJson.call(this).then(clean); };
  }
  for (const name of ['ytInitialPlayerResponse', 'ytInitialData']) {
    let stored;
    try {
      Object.defineProperty(window, name, { configurable: true, get: () => stored, set: (value) => { stored = clean(value); } });
    } catch {}
  }
})();
