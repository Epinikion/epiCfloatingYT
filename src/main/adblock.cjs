'use strict';

const HOST_RULES = Object.freeze([
  'doubleclick.net',
  'googleadservices.com',
  'googlesyndication.com',
  'googletagservices.com',
  'moatads.com',
  'scorecardresearch.com',
  '2mdn.net',
]);

const PATH_RULES = Object.freeze([
  '/pagead/',
  '/ptracking',
  '/api/stats/ads',
  '/api/stats/atr',
  '/get_midroll_info',
  '/pcs/activeview',
  '/activeview',
]);

const AD_QUERY_KEYS = Object.freeze(['adformat', 'ad_type', 'adunit', 'vad_type']);

function belongsTo(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function shouldBlock(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase();
  if (HOST_RULES.some((domain) => belongsTo(host, domain))) return true;
  if (PATH_RULES.some((fragment) => `${url.pathname}${url.search}`.includes(fragment))) return true;
  if (belongsTo(host, 'youtube.com') || belongsTo(host, 'googlevideo.com')) {
    if (AD_QUERY_KEYS.some((key) => url.searchParams.has(key))) return true;
    if (url.pathname.includes('/ad_')) return true;
  }
  return false;
}

function attachAdBlocker(targetSession) {
  targetSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: shouldBlock(details.url) });
  });
}

module.exports = { attachAdBlocker, shouldBlock };

