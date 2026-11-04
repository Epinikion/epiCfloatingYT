'use strict';

// Programme guide for MagentaTV. The channel list and schedules come from the
// public thePlatform feeds that the MagentaTV web guide itself reads; they need
// no sign-in. The field lists keep the responses small.
const FEED = 'https://feed.entertainment.tv.theplatform.eu/f/mdeprod';
const LOCATION = 'http://data.entertainment.tv.theplatform.eu/entertainment/data/Location/245991976396';
const STATION_FIELDS = 'id,dt$displayChannelNumber,stations.title,stations.isHd,stations.dt$serviceId,stations.thumbnails';
const LISTING_FIELDS = 'id,listings.startTime,listings.endTime,listings.program.title,listings.program.secondaryTitle';
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const CHANNELS_CACHE_MS = 6 * 3600e3;
const SCHEDULE_CACHE_MS = 3 * 60e3;
const TIMEOUT_MS = 15_000;
const SERVICE_ID = /^[a-z0-9_.-]{1,60}$/i;

function scheduleId(rawId) {
  const id = String(rawId || '').split('/').pop();
  return /^\d{6,16}$/.test(id) ? id : '';
}

function slug(title) {
  return String(title || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sender';
}

// The logo host only answers Telekom's own image service, which also scales
// the logo down; MagentaTV's web pages load their images the same way.
function logoUrl(thumbnails) {
  const url = thumbnails?.stationLogoColored?.url || thumbnails?.stationLogo?.url || '';
  if (!/^https:\/\//.test(url)) return '';
  return `https://ngiss.t-online.de/iss?client=ftp22&out=webp&x=104&y=44&ar=keep&src=${encodeURIComponent(url)}`;
}

// One row per channel number: SD and HD share the service id that MagentaTV's
// own tiles link to, and MagentaTV then plays the variant the package holds.
function parseChannels(feed) {
  const channels = new Map();
  for (const entry of Array.isArray(feed?.entries) ? feed.entries : []) {
    const station = Object.values(entry?.stations || {})[0];
    const serviceId = String(station?.['dt$serviceId'] || '');
    const id = scheduleId(entry?.id);
    if (!station || !SERVICE_ID.test(serviceId) || !id) continue;
    const title = String(station.title || '').replace(/\s+(HD|SD)$/i, '').trim().slice(0, 80);
    const existing = channels.get(serviceId);
    if (existing) {
      existing.scheduleIds.push(id);
      if (!existing.logo) existing.logo = logoUrl(station.thumbnails);
      continue;
    }
    channels.set(serviceId, {
      serviceId,
      number: Number(entry['dt$displayChannelNumber']) || 0,
      title,
      logo: logoUrl(station.thumbnails),
      url: `https://www.magenta.tv/streamen-tv/${slug(title)}/${encodeURIComponent(serviceId)}`,
      scheduleIds: [id],
    });
  }
  return [...channels.values()].sort((a, b) => a.number - b.number || a.title.localeCompare(b.title));
}

function parseListings(feeds) {
  const byId = new Map();
  for (const feed of feeds) {
    for (const entry of Array.isArray(feed?.entries) ? feed.entries : []) {
      const id = scheduleId(entry?.id);
      if (!id) continue;
      const listings = (Array.isArray(entry.listings) ? entry.listings : [])
        .map((listing) => ({
          start: Number(listing?.startTime) || 0,
          end: Number(listing?.endTime) || 0,
          title: String(listing?.program?.title || '').trim().slice(0, 160),
          subtitle: String(listing?.program?.secondaryTitle || '').trim().slice(0, 160),
        }))
        .filter((listing) => listing.start && listing.end > listing.start && listing.title)
        .sort((a, b) => a.start - b.start);
      byId.set(id, listings);
    }
  }
  return byId;
}

// The airing at \`now\` and the one after it, from the first schedule variant
// of the channel that has listings.
function nowAndNext(channel, listingsById, now) {
  for (const id of channel.scheduleIds) {
    const listings = listingsById.get(id);
    if (!listings?.length) continue;
    const index = listings.findIndex((listing) => listing.start <= now && listing.end > now);
    const current = index >= 0 ? listings[index] : null;
    const next = listings.find((listing) => listing.start >= (current ? current.end : now)) || null;
    return { now: current, next };
  }
  return { now: null, next: null };
}

class MagentaGuide {
  constructor({ fetchImpl = fetch, now = Date.now } = {}) {
    this.fetch = fetchImpl;
    this.now = now;
    this.channelCache = null;
    this.scheduleCache = null;
  }

  async #json(url) {
    const response = await this.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async #channels() {
    if (this.channelCache && this.now() - this.channelCache.at < CHANNELS_CACHE_MS) return this.channelCache.channels;
    const feed = await this.#json(`${FEED}/mdeprod-channel-stations-main?lang=short-de&sort=dt$displayChannelNumber&range=1-1000&fields=${STATION_FIELDS}`);
    const channels = parseChannels(feed);
    if (!channels.length) throw new Error('keine Sender');
    this.channelCache = { at: this.now(), channels };
    return channels;
  }

  async #listings() {
    if (this.scheduleCache && this.now() - this.scheduleCache.at < SCHEDULE_CACHE_MS) return this.scheduleCache.listings;
    const now = this.now();
    const window = `${new Date(now - 3600e3).toISOString()}~${new Date(now + 4 * 3600e3).toISOString()}`;
    const feeds = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const range = `${page * PAGE_SIZE + 1}-${(page + 1) * PAGE_SIZE}`;
      const feed = await this.#json(`${FEED}/mdeprod-all-channel-schedules?byListingTime=${window}&byLocationId=${encodeURIComponent(LOCATION)}&range=${range}&fields=${LISTING_FIELDS}`);
      feeds.push(feed);
      if (!Array.isArray(feed?.entries) || feed.entries.length < PAGE_SIZE) break;
    }
    const listings = parseListings(feeds);
    this.scheduleCache = { at: this.now(), listings };
    return listings;
  }

  async guide() {
    try {
      const [channels, listings] = await Promise.all([this.#channels(), this.#listings()]);
      const now = this.now();
      return {
        error: null,
        at: now,
        channels: channels.map(({ scheduleIds, ...channel }) => ({ ...channel, ids: scheduleIds, ...nowAndNext({ scheduleIds }, listings, now) })),
      };
    } catch (error) {
      return { error: error?.name === 'TimeoutError' ? 'Programmdaten antworten nicht' : 'Programmdaten nicht erreichbar', at: this.now(), channels: [] };
    }
  }
}

module.exports = { MagentaGuide, parseChannels, parseListings, nowAndNext, slug };
