import { buildEmbedUrl, buildWatchUrl, isPersonalPlaylist, parseYouTubeInput } from '../shared/youtube-url.mjs';

const BLOCKED_ERRORS = new Set([100, 101, 150, 'timeout']);
const LOCAL_MEDIA_ID = /^[a-f0-9]{36}$/;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function normalizeYouTubeQueue(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || ''))
    .filter((id) => YOUTUBE_VIDEO_ID.test(id) && !seen.has(id) && seen.add(id));
}

function buildLocalUrl(baseUrl, item) {
  const query = new URLSearchParams({ media: item.id, name: item.name });
  return `${String(baseUrl).replace(/\/$/, '')}/local.html?${query}`;
}

export class PlaybackController {
  constructor({ player, api, baseUrl, hooks, caption = null, soundBoost = 1 }) {
    this.player = player;
    this.api = api;
    this.baseUrl = baseUrl;
    this.hooks = hooks;
    this.current = null;
    this.generation = 0;
    this.pendingInfo = new Map();
    this.requestSequence = 0;
    this.lastBlockedId = '';
    this.preferredCaption = caption == null ? null : String(caption);
    this.soundBoost = [1, 1.5, 2, 3].includes(Number(soundBoost)) ? Number(soundBoost) : 1;
    this.boostWarningId = '';
    this.youtubeTitles = new Map();
    this.queueMetadataKey = '';
    this.preferredQuality = 'auto';
    this.pendingQuality = null;
    this.qualityCommandSent = false;
    this.qualitySwitching = false;
    this.qualityLevels = [];
    this.#bindPlayer();
  }

  load(input, options = {}) {
    const parsed = parseYouTubeInput(input);
    if (!parsed) {
      this.hooks.toast('Kein gültiger YouTube-Link');
      return false;
    }
    this.generation += 1;
    this.lastBlockedId = '';
    this.boostWarningId = '';
    this.preferredQuality = 'auto';
    this.pendingQuality = null;
    this.qualityCommandSent = false;
    this.qualityLevels = [];
    const queue = normalizeYouTubeQueue(options.queue);
    this.current = { ...parsed, mode: 'embed', queue: queue.length ? queue : null };
    this.hooks.setEmpty(false);
    this.hooks.setPlaylist(Boolean(parsed.list) || queue.length > 1);
    if (queue.length) this.#publishYouTubeQueue();
    else this.hooks.setQueue?.(null);
    this.hooks.setTitle('');
    this.player.src = buildEmbedUrl(this.baseUrl, this.current);
    this.player.focus();
    if (!this.current.queue && isPersonalPlaylist(parsed.list)) void this.#resolvePersonalList(this.generation);
    return true;
  }

  loadLocal(items, requestedIndex = 0) {
    const queue = (Array.isArray(items) ? items : [])
      .filter((item) => LOCAL_MEDIA_ID.test(String(item?.id || '')) && String(item?.name || '').trim())
      .map((item) => ({ id: String(item.id), name: String(item.name).slice(0, 260) }));
    if (!queue.length) {
      this.hooks.toast('Keine unterstützten Videodateien gefunden');
      return false;
    }
    const requested = Math.trunc(Number(requestedIndex) || 0);
    const index = Math.max(0, Math.min(queue.length - 1, requested));
    const selected = queue[index];
    this.generation += 1;
    this.lastBlockedId = '';
    this.boostWarningId = '';
    this.preferredQuality = 'auto';
    this.pendingQuality = null;
    this.qualityCommandSent = false;
    this.qualityLevels = [];
    this.current = { mode: 'local', queue, index, id: selected.id, name: selected.name, list: null, start: 0 };
    this.hooks.setEmpty(false);
    this.hooks.setPlaylist(queue.length > 1);
    this.hooks.setQueue?.({ mode: 'local', items: queue, index });
    this.hooks.setTitle(selected.name);
    this.player.src = buildLocalUrl(this.baseUrl, selected);
    this.player.focus();
    return true;
  }

  clear() {
    this.generation += 1;
    this.current = null;
    this.player.src = 'about:blank';
    this.hooks.setPlaylist(false);
    this.hooks.setQueue?.(null);
    this.hooks.setTitle('');
    this.hooks.setEmpty(true);
  }

  send(name, value) {
    if (!this.current) return;
    try { this.player.send('guest-command', { name, value }); } catch {}
  }

  togglePlay() { this.send('toggle'); }
  toggleMute() { this.send('mute-toggle'); }
  adjustVolume(delta) { this.send('volume-step', Math.max(-100, Math.min(100, Math.round(Number(delta) || 0)))); }

  selectQueue(index) {
    if (!this.current || !Number.isInteger(index)) return false;
    if (this.current.mode === 'local') return this.loadLocal(this.current.queue, index);
    const queue = this.current.queue;
    if (!Array.isArray(queue) || index < 0 || index >= queue.length) return false;
    const id = queue[index];
    return this.load(buildWatchUrl({ id, list: this.current.list, index: index + 1 }), { queue });
  }

  async neighbour(forward) {
    if (!this.current) return false;
    if (this.current.mode === 'local') {
      if (this.#stepLocal(forward)) return true;
      this.hooks.toast(forward ? 'Keine weitere lokale Datei' : 'Keine vorherige lokale Datei');
      return false;
    }
    if (isPersonalPlaylist(this.current.list)) {
      if (this.#stepQueue(forward)) return true;
      this.hooks.toast('Kein weiteres Video in der Liste');
      return false;
    }
    this.send(forward ? 'next' : 'previous');
    this.hooks.toast(forward ? 'Nächstes Video' : 'Vorheriges Video');
    return true;
  }

  requestInfo() {
    if (!this.current) return Promise.resolve(null);
    const requestId = ++this.requestSequence;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingInfo.delete(requestId);
        resolve(null);
      }, 1800);
      this.pendingInfo.set(requestId, (info) => {
        clearTimeout(timer);
        resolve(this.#withKnownQualities(info));
      });
      try { this.player.send('guest-command', { name: 'info', requestId }); } catch {
        clearTimeout(timer);
        this.pendingInfo.delete(requestId);
        resolve(null);
      }
    });
  }

  setPlayerOption(name, value) {
    if (name === 'caption') this.preferredCaption = value == null ? null : String(value);
    if (name === 'boost') this.soundBoost = [1, 1.5, 2, 3].includes(Number(value)) ? Number(value) : 1;
    if (name === 'quality') {
      const quality = String(value || 'auto');
      this.preferredQuality = quality;
      this.pendingQuality = this.current?.mode === 'watch' ? quality : null;
      this.qualityCommandSent = false;
      if (this.current?.mode === 'embed') void this.#reloadEmbedForQuality();
      else this.#sendPendingQuality();
      return;
    }
    this.send(name, value);
  }

  async refreshPersonalList() {
    if (this.current && isPersonalPlaylist(this.current.list)) await this.#resolvePersonalList(this.generation);
  }

  #bindPlayer() {
    this.player.addEventListener('ipc-message', (event) => {
      if (event.channel !== 'guest-event') return;
      const message = event.args?.[0];
      if (message?.type) void this.#handleGuest(message.type, message.payload || {});
    });
    this.player.addEventListener('did-fail-load', (event) => {
      if (event.isMainFrame && event.errorCode !== -3) this.hooks.toast(`Laden fehlgeschlagen (${event.errorCode})`);
    });
    this.player.addEventListener('will-navigate', (event) => {
      if (!this.#isAllowedNavigation(event.url)) this.player.stop();
    });
  }

  async #handleGuest(type, payload) {
    if (type === 'video-metadata') {
      const ratio = Number(payload.ratio);
      if (Number.isFinite(ratio) && ratio >= 0.4 && ratio <= 3) this.api.setVideoAspect(ratio);
      return;
    }
    if (type === 'drag-start') return this.api.dragStart(payload);
    if (type === 'drag-move') return this.api.dragMove(payload);
    if (type === 'drag-end') return this.api.dragEnd();
    if (type === 'fullscreen-toggle') return this.api.toggleFullscreen();
    if (type === 'fullscreen-leave') return this.api.leaveFullscreen();
    if (type === 'local-drag') { this.hooks.setLocalDrag?.(Boolean(payload.active)); return; }
    if (type === 'local-drop-result') { this.hooks.openLocal?.(payload); return; }
    if (type === 'boost-status') {
      if (this.soundBoost > 1 && payload.supported === false && this.current?.id !== this.boostWarningId) {
        this.boostWarningId = this.current?.id || 'unknown';
        this.hooks.toast('Soundboost ist für diese Medienquelle nicht verfügbar');
      }
      return;
    }
    if (type === 'quality-status') {
      if (payload.applied === false) this.hooks.toast(payload.reason || 'Auflösung konnte nicht gewechselt werden');
      this.pendingQuality = null;
      this.qualityCommandSent = false;
      return;
    }
    if (type === 'player-info') {
      const resolve = this.pendingInfo.get(payload.requestId);
      if (resolve) {
        this.pendingInfo.delete(payload.requestId);
        resolve(payload.info || null);
      }
      return;
    }
    if (type === 'volume-change') {
      this.hooks.setVolume?.(Number(payload.volume), Boolean(payload.muted));
      return;
    }
    if (!this.current) return;
    if (type === 'embed-status') await this.#handleEmbedStatus(payload);
    else if (type === 'watch-status') await this.#handleWatchStatus(payload);
    else if (type === 'local-status') this.#handleLocalStatus(payload);
  }

  #handleLocalStatus(status) {
    if (!this.current || this.current.mode !== 'local' || status.mediaId !== this.current.id) return;
    if (status.title) this.hooks.setTitle(String(status.title));
    if (status.error) {
      this.hooks.toast(status.error === 4
        ? 'Videoformat oder Codec wird nicht unterstützt'
        : 'Lokales Video konnte nicht abgespielt werden');
      return;
    }
    if (status.ready) this.send('boost', this.soundBoost);
    if (status.ended && !this.#stepLocal(true)) this.hooks.toast('Lokale Wiedergabeliste zu Ende');
  }

  async #handleEmbedStatus(status) {
    if (!this.current || this.current.mode !== 'embed') return;
    this.send('caption', this.preferredCaption);
    this.send('boost', this.soundBoost);
    if (status.videoId && status.videoId !== this.current.id) {
      this.current.id = status.videoId;
      this.current.start = 0;
      this.lastBlockedId = '';
      this.qualityLevels = [];
    }
    if (Number.isInteger(status.index) && status.index >= 0) this.current.index = status.index;
    const playlist = normalizeYouTubeQueue(status.playlist);
    if (playlist.length) this.current.queue = playlist;
    if (status.title) {
      this.hooks.setTitle(status.title);
      this.#rememberYouTubeTitle(status.videoId || this.current.id, status.title);
    }
    this.#publishYouTubeQueue();
    if ([1, 3].includes(status.state)) {
      this.lastBlockedId = '';
    }
    if (status.state === 0 && isPersonalPlaylist(this.current.list)) {
      if (!this.#stepQueue(true)) this.hooks.toast('Liste zu Ende');
      return;
    }
    if (!BLOCKED_ERRORS.has(status.error) || [1, 3].includes(status.state)) return;
    if (this.current.quality) {
      this.preferredQuality = 'auto';
      this.current = { ...this.current, quality: null };
      this.player.src = buildEmbedUrl(this.baseUrl, this.current);
      this.player.focus();
      this.hooks.toast('Gewählte Auflösung nicht verfügbar – zurück zu Auto');
      return;
    }
    const failed = /^[A-Za-z0-9_-]{11}$/.test(status.videoId || '') ? status.videoId : this.current.id;
    if (!failed || failed === this.lastBlockedId) return;
    this.lastBlockedId = failed;
    this.#fallbackToWatch(status.error, failed);
  }

  async #handleWatchStatus(status) {
    if (!this.current || this.current.mode !== 'watch') return;
    this.send('caption', this.preferredCaption);
    this.send('boost', this.soundBoost);
    this.#sendPendingQuality();
    const personal = isPersonalPlaylist(this.current.list);
    const youtubeAdvanced = Boolean(status.videoId && status.videoId !== this.current.id);
    if (personal && (status.state === 0 || youtubeAdvanced)) {
      const advanced = await this.neighbour(true);
      if (!advanced && youtubeAdvanced) {
        this.send('toggle');
        this.hooks.toast('Ursprüngliche Liste ist zu Ende');
      }
      return;
    }
    if (status.videoId && status.videoId !== this.current.id) this.qualityLevels = [];
    if (status.videoId) this.current.id = status.videoId;
    if (Number.isInteger(status.index) && status.index >= 0) this.current.index = status.index;
    const playlist = normalizeYouTubeQueue(status.playlist);
    if (playlist.length) this.current.queue = playlist;
    if (status.title) {
      this.hooks.setTitle(status.title);
      this.#rememberYouTubeTitle(status.videoId || this.current.id, status.title);
    }
    this.#publishYouTubeQueue();
  }

  #fallbackToWatch(code, id, reason = '') {
    if (!this.current) return;
    const selected = /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : this.current.id;
    const start = selected === this.current.id ? this.current.start : 0;
    this.current = { ...this.current, id: selected, start, mode: 'watch' };
    this.player.src = buildWatchUrl(this.current);
    if (code === 'timeout') this.hooks.toast('Embed antwortet nicht – lade YouTube-Seite');
    else this.hooks.toast(reason ? `${reason} – lade YouTube-Seite` : `Embed gesperrt (${code}) – YouTube-Seite`);
  }

  #stepQueue(forward) {
    const queue = this.current?.queue;
    if (!Array.isArray(queue) || !queue.length) return false;
    const found = queue.indexOf(this.current.id);
    const index = (found < 0 ? 0 : found) + (forward ? 1 : -1);
    const id = queue[index];
    if (!id) return false;
    const list = this.current.list;
    this.load(buildWatchUrl({ id, list, index: index + 1 }), { queue });
    return true;
  }

  // Pinning a resolution leaves the player with only that level, so its own
  // list would shrink to the active entry. Report the widest list seen for the
  // current video instead, which keeps every choice reachable.
  #withKnownQualities(info) {
    if (!info || !Array.isArray(info.qualities)) return info;
    const levels = info.qualities.filter((level) => typeof level === 'string' && level);
    if (levels.length > this.qualityLevels.length) this.qualityLevels = levels;
    if (this.qualityLevels.length <= levels.length) return info;
    return { ...info, qualities: this.qualityLevels };
  }

  #rememberYouTubeTitle(id, title) {
    const normalizedId = String(id || '');
    const normalizedTitle = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!YOUTUBE_VIDEO_ID.test(normalizedId) || !normalizedTitle || this.youtubeTitles.get(normalizedId) === normalizedTitle) return;
    this.youtubeTitles.set(normalizedId, normalizedTitle);
  }

  async #reloadEmbedForQuality() {
    if (this.qualitySwitching || !this.current || this.current.mode !== 'embed') return;
    this.qualitySwitching = true;
    const generation = this.generation;
    try {
      const info = await this.requestInfo();
      if (generation !== this.generation || !this.current || this.current.mode !== 'embed') return;
      const currentTime = Math.max(0, Math.floor(Number(info?.currentTime) || this.current.start || 0));
      const quality = this.preferredQuality === 'auto' ? null : this.preferredQuality;
      this.current = { ...this.current, start: currentTime, quality };
      this.player.src = buildEmbedUrl(this.baseUrl, this.current);
      this.player.focus();
      this.hooks.toast('Auflösung wird im Embed neu geladen …');
    } finally {
      this.qualitySwitching = false;
    }
  }

  #sendPendingQuality() {
    if (!this.pendingQuality || this.qualityCommandSent || this.current?.mode !== 'watch') return;
    this.qualityCommandSent = true;
    this.send('quality', this.pendingQuality);
  }

  #publishYouTubeQueue(resolveMetadata = true) {
    if (!this.current || this.current.mode === 'local') return;
    const queue = normalizeYouTubeQueue(this.current.queue);
    if (!queue.length) return;
    this.current.queue = queue;
    const found = queue.indexOf(this.current.id);
    const index = found >= 0
      ? found
      : Math.max(0, Math.min(queue.length - 1, Math.trunc(Number(this.current.index) || 0)));
    const items = queue.map((id, position) => ({
      id,
      name: this.youtubeTitles.get(id) || `YouTube-Video ${String(position + 1).padStart(2, '0')}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    }));
    this.hooks.setPlaylist(queue.length > 1);
    this.hooks.setQueue?.({ mode: 'youtube', items, index });

    const key = queue.join(',');
    if (!resolveMetadata || key === this.queueMetadataKey || typeof this.api.resolveVideoMetadata !== 'function') return;
    this.queueMetadataKey = key;
    void this.api.resolveVideoMetadata(queue).then((result) => {
      if (normalizeYouTubeQueue(this.current?.queue).join(',') !== key) return;
      for (const item of Array.isArray(result?.items) ? result.items : []) this.#rememberYouTubeTitle(item?.id, item?.title);
      this.#publishYouTubeQueue(false);
    }).catch(() => {});
  }

  #stepLocal(forward) {
    if (!this.current || this.current.mode !== 'local') return false;
    const index = this.current.index + (forward ? 1 : -1);
    if (index < 0 || index >= this.current.queue.length) return false;
    return this.loadLocal(this.current.queue, index);
  }

  async #resolvePersonalList(generation) {
    if (!this.current) return;
    const { list, id, index } = this.current;
    this.hooks.toast('Persönliche Liste wird geholt …');
    const result = await this.api.resolveQueue({ id: id || '', list, index });
    if (generation !== this.generation || this.current?.list !== list) return;
    if (Array.isArray(result?.ids) && result.ids.length) {
      this.current.queue = normalizeYouTubeQueue(result.ids);
      this.#publishYouTubeQueue();
      const seedIndex = id ? result.ids.indexOf(id) : 0;
      if (id && index > 1 && seedIndex <= 0) {
        this.hooks.toast('Vorherige Titel fehlen – Browser-Cookies im Menü wählen');
        this.hooks.openMenu();
      } else this.hooks.toast(`Liste mit ${result.ids.length} Titeln`);
      if (!id) this.load(buildWatchUrl({ id: result.ids[0], list }), { queue: result.ids });
      return;
    }
    this.#fallbackToWatch('liste', id, result?.error || 'Liste leer');
  }

  #isAllowedNavigation(rawUrl) {
    if (rawUrl === 'about:blank') return true;
    try {
      const url = new URL(rawUrl);
      if (url.origin === new URL(this.baseUrl).origin) return true;
      const host = url.hostname.toLowerCase();
      return ['youtube.com', 'youtube-nocookie.com', 'youtu.be'].some((domain) => host === domain || host.endsWith(`.${domain}`))
        || host === 'consent.google.com' || host.endsWith('.consent.google.com');
    } catch {
      return false;
    }
  }
}
