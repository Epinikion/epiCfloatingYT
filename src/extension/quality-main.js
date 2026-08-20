(() => {
  'use strict';
  if (window.__floatingYtQualityControl) return;
  window.__floatingYtQualityControl = true;
  const HOST_SOURCE = 'floatingyt-host';
  const QUALITY_SOURCE = 'floatingyt-quality';
  const PIXELS = Object.freeze({
    hd2880: 2880,
    hd2160: 2160,
    hd1440: 1440,
    hd1080: 1080,
    hd720: 720,
    large: 480,
    medium: 360,
    small: 240,
    tiny: 144,
  });
  const ALLOWED = new Set(['highres', ...Object.keys(PIXELS), 'auto']);
  let generation = 0;

  function acceptsHostMessage(event) {
    if (event.source === window && event.origin === location.origin) return true;
    if (event.source !== window.parent) return false;
    try {
      const origin = new URL(event.origin);
      return origin.protocol === 'http:' && origin.hostname === '127.0.0.1';
    } catch {
      return false;
    }
  }

  function report(requested, applied, reason = '') {
    window.postMessage({
      source: QUALITY_SOURCE,
      type: 'quality-status',
      payload: { requested, applied: Boolean(applied), reason },
    }, location.origin);
  }

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const text = (element) => String(element?.textContent || element?.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim();
  const qualityNumber = (element) => Number(/\b(4320|2880|2160|1440|1080|720|480|360|240|144)p\b/i.exec(text(element))?.[1] || 0);
  // FloatingYT hides the native popup with CSS, but YouTube still builds and
  // updates its menu DOM when the (also hidden) settings button is clicked.
  const menuRows = () => [...document.querySelectorAll('.ytp-settings-menu .ytp-menuitem')];

  async function applyNativeQuality(requested) {
    const request = ++generation;
    let player = null;
    let settings = null;
    for (let attempt = 0; attempt < 30 && request === generation; attempt += 1) {
      player = document.querySelector('.html5-video-player');
      settings = document.querySelector('.ytp-settings-button');
      if (player && settings) break;
      await wait(100);
    }
    if (!player || !settings) {
      report(requested, false, 'Qualitätsmenü ist noch nicht bereit');
      return;
    }

    // Keep the internal range constraint as a hint, but use YouTube's own
    // menu action to perform the actual adaptive-stream switch. The menu path
    // also discards an incompatible buffered representation immediately.
    player.setPlaybackQualityRange?.(requested);
    player.setPlaybackQuality?.(requested);
    settings.click();
    await wait(80);
    if (request !== generation) return;

    let rows = menuRows();
    let choices = rows.filter((row) => qualityNumber(row) > 0);
    if (choices.length < 2) {
      const rootRows = new Set(rows);
      const qualityMenu = rows.find((row) => qualityNumber(row.querySelector('.ytp-menuitem-content')) > 0)
        || rows.at(-1);
      if (!qualityMenu) {
        settings.click();
        report(requested, false, 'Qualitätsmenü konnte nicht geöffnet werden');
        return;
      }
      qualityMenu.click();
      await wait(80);
      if (request !== generation) return;
      rows = menuRows().filter((row) => !rootRows.has(row));
      choices = rows.filter((row) => qualityNumber(row) > 0);
    }

    let target = null;
    if (requested === 'auto') target = rows.find((row) => qualityNumber(row) === 0) || rows.at(-1);
    else if (requested === 'highres') target = choices.sort((left, right) => qualityNumber(right) - qualityNumber(left))[0];
    else target = choices.find((row) => qualityNumber(row) === PIXELS[requested]);
    if (!target) {
      settings.click();
      report(requested, false, 'Gewählte Auflösung wird für dieses Video nicht angeboten');
      return;
    }

    target.click();
    document.documentElement.dataset.floatingQuality = requested;
    report(requested, true);
  }

  window.addEventListener('message', (event) => {
    if (event.data?.source !== HOST_SOURCE || event.data.type !== 'quality' || !acceptsHostMessage(event)) return;
    const requested = String(event.data.payload?.value || '');
    if (!ALLOWED.has(requested)) return report(requested, false, 'Ungültige Auflösung');
    void applyNativeQuality(requested);
  });
})();
