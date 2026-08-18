import { buildEmbedUrl, buildWatchUrl, isPersonalPlaylist, parseYouTubeInput } from '../shared/youtube-url.mjs';

const BLOCKED_ERRORS = new Set([100, 101, 150, 'timeout']);
const MAX_SKIPS = 6;

export class PlaybackController {
  constructor({ player, api, baseUrl, hooks }) {
    this.player = player;
    this.api = api;
    this.baseUrl = baseUrl;
    this.hooks = hooks;
    this.current = null;
    this.generation = 0;
    this.pendingInfo = new Map();
    this.requestSequence = 0;
    this.queueRequest = null;
    this.streamSource = null;
    this.blocking = false;
    this.lastBlockedId = '';
    this.#bindPlayer();
  }

  load(input, options = {}) {
    const parsed = parseYouTubeInput(input);
    if (!parsed) {
      this.hooks.toast('Kein gültiger YouTube-Link');
      return false;
    }
    this.generation += 1;
    this.blocking = false;
    this.lastBlockedId = '';
    this.streamSource = null;
    this.current = { ...parsed, mode: 'embed', queue: Array.isArray(options.queue) ? options.queue : null, skips: 0 };
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

  async neighbour(forward) {
    if (!this.current) return false;
    if (isPersonalPlaylist(this.current.list) || this.current.mode === 'stream') {
      if (this.#stepQueue(forward)) return true;
      if (this.queueRequest) {
        this.hooks.toast('Liste wird geholt …');
        await this.queueRequest;
        if (this.#stepQueue(forward)) return true;
      }
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
    if (type === 'guest-ready' && payload.page === 'stream' && this.streamSource) {
      this.send('load-stream', this.streamSource);
      return;
    }
    if (type === 'stream-state') {
      if (!this.current || this.current.mode !== 'stream') return;
      if (payload.error) this.#fallbackToWatch('direktstrom', this.current.id);
      else if (payload.ended) await this.neighbour(true);
      return;
    }
    if (!this.current) return;
    if (type === 'embed-status') await this.#handleEmbedStatus(payload);
    else if (type === 'watch-status') await this.#handleWatchStatus(payload);
  }

  async #handleEmbedStatus(status) {
    if (!this.current || this.current.mode !== 'embed') return;
    if (status.videoId && status.videoId !== this.current.id) {
      this.current.id = status.videoId;
      this.current.start = 0;
      this.lastBlockedId = '';
    }
    if (Number.isInteger(status.index) && status.index >= 0) this.current.index = status.index;
    if (Array.isArray(status.playlist) && status.playlist.length) this.current.queue = status.playlist;
    if (status.title) this.hooks.setTitle(status.title);
    if ([1, 3].includes(status.state)) {
      this.current.skips = 0;
      this.lastBlockedId = '';
    }
    if (status.state === 0 && isPersonalPlaylist(this.current.list)) {
      if (!this.#stepQueue(true)) this.hooks.toast('Liste zu Ende');
      return;
    }
    if (!BLOCKED_ERRORS.has(status.error) || [1, 3].includes(status.state)) return;
    const failed = /^[A-Za-z0-9_-]{11}$/.test(status.videoId || '') ? status.videoId : this.current.id;
    if (!failed || this.blocking || failed === this.lastBlockedId) return;
    this.lastBlockedId = failed;
    await this.#handleBlocked(status.error, failed, this.generation);
  }

  async #handleWatchStatus(status) {
    if (!this.current || this.current.mode !== 'watch') return;
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

  async #handleBlocked(code, id, generation) {
    this.blocking = true;
    if (isPersonalPlaylist(this.current.list)) {
      this.#fallbackToWatch(code, id);
      this.blocking = false;
      return;
    }
    this.#ensureQueue();
    this.hooks.toast(`Video gesperrt (${code}) – hole Direktstrom …`);
    const source = await this.api.resolveStream(id);
    if (generation !== this.generation || !this.current) return;
    if (source?.video && !source.error) {
      this.current = { ...this.current, id, mode: 'stream' };
      this.streamSource = { video: source.video, audio: source.audio || null };
      this.player.src = `${this.baseUrl}/stream.html`;
      if (source.title) this.hooks.setTitle(source.title);
      this.hooks.toast(source.height ? `Direktstrom ${source.height}p` : 'Direktstrom');
      this.blocking = false;
      return;
    }
    const reason = source?.error || 'kein Ergebnis';
    if (this.current.list && this.current.skips < MAX_SKIPS) {
      this.current.skips += 1;
      this.lastBlockedId = '';
      this.hooks.toast(`${reason} – Titel übersprungen`);
      this.send('next');
    } else this.#fallbackToWatch(code, id, reason);
    this.blocking = false;
  }

  #fallbackToWatch(code, id, reason = '') {
    if (!this.current) return;
    const selected = /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : this.current.id;
    const start = selected === this.current.id ? this.current.start : 0;
    this.current = { ...this.current, id: selected, start, mode: 'watch' };
    this.streamSource = null;
    this.player.src = buildWatchUrl(this.current);
    if (code === 'direktstrom') this.hooks.toast('Direktstrom abgebrochen – lade YouTube-Seite');
    else if (code === 'timeout') this.hooks.toast('Embed antwortet nicht – lade YouTube-Seite');
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

  #ensureQueue() {
    if (!this.current?.list || this.current.queue?.length || this.queueRequest) return;
    const generation = this.generation;
    this.queueRequest = this.api.resolveQueue({ id: this.current.id || '', list: this.current.list, index: this.current.index || 0 })
      .then((result) => {
        if (generation === this.generation && Array.isArray(result?.ids) && this.current) this.current.queue = result.ids;
        return result;
      })
      .finally(() => { this.queueRequest = null; });
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
    this.hooks.toast(`${result?.error || 'Liste leer'} – lade YouTube-Seite`);
    this.#fallbackToWatch('liste', id);
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
