const REFRESH_MS = 30_000;

function clock(time) {
  return new Date(time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function guideProgress(listing, now) {
  if (!listing || !(listing.end > listing.start)) return 0;
  return Math.max(0, Math.min(1, (now - listing.start) / (listing.end - listing.start)));
}

export function matchesGuideQuery(channel, query) {
  const text = String(query || '').trim().toLowerCase();
  if (!text) return true;
  if (/^\d+$/.test(text)) return String(channel.number) === text || String(channel.number).startsWith(text);
  return [channel.title, channel.now?.title, channel.now?.subtitle]
    .some((value) => String(value || '').toLowerCase().includes(text));
}

// Channel list for MagentaTV with what runs now and next. Data comes from the
// main process; the panel only filters, renders and reports the chosen channel.
export class GuidePanel {
  constructor({ elements, api, onPlay, currentUrl }) {
    this.elements = elements;
    this.api = api;
    this.onPlay = onPlay;
    this.currentUrl = currentUrl;
    this.guide = null;
    this.timer = null;
    this.loading = false;
  }

  bind() {
    const { search, close, list } = this.elements;
    search.addEventListener('input', () => this.#render());
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
      else if (event.key === 'Enter') { event.preventDefault(); list.querySelector('.guide-item')?.click(); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); list.querySelector('.guide-item')?.focus(); }
      event.stopPropagation();
    });
    list.addEventListener('keydown', (event) => {
      const item = event.target.closest('.guide-item');
      if (!item) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        (event.key === 'ArrowDown' ? item.nextElementSibling : item.previousElementSibling)?.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
      event.stopPropagation();
    });
    close.addEventListener('click', () => this.close());
  }

  isOpen() {
    return !this.elements.panel.hidden;
  }

  toggle(force) {
    const show = force === undefined ? !this.isOpen() : Boolean(force);
    if (show) this.open();
    else this.close();
  }

  open() {
    this.elements.panel.hidden = false;
    this.elements.search.value = '';
    this.#render();
    void this.#load();
    clearInterval(this.timer);
    this.timer = setInterval(() => { this.#render(); void this.#load(); }, REFRESH_MS);
    requestAnimationFrame(() => {
      this.elements.search.focus({ preventScroll: true });
      this.elements.list.querySelector('.guide-item[aria-current="true"]')?.scrollIntoView({ block: 'center' });
    });
  }

  close() {
    this.elements.panel.hidden = true;
    clearInterval(this.timer);
    this.timer = null;
  }

  async #load() {
    if (this.loading) return;
    this.loading = true;
    try {
      const guide = await this.api.magentaGuide();
      if (guide) this.guide = guide;
    } catch {
      this.guide = { error: 'Programmdaten nicht erreichbar', channels: this.guide?.channels || [] };
    } finally {
      this.loading = false;
    }
    if (this.isOpen()) this.#render();
  }

  #render() {
    const { list, count, status } = this.elements;
    const channels = this.guide?.channels || [];
    const query = this.elements.search.value;
    const shown = channels.filter((channel) => matchesGuideQuery(channel, query));
    count.textContent = channels.length ? `${shown.length} Sender` : '';
    status.hidden = Boolean(channels.length) && !this.guide?.error;
    status.textContent = this.guide?.error || (this.loading || !this.guide ? 'Programm wird geladen …' : 'Keine Sender gefunden');
    if (channels.length && !shown.length) { status.hidden = false; status.textContent = 'Kein Sender passt zur Suche'; }

    const scrollTop = list.scrollTop;
    const focusedService = document.activeElement?.closest?.('.guide-item')?.dataset.service;
    const now = Date.now();
    const current = String(this.currentUrl?.() || '');
    const fragment = document.createDocumentFragment();
    for (const channel of shown) fragment.append(this.#row(channel, now, current));
    list.replaceChildren(fragment);
    list.scrollTop = scrollTop;
    if (focusedService) list.querySelector(`.guide-item[data-service="${CSS.escape(focusedService)}"]`)?.focus({ preventScroll: true });
  }

  #row(channel, now, current) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'guide-item';
    item.dataset.service = channel.serviceId;
    const playing = current.includes(`/${encodeURIComponent(channel.serviceId)}`) || (channel.ids || []).some((id) => current.endsWith(`/${id}`));
    if (playing) item.setAttribute('aria-current', 'true');

    const logo = document.createElement('span');
    logo.className = 'guide-logo';
    if (channel.logo) {
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.src = channel.logo;
      logo.append(image);
    }

    const body = document.createElement('span');
    body.className = 'guide-body';
    const head = document.createElement('span');
    head.className = 'guide-head';
    const name = document.createElement('span');
    name.className = 'guide-name';
    name.textContent = `${channel.number ? `${channel.number} ` : ''}${channel.title}`;
    const time = document.createElement('span');
    time.className = 'guide-time';
    time.textContent = channel.now ? `${clock(channel.now.start)}–${clock(channel.now.end)}` : '';
    head.append(name, time);

    const show = document.createElement('span');
    show.className = 'guide-now';
    show.textContent = channel.now ? channel.now.title : 'Keine Programmdaten';
    const progress = document.createElement('span');
    progress.className = 'guide-progress';
    progress.style.setProperty('--progress', String(guideProgress(channel.now, now)));
    const next = document.createElement('span');
    next.className = 'guide-next';
    next.textContent = channel.next ? `danach ${clock(channel.next.start)} ${channel.next.title}` : '';
    body.append(head, show, progress, next);

    item.append(logo, body);
    item.title = [channel.title, channel.now && `${channel.now.title}${channel.now.subtitle ? ` · ${channel.now.subtitle}` : ''}`].filter(Boolean).join('\n');
    item.addEventListener('click', () => {
      this.close();
      this.onPlay(channel.url, channel.title);
    });
    return item;
  }
}
