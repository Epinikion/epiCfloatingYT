const STORAGE_KEY = 'floatingyt.resume';
const LIMIT = 300;

// Remembers where YouTube videos stopped in the app. Each entry also keeps the
// YouTube history position known at that moment, so a later change there shows
// that the video was watched elsewhere since.
export class ResumeStore {
  constructor(storage) {
    this.storage = storage;
  }

  get(id) {
    const entry = this.#read()[id];
    return entry && Number.isFinite(entry.time) ? entry : null;
  }

  set(id, entry) {
    const entries = this.#read();
    entries[id] = entry;
    const ids = Object.keys(entries);
    if (ids.length > LIMIT) {
      ids.sort((a, b) => (entries[a].at || 0) - (entries[b].at || 0));
      for (const old of ids.slice(0, ids.length - LIMIT)) delete entries[old];
    }
    this.#write(entries);
  }

  delete(id) {
    const entries = this.#read();
    if (!(id in entries)) return;
    delete entries[id];
    this.#write(entries);
  }

  #read() {
    try {
      const value = JSON.parse(this.storage?.getItem(STORAGE_KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  #write(entries) {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch {}
  }
}
