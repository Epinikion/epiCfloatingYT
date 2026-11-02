import { isHostOrSubdomain, parseStartTime, parseYouTubeInput } from './youtube-url.mjs';

const VIDEO_ID = /^\d{5,12}$/;
const CHANNEL = /^[A-Za-z0-9_]{2,25}$/;
const CLIP_SLUG = /^[A-Za-z0-9_-]{4,100}$/;
// First path segments on twitch.tv that are site sections, not channel names.
const RESERVED_PATHS = new Set([
  'bits', 'broadcast', 'collections', 'directory', 'downloads', 'drops', 'embed', 'friends', 'inventory',
  'jobs', 'legal', 'login', 'logout', 'messages', 'moderator', 'p', 'payments', 'popout', 'prime',
  'privacy', 'search', 'settings', 'signup', 'store', 'subscriptions', 'team', 'turbo', 'user', 'videos', 'wallet',
]);

export function parseTwitchInput(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!isHostOrSubdomain(host, 'twitch.tv')) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const start = parseStartTime(url.searchParams.get('t') || url.searchParams.get('time'));

  if (host === 'clips.twitch.tv') {
    const slug = parts[0] === 'embed' ? url.searchParams.get('clip') : parts[0];
    return slug && CLIP_SLUG.test(slug) ? { platform: 'twitch', clip: slug } : null;
  }
  if (host === 'player.twitch.tv') {
    const video = String(url.searchParams.get('video') || '').replace(/^v/, '');
    if (VIDEO_ID.test(video)) return { platform: 'twitch', video, channel: null, start };
    const channel = url.searchParams.get('channel') || '';
    return CHANNEL.test(channel) ? { platform: 'twitch', video: null, channel: channel.toLowerCase(), start: 0 } : null;
  }

  if (parts[0] === 'videos') return VIDEO_ID.test(parts[1] || '') ? { platform: 'twitch', video: parts[1], channel: null, start } : null;
  if (!CHANNEL.test(parts[0] || '') || RESERVED_PATHS.has(parts[0].toLowerCase())) return null;
  if (['v', 'video'].includes(parts[1])) return VIDEO_ID.test(parts[2] || '') ? { platform: 'twitch', video: parts[2], channel: null, start } : null;
  if (parts[1] === 'clip') return CLIP_SLUG.test(parts[2] || '') ? { platform: 'twitch', clip: parts[2] } : null;
  if (parts.length === 1) return { platform: 'twitch', video: null, channel: parts[0].toLowerCase(), start: 0 };
  return null;
}

export function buildTwitchUrl(baseUrl, { video, channel, start = 0 }) {
  const query = new URLSearchParams();
  if (video) query.set('video', video);
  else if (channel) query.set('channel', channel);
  if (video && start) query.set('start', String(start));
  return `${String(baseUrl).replace(/\/$/, '')}/twitch.html?${query}`;
}

export function isSupportedVideoLink(input) {
  return Boolean(parseYouTubeInput(input) || parseTwitchInput(input));
}
