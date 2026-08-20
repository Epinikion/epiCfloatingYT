import { buildEmbedUrl, buildWatchUrl, isPersonalPlaylist, parseYouTubeInput } from '../shared/youtube-url.mjs';

const BLOCKED_ERRORS = new Set([100, 101, 150, 'timeout']);

export class PlaybackController {
  constructor({ player, api, baseUrl, hooks, caption = null }) {
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
    this.current = { ...parsed, mode: 'embed', queue: Array.isArray(options.queue) ? options.queue : null };
    this.hooks.setEmpty(false);
    this.hooks.setPlaylist(Boolean(parsed.list));
    this.hooks.setTitle('');
    this.player.src = buildEmbedUrl(this.baseUrl, this.current);
    this.player.focus();
    if (!this.current.queue && isPersonalPlaylist(parsed.list)) void this.#resolvePersonalList(this.generation);
    return true;
  }

  clear() {
    this.generation += 1;
    this.current = null;
    this.player.src = 'about:blank';
    this.hooks.setPlaylist(false);
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

  async neighbour(forward) {
    if (!this.current) return false;
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
        resolve(info);
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
  }

  async #handleEmbedStatus(status) {
    if (!this.current || this.current.mode !== 'embed') return;
    this.send('caption', this.preferredCaption);
    if (status.videoId && status.videoId !== this.current.id) {
      this.current.id = status.videoId;
      this.current.start = 0;
      this.lastBlockedId = '';
    }
    if (Number.isInteger(status.index) && status.index >= 0) this.current.index = status.index;
    if (Array.isArray(status.playlist) && status.playlist.length) this.current.queue = status.playlist;
    if (status.title) this.hooks.setTitle(status.title);
    if ([1, 3].includes(status.state)) {
      this.lastBlockedId = '';
    }
    if (status.state === 0 && isPersonalPlaylist(this.current.list)) {
      if (!this.#stepQueue(true)) this.hooks.toast('Liste zu Ende');
      return;
    }
    if (!BLOCKED_ERRORS.has(status.error) || [1, 3].includes(status.state)) return;
    const failed = /^[A-Za-z0-9_-]{11}$/.test(status.videoId || '') ? status.videoId : this.current.id;
    if (!failed || failed === this.lastBlockedId) return;
    this.lastBlockedId = failed;
    this.#fallbackToWatch(status.error, failed);
  }

  async #handleWatchStatus(status) {
    if (!this.current || this.current.mode !== 'watch') return;
    this.send('caption', this.preferredCaption);
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
    if (status.videoId) this.current.id = status.videoId;
    if (Number.isInteger(status.index) && status.index >= 0) this.current.index = status.index;
    if (Array.isArray(status.playlist) && status.playlist.length) this.current.queue = status.playlist;
    if (status.title) this.hooks.setTitle(status.title);
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

  async #resolvePersonalList(generation) {
    if (!this.current) return;
    const { list, id, index } = this.current;
    this.hooks.toast('Persönliche Liste wird geholt …');
    const result = await this.api.resolveQueue({ id: id || '', list, index });
    if (generation !== this.generation || this.current?.list !== list) return;
    if (Array.isArray(result?.ids) && result.ids.length) {
      this.current.queue = result.ids;
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
