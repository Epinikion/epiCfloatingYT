import { parseYouTubeInput } from '../shared/youtube-url.mjs';

const SEARCH_DELAY = 260;

export function searchResultMeta(result) {
  return [result?.channel, result?.published, result?.views].map((value) => String(value || '').trim()).filter(Boolean).join(' · ');
}

export class SearchController {
  constructor({ api, elements, onPlay, onClose, isEmpty }) {
    this.api = api;
    this.elements = elements;
    this.onPlay = onPlay;
    this.onClose = onClose;
    this.isEmpty = isEmpty;
    this.timer = null;
    this.sequence = 0;
    this.items = [];
    this.active = -1;
  }

  bind() {
    const { input, clear } = this.elements;
    input.addEventListener('input', () => this.#queue());
    input.addEventListener('keydown', (event) => this.#onKeyDown(event));
    input.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text') || '';
      if (!parseYouTubeInput(text)) return;
      event.preventDefault();
      input.value = text.trim();
      this.#play(text);
    });
    clear.addEventListener('click', () => {
      this.reset();
      input.focus();
    });
    this.#queue();
  }

  open(initialValue) {
    document.body.classList.add('searching');
    if (typeof initialValue === 'string') {
      this.elements.input.value = initialValue.trim();
      this.#queue();
    }
    requestAnimationFrame(() => {
      this.elements.input.focus({ preventScroll: true });
      this.elements.input.select();
    });
  }

  close() {
    document.body.classList.remove('searching');
    this.elements.input.blur();
    this.onClose?.();
  }

  isOpen() {
    return document.body.classList.contains('searching');
  }

  setValue(value) {
    this.elements.input.value = String(value || '');
    this.#queue();
  }

  reset() {
    clearTimeout(this.timer);
    this.sequence += 1;
    this.elements.input.value = '';
    this.#clearResults();
    this.#feedback('Suchbegriff eingeben oder YouTube-Link einfügen');
    this.#syncClearButton();
  }

  #queue() {
    clearTimeout(this.timer);
    this.sequence += 1;
    this.#clearResults();
    this.#syncClearButton();
    const query = this.elements.input.value.trim();
    if (parseYouTubeInput(query)) {
      this.#feedback('YouTube-Link erkannt · Enter zum Abspielen');
      return;
    }
    if (query.length < 2) {
      this.#feedback(query ? 'Noch ein Zeichen für die Suche …' : 'Suchbegriff eingeben oder YouTube-Link einfügen');
      return;
    }
    this.#feedback('Bereit zur Suche');
    this.timer = setTimeout(() => void this.#search(query), SEARCH_DELAY);
  }

  async #search(query) {
    const request = ++this.sequence;
    this.#feedback(`Suche nach „${query}“ …`, 'loading');
    let response;
    try { response = await this.api.searchVideos(query); } catch { response = { error: 'YouTube-Suche nicht erreichbar', results: [] }; }
    if (request !== this.sequence || this.elements.input.value.trim() !== query) return;
    const results = Array.isArray(response?.results) ? response.results : [];
    if (response?.error) {
      this.#feedback(response.error, 'error');
      this.#clearResults();
      return;
    }
    if (!results.length) {
      this.#feedback('Keine Videos gefunden', 'error');
      this.#clearResults();
      return;
    }
    this.items = results;
    this.#renderResults();
    this.#setActive(0);
    this.#feedback(`${results.length} Videos gefunden`);
  }

  #renderResults() {
    const container = this.elements.results;
    container.textContent = '';
    const fragment = document.createDocumentFragment();
    this.items.forEach((result, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'search-result';
      button.id = `search-result-${index}`;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', 'false');
      button.tabIndex = -1;

      const thumbnail = document.createElement('span');
      thumbnail.className = 'search-thumbnail';
      const image = document.createElement('img');
      image.alt = '';
      image.loading = index < 4 ? 'eager' : 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.src = `https://i.ytimg.com/vi/${result.id}/mqdefault.jpg`;
      thumbnail.append(image);
      if (result.live || result.duration) {
        const duration = document.createElement('span');
        duration.className = `search-duration${result.live ? ' live' : ''}`;
        duration.textContent = result.live ? 'LIVE' : result.duration;
        thumbnail.append(duration);
      }

      const copy = document.createElement('span');
      copy.className = 'search-copy';
      const title = document.createElement('span');
      title.className = 'search-title';
      title.textContent = result.title;
      const meta = document.createElement('span');
      meta.className = 'search-meta';
      meta.textContent = searchResultMeta(result);
      copy.append(title, meta);
      button.append(thumbnail, copy);
      button.addEventListener('pointermove', () => this.#setActive(index));
      button.addEventListener('click', () => this.#play(result.id));
      fragment.append(button);
    });
    container.append(fragment);
    container.hidden = false;
    this.elements.input.setAttribute('aria-expanded', 'true');
    this.elements.welcome.classList.add('has-results');
  }

  #clearResults() {
    this.items = [];
    this.active = -1;
    this.elements.results.textContent = '';
    this.elements.results.hidden = true;
    this.elements.input.setAttribute('aria-expanded', 'false');
    this.elements.input.removeAttribute('aria-activedescendant');
    this.elements.welcome.classList.remove('has-results');
  }

  #setActive(index) {
    if (!this.items.length) return;
    this.active = (index + this.items.length) % this.items.length;
    for (const [itemIndex, element] of [...this.elements.results.children].entries()) {
      element.setAttribute('aria-selected', String(itemIndex === this.active));
    }
    const selected = this.elements.results.children[this.active];
    this.elements.input.setAttribute('aria-activedescendant', selected.id);
    selected.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  #onKeyDown(event) {
    if (event.key === 'ArrowDown' && this.items.length) {
      event.preventDefault();
      this.#setActive(this.active + 1);
    } else if (event.key === 'ArrowUp' && this.items.length) {
      event.preventDefault();
      this.#setActive(this.active - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const value = this.active >= 0 ? this.items[this.active]?.id : this.elements.input.value;
      if (parseYouTubeInput(value)) this.#play(value);
      else if (this.elements.input.value.trim().length >= 2) {
        clearTimeout(this.timer);
        void this.#search(this.elements.input.value.trim());
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (this.isOpen() && !this.isEmpty()) this.close();
      else {
        this.reset();
        if (this.isOpen()) this.close();
        else this.elements.input.blur();
      }
    }
    event.stopPropagation();
  }

  #play(value) {
    if (!this.onPlay?.(value)) return;
    this.reset();
    this.close();
  }

  #feedback(message, state = '') {
    this.elements.feedback.textContent = message;
    if (state) this.elements.feedback.dataset.state = state;
    else delete this.elements.feedback.dataset.state;
  }

  #syncClearButton() {
    this.elements.clear.hidden = !this.elements.input.value;
  }
}
