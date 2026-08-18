'use strict';

const ARRAY_FIELDS = new Set(['adPlacements', 'playerAds', 'adSlots']);
const DELETE_FIELDS = new Set([
  'adBreakParams',
  'adBreakHeartbeatParams',
  'adPlaybackContextParams',
  'adTrackingParams',
  'adSafetyReason',
  'ad3_module',
]);

function sanitizePlayerResponse(value, depth = 0, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (ARRAY_FIELDS.has(key)) {
      value[key] = [];
      continue;
    }
    if (DELETE_FIELDS.has(key)) {
      delete value[key];
      continue;
    }
    if (key === 'playerResponse' && typeof value[key] === 'string') {
      try {
        value[key] = JSON.stringify(sanitizePlayerResponse(JSON.parse(value[key]), depth + 1, seen));
      } catch {
        // Not every field with this name contains JSON.
      }
      continue;
    }
    sanitizePlayerResponse(value[key], depth + 1, seen);
  }
  return value;
}

// This function is serialized and executed in the page's main world before
// YouTube initializes. It intentionally has no closure dependencies.
function installMainWorldFilter() {
  if (!/(^|\.)(youtube\.com|youtube-nocookie\.com)$/i.test(location.hostname)) return;
  if (window.__floatingYtResponseFilter) return;
  window.__floatingYtResponseFilter = true;

  const empty = new Set(['adPlacements', 'playerAds', 'adSlots']);
  const remove = new Set([
    'adBreakParams', 'adBreakHeartbeatParams', 'adPlaybackContextParams',
    'adTrackingParams', 'adSafetyReason', 'ad3_module',
  ]);
  const originalParse = JSON.parse.bind(JSON);
  const originalStringify = JSON.stringify.bind(JSON);

  const clean = (value, depth = 0, seen = new WeakSet()) => {
    if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return value;
    seen.add(value);
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
    Response.prototype.json = function responseJsonWithoutAds() {
      return responseJson.call(this).then(clean);
    };
  }
  for (const property of ['ytInitialPlayerResponse', 'ytInitialData']) {
    let stored;
    try {
      Object.defineProperty(window, property, {
        configurable: true,
        get: () => stored,
        set: (next) => { stored = clean(next); },
      });
    } catch {}
  }
}

module.exports = { sanitizePlayerResponse, installMainWorldFilter };

