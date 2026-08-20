const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{2,128}$/;
const YOUTUBE_HOSTS = ['youtube.com', 'youtube-nocookie.com', 'youtu.be'];

export function isHostOrSubdomain(hostname, domain) {
  const host = String(hostname || '').toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

export function parseStartTime(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
  if (!match || !match.slice(1).some(Boolean)) return 0;
  return (Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0);
}

export function parseYouTubeInput(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (VIDEO_ID.test(text)) return { id: text, list: null, index: 0, start: 0 };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.some((candidate) => isHostOrSubdomain(host, candidate))) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  let id = null;
  if (isHostOrSubdomain(host, 'youtu.be')) id = parts[0] || null;
  else if (url.pathname === '/watch') id = url.searchParams.get('v');
  else if (['embed', 'live', 'shorts', 'v'].includes(parts[0])) id = parts[1] || null;

  const listCandidate = url.searchParams.get('list');
  const list = listCandidate && LIST_ID.test(listCandidate) ? listCandidate : null;
  if (id && !VIDEO_ID.test(id)) return null;
  if (!id && !list) return null;

  const indexText = url.searchParams.get('index') || '';
  const index = /^\d+$/.test(indexText) ? Math.max(1, Number.parseInt(indexText, 10)) : 0;
  return {
    id,
    list,
    index,
    start: parseStartTime(url.searchParams.get('t') || url.searchParams.get('start')),
  };
}

export function isPersonalPlaylist(list) {
  return /^(RD|WL|LL)/.test(String(list || ''));
}

export function buildWatchUrl({ id, list, index = 0, start = 0 }) {
  const query = new URLSearchParams();
  if (id) query.set('v', id);
  if (list) query.set('list', list);
  if (index) query.set('index', String(index));
  if (start) query.set('t', String(start));
  return `https://www.youtube.com/watch?${query}`;
}

export function buildEmbedUrl(baseUrl, { id, list, start = 0, quality = null }) {
  const query = new URLSearchParams();
  if (id) query.set('v', id);
  if (list && !isPersonalPlaylist(list)) query.set('list', list);
  if (start) query.set('start', String(start));
  if (['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'].includes(quality)) {
    query.set('quality', quality);
  }
  return `${String(baseUrl).replace(/\/$/, '')}/embed.html?${query}`;
}

export const validation = Object.freeze({ VIDEO_ID, LIST_ID });
