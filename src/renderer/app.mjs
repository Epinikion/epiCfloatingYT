import { parseYouTubeInput } from '../shared/youtube-url.mjs';
import { PlaybackController } from './playback-controller.mjs';
import { SearchController } from './search-controller.mjs';
import { AmbientLight, ResizeSmoother } from './visual-effects.mjs';

const QUALITY_LABELS = {
  highres: '4320p', hd2880: '2880p', hd2160: '2160p', hd1440: '1440p',
  hd1080: '1080p', hd720: '720p', large: '480p', medium: '360p', small: '240p', tiny: '144p', auto: 'Auto',
};
const BROWSER_LABELS = {
  '': 'aus', firefox: 'Firefox', chrome: 'Chrome', edge: 'Edge', brave: 'Brave',
  vivaldi: 'Vivaldi', opera: 'Opera', chromium: 'Chromium',
};
const BOOST_OPTIONS = [
  { value: 1, label: 'Aus' },
  { value: 1.5, label: '150 %' },
  { value: 2, label: '200 %' },
  { value: 3, label: '300 %' },
];

class FloatingApp {
  constructor(api) {
    this.api = api;
    this.elements = Object.fromEntries([
      'player', 'stage', 'toolbar', 'url-input', 'pin', 'settings-menu', 'settings', 'toast',
      'video-title', 'ambient', 'resize-snapshot', 'volume', 'volume-value', 'volume-toggle',
      'help', 'help-overlay', 'help-dialog', 'help-close', 'welcome-help',
      'search', 'welcome', 'search-results', 'search-feedback', 'search-clear', 'drop-overlay',
      'playlist', 'playlist-panel', 'playlist-list', 'playlist-count', 'playlist-close',
    ].map((id) => [id, document.getElementById(id)]));
    this.titleText = this.elements['video-title'].querySelector('span');
    this.ambient = new AmbientLight(this.elements.ambient.querySelector('canvas'));
    this.smoother = new ResizeSmoother(this.elements.player, this.elements['resize-snapshot']);
    this.playback = null;
    this.videoRatio = 16 / 9;
    this.glow = true;
    this.fullscreen = false;
    this.hoverTop = false;
    this.toolbarSticky = false;
    this.toolbarTimer = null;
    this.toastTimer = null;
    this.cookieBrowser = '';
    this.caption = null;
    this.soundBoost = 1;
    this.menuMuted = false;
    this.volumeTimer = null;
    this.title = '';
    this.optionWishes = new Map();
    this.pendingShortcut = null;
    this.pendingLocalDrop = null;
    this.dropLeaveTimer = null;
    this.playlistItems = [];
    this.playlistIndex = -1;
    this.searchController = new SearchController({
      api: this.api,
      elements: {
        input: this.elements['url-input'],
        results: this.elements['search-results'],
        feedback: this.elements['search-feedback'],
        clear: this.elements['search-clear'],
        welcome: this.elements.welcome,
      },
      onPlay: (value) => Boolean(this.playback?.load(value)),
      onClose: () => this.#hideToolbar(),
      isEmpty: () => document.body.classList.contains('empty'),
    });
  }

  async start() {
    this.#bindMainEvents();
    this.#bindUi();
    const state = await this.api.getState();
    this.videoRatio = Number.isFinite(state.window?.aspect) ? state.window.aspect : 16 / 9;
    this.glow = Boolean(state.glow);
    this.cookieBrowser = state.cookieBrowser || '';
    this.caption = state.caption == null ? null : String(state.caption);
    this.soundBoost = [1, 1.5, 2, 3].includes(Number(state.soundBoost)) ? Number(state.soundBoost) : 1;
    document.body.classList.toggle('glow', this.glow);
    this.elements.pin.classList.toggle('off', !state.pinned);
    this.playback = new PlaybackController({
      player: this.elements.player,
      api: this.api,
      baseUrl: state.baseUrl,
      caption: this.caption,
      soundBoost: this.soundBoost,
      hooks: {
        toast: (text) => this.toast(text),
        setEmpty: (empty) => this.setEmpty(empty),
        setPlaylist: (visible) => document.body.classList.toggle('has-playlist', visible),
        setQueue: (queue) => this.#setPlaylistState(queue),
        setTitle: (title) => this.setTitle(title),
        setVolume: (volume, muted) => {
          this.#paintVolume(volume, muted);
          this.toast(`Lautstärke ${Math.max(0, Math.min(100, Math.round(Number(volume) || 0)))} %`);
        },
        setLocalDrag: (active) => this.#setLocalDrag(active),
        openLocal: (result) => this.#openLocalResult(result),
        openMenu: () => this.toggleMenu(true),
      },
    });
    if (this.pendingShortcut) {
      const pending = this.pendingShortcut;
      this.pendingShortcut = null;
      this.#handleShortcut(pending);
    }
    if (this.pendingLocalDrop) {
      const pending = this.pendingLocalDrop;
      this.pendingLocalDrop = null;
      this.#openLocalResult(pending);
    }
    this.layout();
    this.setEmpty(true);
    if (parseYouTubeInput(state.clipboard)) this.searchController.setValue(state.clipboard);
    this.elements['url-input'].focus();
  }

  #bindMainEvents() {
    this.api.onAmbientFrame((frame) => this.ambient.update(frame, document.body.classList.contains('empty')));
    this.api.onHover((near) => { this.hoverTop = near; this.#paintToolbar(); });
    this.api.onPin((pinned) => {
      this.elements.pin.classList.toggle('off', !pinned);
      this.toast(pinned ? 'Immer im Vordergrund: an' : 'Immer im Vordergrund: aus');
    });
    this.api.onSetting(({ name, value }) => {
      if (name === 'glow') {
        this.glow = Boolean(value);
        document.body.classList.toggle('glow', this.glow);
        this.layout();
        this.toast(this.glow ? 'Randlicht: an' : 'Randlicht: aus');
      } else if (name === 'sharpen') this.toast(value ? 'Schärfung: an' : 'Schärfung: aus');
    });
    this.api.onFullscreen((enabled) => {
      this.fullscreen = Boolean(enabled);
      document.body.classList.toggle('fullscreen', this.fullscreen);
      if (this.fullscreen) this.#hideToolbar();
      else this.toggleMenu(false);
      this.layout();
    });
    this.api.onResizePhase((phase) => {
      if (phase === 'start') this.smoother.begin(document.body.classList.contains('empty'));
      else if (phase === 'end') void this.smoother.end();
    });
    this.api.onAspect((ratio) => {
      if (Number.isFinite(ratio) && ratio >= 0.4 && ratio <= 3) {
        this.videoRatio = ratio;
        this.layout();
      }
    });
    this.api.onShortcut((message) => this.#handleShortcut(message));
    this.api.onLocalDrag((active) => this.#setLocalDrag(active));
    this.api.onLocalDrop((result) => this.#openLocalResult(result));
  }

  #bindUi() {
    const input = this.elements['url-input'];
    this.searchController.bind();

    document.getElementById('close').addEventListener('click', () => this.api.close());
    document.getElementById('minimize').addEventListener('click', () => this.api.minimize());
    this.elements.pin.addEventListener('click', () => this.api.togglePin());
    document.getElementById('previous').addEventListener('click', () => void this.playback?.neighbour(false));
    document.getElementById('next').addEventListener('click', () => void this.playback?.neighbour(true));
    this.elements.playlist.addEventListener('click', (event) => { event.stopPropagation(); this.togglePlaylist(); });
    this.elements['playlist-close'].addEventListener('click', () => this.togglePlaylist(false));
    this.elements.search.addEventListener('click', (event) => { event.stopPropagation(); this.toggleSearch(true); });
    this.elements.settings.addEventListener('click', (event) => { event.stopPropagation(); this.toggleMenu(); });
    this.elements.help.addEventListener('click', (event) => { event.stopPropagation(); this.toggleHelp(); });
    this.elements['welcome-help'].addEventListener('click', () => this.toggleHelp(true));
    this.elements['help-close'].addEventListener('click', () => this.toggleHelp(false));
    this.elements['help-overlay'].addEventListener('click', (event) => { if (event.target === this.elements['help-overlay']) this.toggleHelp(false); });
    for (const tab of document.querySelectorAll('[data-help-tab]')) tab.addEventListener('click', () => this.#selectHelpTab(tab.dataset.helpTab));
    this.elements.toolbar.addEventListener('dblclick', () => this.#showToolbar());

    document.addEventListener('mousedown', (event) => {
      if (!this.elements['settings-menu'].hidden && !event.target.closest('#settings-menu') && event.target !== this.elements.settings) this.toggleMenu(false);
      if (!this.elements['playlist-panel'].hidden && !event.target.closest('#playlist-panel') && !event.target.closest('#playlist')) this.togglePlaylist(false);
    });
    document.addEventListener('keydown', (event) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && ['f', 'l'].includes(key)) { event.preventDefault(); this.toggleSearch(true); return; }
      if (key === 'f1') { event.preventDefault(); this.toggleHelp(); return; }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && key === '/' && event.target !== input) { event.preventDefault(); this.toggleSearch(true); return; }
      if (event.target === input || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!this.elements['help-overlay'].hidden && key === 'escape') { event.preventDefault(); this.toggleHelp(false); }
      else if (key === ' ' || key === 'k') { event.preventDefault(); this.playback?.togglePlay(); }
      else if (key === 'm') this.playback?.toggleMute();
      else if (!event.shiftKey && ['arrowup', 'arrowdown'].includes(key)
        && !event.target.closest('input,button,select,[role="slider"],[contenteditable="true"]')) {
        event.preventDefault();
        this.playback?.adjustVolume(key === 'arrowup' ? 5 : -5);
      }
      else if (key === 'escape') this.#hideToolbar();
    });

    this.#bindVolume();
    this.#bindResizeHandles();
    window.addEventListener('resize', () => { this.layout(); this.#measureTitle(); });
    new ResizeObserver(() => this.layout()).observe(document.documentElement);
  }

  #bindVolume() {
    const slider = this.elements.volume;
    slider.addEventListener('input', () => {
      const value = Number(slider.value);
      this.#paintVolume(value, false);
      clearTimeout(this.volumeTimer);
      this.volumeTimer = setTimeout(() => this.playback?.setPlayerOption('volume', value), 45);
    });
    slider.addEventListener('change', () => {
      clearTimeout(this.volumeTimer);
      this.playback?.setPlayerOption('volume', Number(slider.value));
      setTimeout(() => void this.#refreshMenu(), 120);
    });
    this.elements['volume-toggle'].addEventListener('click', () => {
      let target = !this.menuMuted;
      if (this.menuMuted && Number(slider.value) === 0) {
        this.#paintVolume(50, false);
        this.playback?.setPlayerOption('volume', 50);
        target = false;
      } else this.#paintVolume(Number(slider.value), target);
      this.playback?.setPlayerOption('muted', target);
      setTimeout(() => void this.#refreshMenu(), 120);
    });
  }

  #bindResizeHandles() {
    for (const handle of document.querySelectorAll('#resize-handles [data-direction]')) {
      let active = false;
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || !this.glow || this.fullscreen) return;
        event.preventDefault();
        active = true;
        handle.setPointerCapture(event.pointerId);
        this.api.resizeStart({ direction: handle.dataset.direction, x: event.screenX, y: event.screenY });
      });
      handle.addEventListener('pointermove', (event) => {
        if (!active) return;
        event.preventDefault();
        this.api.resizeMove({ x: event.screenX, y: event.screenY });
      });
      const finish = (event) => {
        if (!active) return;
        active = false;
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        this.api.resizeEnd();
      };
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
      handle.addEventListener('lostpointercapture', (event) => {
        if (!active) return;
        if (event.buttons & 1) {
          try { handle.setPointerCapture(event.pointerId); return; } catch {}
        }
        active = false;
        this.api.resizeEnd();
      });
    }
  }

  layout() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scale = this.glow && !this.fullscreen ? 1.15 : 1;
    const availableWidth = Math.max(1, Math.round(width / scale));
    const availableHeight = Math.max(1, Math.round(height / scale));
    let stageWidth = availableWidth;
    let stageHeight = Math.round(stageWidth / this.videoRatio);
    if (stageHeight > availableHeight) {
      stageHeight = availableHeight;
      stageWidth = Math.round(stageHeight * this.videoRatio);
    }
    const left = Math.round((width - stageWidth) / 2);
    const top = Math.round((height - stageHeight) / 2);
    Object.assign(this.elements.stage.style, { left: `${left}px`, top: `${top}px`, width: `${stageWidth}px`, height: `${stageHeight}px` });
    this.smoother.update(stageWidth, stageHeight);

    const ambientCanvas = this.elements.ambient.querySelector('canvas');
    Object.assign(ambientCanvas.style, { left: `${left}px`, top: `${top}px`, width: `${stageWidth}px`, height: `${stageHeight}px` });
    this.elements.ambient.style.setProperty('--ambient-x', `${left}px`);
    this.elements.ambient.style.setProperty('--ambient-y', `${top}px`);
    this.elements.ambient.style.setProperty('--ambient-blur', `${Math.max(16, Math.min(46, Math.round(Math.min(stageWidth, stageHeight) * 0.08)))}px`);

    Object.assign(this.elements.toolbar.style, { left: `${left}px`, top: `${top}px`, width: `${stageWidth}px` });
    const menu = this.elements['settings-menu'];
    menu.style.left = `${left + Math.round(stageWidth / 2)}px`;
    menu.style.bottom = `${Math.round(height - top - stageHeight + Math.max(12, stageHeight * 0.08))}px`;
    menu.style.maxWidth = `${Math.max(280, stageWidth - 24)}px`;
    menu.style.maxHeight = `${Math.max(150, stageHeight - 48)}px`;
    const playlist = this.elements['playlist-panel'];
    playlist.style.left = `${left + stageWidth - 8}px`;
    playlist.style.top = `${top + 36}px`;
    playlist.style.maxWidth = `${Math.max(180, stageWidth - 16)}px`;
    playlist.style.maxHeight = `${Math.max(110, stageHeight - 48)}px`;
    document.documentElement.style.setProperty('--stage-left', `${left}px`);
    document.documentElement.style.setProperty('--stage-top', `${top}px`);
    document.documentElement.style.setProperty('--stage-width', `${stageWidth}px`);
    document.documentElement.style.setProperty('--stage-height', `${stageHeight}px`);
    const timelineInset = Math.min(26, Math.max(10, Math.round(stageHeight * 0.022)));
    const toastLift = Math.min(38, Math.max(22, Math.round(stageHeight * 0.045)));
    this.elements.toast.style.left = `${left + Math.round(stageWidth / 2)}px`;
    this.elements.toast.style.bottom = `${Math.round(height - top - stageHeight + timelineInset + toastLift)}px`;
  }

  setEmpty(empty) {
    document.body.classList.toggle('empty', empty);
    if (empty) {
      document.body.classList.remove('has-playlist');
      this.ambient.paintWelcome();
      this.setTitle('');
    }
  }

  setTitle(title) {
    const normalized = String(title || '').trim();
    if (normalized === this.title) return;
    this.title = normalized;
    this.titleText.textContent = normalized;
    this.#measureTitle();
  }

  #measureTitle() {
    const box = this.elements['video-title'];
    box.classList.remove('scroll');
    if (!this.title) return;
    requestAnimationFrame(() => {
      const overflow = this.titleText.scrollWidth - box.clientWidth;
      if (overflow <= 4) return;
      box.style.setProperty('--title-shift', `${overflow}px`);
      box.style.setProperty('--title-duration', `${Math.max(6, overflow / 30 + 4)}s`);
      box.classList.add('scroll');
    });
  }

  toast(text) {
    this.elements.toast.textContent = String(text || '');
    this.elements.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.elements.toast.classList.remove('show'), 1800);
  }

  #openLocalResult(result) {
    clearTimeout(this.dropLeaveTimer);
    document.body.classList.remove('drop-active');
    if (!this.playback) { this.pendingLocalDrop = result; return; }
    if (!Array.isArray(result?.items) || !result.items.length) {
      this.toast(result?.error || 'Keine unterstützten Videodateien gefunden');
      return;
    }
    this.searchController.reset();
    this.toggleSearch(false);
    this.toggleHelp(false);
    this.toggleMenu(false);
    if (!this.playback.loadLocal(result.items)) return;
    const count = result.items.length;
    this.toast(result.truncated
      ? `${count} lokale Videos geladen (Liste begrenzt)`
      : count === 1 ? 'Lokales Video geladen' : `${count} lokale Videos geladen`);
  }

  #setLocalDrag(active) {
    clearTimeout(this.dropLeaveTimer);
    if (active) {
      document.body.classList.add('drop-active');
      return;
    }
    // Keep the host overlay alive while Chromium hands a native drag from the
    // webview to the surrounding renderer. It then captures the final drop.
    this.dropLeaveTimer = setTimeout(() => document.body.classList.remove('drop-active'), 90);
  }

  #setPlaylistState(queue) {
    const items = Array.isArray(queue?.items) ? queue.items : [];
    const mode = queue?.mode === 'youtube' ? 'youtube' : 'local';
    this.playlistItems = items.map((item) => ({
      id: String(item?.id || ''),
      name: String(item?.name || '').trim(),
      thumbnail: mode === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(String(item?.id || ''))
        ? `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`
        : '',
      mode,
    })).filter((item) => item.name);
    this.playlistIndex = this.playlistItems.length
      ? Math.max(0, Math.min(this.playlistItems.length - 1, Math.trunc(Number(queue?.index) || 0)))
      : -1;
    document.body.classList.toggle('has-queue-list', this.playlistItems.length > 1);
    this.#renderPlaylist();
    if (this.playlistItems.length <= 1) this.togglePlaylist(false);
  }

  #renderPlaylist() {
    const list = this.elements['playlist-list'];
    list.textContent = '';
    this.elements['playlist-count'].textContent = this.playlistItems.length
      ? `${this.playlistIndex + 1} / ${this.playlistItems.length}`
      : '';
    this.playlistItems.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `playlist-item ${item.mode}`;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(index === this.playlistIndex));
      button.title = item.name;
      const number = document.createElement('span');
      number.className = 'playlist-index';
      number.textContent = String(index + 1).padStart(2, '0');
      const name = document.createElement('span');
      name.className = 'playlist-name';
      name.textContent = item.name;
      button.append(number);
      if (item.thumbnail) {
        const thumbnail = document.createElement('img');
        thumbnail.className = 'playlist-thumbnail';
        thumbnail.src = item.thumbnail;
        thumbnail.alt = '';
        thumbnail.loading = 'lazy';
        button.append(thumbnail);
      }
      button.append(name);
      button.addEventListener('click', () => {
        if (this.playback?.selectQueue(index)) this.togglePlaylist(false);
      });
      list.append(button);
    });
  }

  togglePlaylist(force) {
    const panel = this.elements['playlist-panel'];
    const show = this.playlistItems.length > 1 && (force === undefined ? panel.hidden : Boolean(force));
    if (show) {
      this.toggleMenu(false);
      this.toggleHelp(false);
      this.toggleSearch(false);
      panel.hidden = false;
      requestAnimationFrame(() => panel.querySelector('.playlist-item[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
    } else panel.hidden = true;
    this.elements.playlist.classList.toggle('active', show);
    this.elements.playlist.setAttribute('aria-expanded', String(show));
  }

  toggleMenu(force) {
    const menu = this.elements['settings-menu'];
    const show = force === undefined ? menu.hidden : Boolean(force);
    if (show) { this.toggleHelp(false); this.toggleSearch(false); this.togglePlaylist(false); }
    menu.hidden = !show;
    if (show) void this.#refreshMenu();
  }

  toggleHelp(force) {
    const overlay = this.elements['help-overlay'];
    const show = force === undefined ? overlay.hidden : Boolean(force);
    if (show) {
      this.elements['settings-menu'].hidden = true;
      this.togglePlaylist(false);
      overlay.hidden = false;
      this.#selectHelpTab('playback');
      this.elements['help-close'].focus();
      this.#showToolbar();
    } else if (!overlay.hidden) {
      overlay.hidden = true;
      (this.searchController.isOpen() ? this.elements['url-input'] : document.body.classList.contains('empty') ? this.elements['welcome-help'] : this.elements.help).focus({ preventScroll: true });
    }
  }

  toggleSearch(force, initialValue) {
    const show = force === undefined ? !this.searchController.isOpen() : Boolean(force);
    if (show) {
      this.toggleMenu(false);
      this.toggleHelp(false);
      this.togglePlaylist(false);
      this.searchController.open(initialValue);
      this.#showToolbar();
    } else if (this.searchController.isOpen()) this.searchController.close();
  }

  #selectHelpTab(name) {
    for (const tab of document.querySelectorAll('[data-help-tab]')) {
      const selected = tab.dataset.helpTab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of document.querySelectorAll('[data-help-panel]')) panel.hidden = panel.dataset.helpPanel !== name;
  }

  async #refreshMenu() {
    const [info, browsers] = await Promise.all([this.playback?.requestInfo(), this.api.cookieBrowsers()]);
    if (info) {
      this.#paintVolume(info.volume, info.muted);
      this.#fillOptions('quality-options', info.qualities.map((quality) => ({ value: quality, label: QUALITY_LABELS[quality] || quality })), info.quality, 'quality');
      this.#fillOptions('rate-options', info.rates.map((rate) => ({ value: rate, label: rate === 1 ? '1×' : `${rate}×` })), info.rate, 'rate');
      this.#fillOptions('caption-options', [{ value: null, label: 'Aus' }, ...info.tracks.slice(0, 5).map((track) => ({ value: track.code, label: track.name }))], info.track, 'caption');
    } else {
      this.#paintVolume(0, false, false);
      for (const id of ['quality-options', 'rate-options', 'caption-options']) this.#fillOptions(id, [], null, '');
    }
    this.#fillOptions('boost-options', BOOST_OPTIONS, this.soundBoost, 'boost');
    const cookieItems = browsers.map((browser) => ({ value: browser, label: BROWSER_LABELS[browser] || browser }));
    this.#fillOptions('cookie-options', cookieItems, this.cookieBrowser, 'cookie');
  }

  #fillOptions(id, items, active, command) {
    const container = document.getElementById(id);
    container.textContent = '';
    if (!items.length) {
      const note = document.createElement('span');
      note.className = 'unavailable';
      note.textContent = 'nicht verfügbar';
      container.append(note);
      return;
    }
    const wish = this.optionWishes.get(id);
    const shown = wish && wish.until > Date.now() && wish.value !== active ? wish.value : active;
    if (wish && (wish.value === active || wish.until <= Date.now())) this.optionWishes.delete(id);
    for (const item of items) {
      const button = document.createElement('button');
      button.textContent = item.label;
      button.classList.toggle('active', item.value === shown);
      button.addEventListener('click', async () => {
        for (const child of container.children) child.classList.remove('active');
        button.classList.add('active');
        if (command === 'cookie') {
          this.cookieBrowser = await this.api.setCookieBrowser(item.value);
          await this.#refreshMenu();
          if (this.cookieBrowser) await this.playback?.refreshPersonalList();
          else this.toast('Ohne Browser-Cookies');
          return;
        }
        let selectedValue = item.value;
        if (command === 'caption') {
          this.caption = await this.api.setCaption(item.value);
          selectedValue = this.caption;
        } else if (command === 'boost') {
          this.soundBoost = await this.api.setSoundBoost(item.value);
          selectedValue = this.soundBoost;
        }
        this.optionWishes.set(id, { value: selectedValue, until: Date.now() + 8000 });
        this.playback?.setPlayerOption(command, selectedValue);
        setTimeout(() => void this.#refreshMenu(), 500);
        setTimeout(() => void this.#refreshMenu(), 1800);
      });
      container.append(button);
    }
  }

  #paintVolume(volume, muted, available = true) {
    const value = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)));
    this.menuMuted = Boolean(muted);
    this.elements.volume.disabled = !available;
    this.elements['volume-toggle'].disabled = !available;
    this.elements.volume.value = String(value);
    this.elements['volume-value'].textContent = available ? `${value} %` : '—';
    this.elements.volume.style.setProperty('--volume', `${value}%`);
    const icon = this.elements['volume-toggle'].querySelector('use');
    icon.setAttribute('href', this.menuMuted || value === 0 ? '#i-muted' : value < 50 ? '#i-volume-mid' : '#i-volume');
    this.elements['volume-toggle'].title = this.menuMuted ? 'Ton einschalten' : 'Stumm schalten';
  }

  #showToolbar() {
    this.toolbarSticky = true;
    this.#paintToolbar();
    clearTimeout(this.toolbarTimer);
    this.toolbarTimer = setTimeout(() => { this.toolbarSticky = false; this.#paintToolbar(); }, 2500);
  }

  #hideToolbar() {
    this.toolbarSticky = false;
    clearTimeout(this.toolbarTimer);
    this.#paintToolbar();
  }

  #paintToolbar() {
    this.elements.toolbar.classList.toggle('show', this.hoverTop || this.toolbarSticky);
  }

  #handleShortcut(message) {
    if (!this.playback) {
      this.pendingShortcut = message;
      return;
    }
    switch (message?.name) {
      case 'load-url':
        if (parseYouTubeInput(message.url)) {
          this.searchController.reset();
          this.toggleSearch(false);
          this.playback?.load(message.url);
        } else this.toggleSearch(true, message.url);
        break;
      case 'play-pause': this.playback?.togglePlay(); break;
      case 'mute': this.playback?.toggleMute(); break;
      case 'volume-step': this.playback?.adjustVolume(message.delta); break;
      case 'next': void this.playback?.neighbour(true); break;
      case 'previous': void this.playback?.neighbour(false); break;
      case 'menu': this.toggleMenu(); break;
      case 'playlist':
        if (this.playlistItems.length > 1) this.togglePlaylist();
        else this.toast('Keine Playlist geladen');
        break;
      case 'search': this.toggleSearch(true); break;
      case 'help': this.toggleHelp(); break;
      case 'escape':
        if (!this.elements['help-overlay'].hidden) this.toggleHelp(false);
        else if (!this.elements['settings-menu'].hidden) this.toggleMenu(false);
        else if (!this.elements['playlist-panel'].hidden) this.togglePlaylist(false);
        else if (this.searchController.isOpen()) this.toggleSearch(false);
        else this.#hideToolbar();
        break;
      case 'toast': this.toast(message.text); break;
    }
  }
}

const application = new FloatingApp(window.floatingApi);
void application.start();
