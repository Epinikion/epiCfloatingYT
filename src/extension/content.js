(() => {
  'use strict';
  if (window.__floatingYtContent) return;
  window.__floatingYtContent = true;
  const SOURCE = 'floatingyt-extension';
  const HOST_SOURCE = 'floatingyt-host';
  const AUDIO_SOURCE = 'floatingyt-audio';
  const QUALITY_SOURCE = 'floatingyt-quality';
  const ASPECT_EPSILON = 0.0005;
  const NEAR_FIT_MAX_GAP = 3;
  const youtube = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i.test(location.hostname);
  const consentPage = /^consent\.google\./i.test(location.hostname);
  const emit = (type, payload = {}) => {
    const target = window.top === window ? window : window.parent;
    target.postMessage({ source: SOURCE, type, payload }, '*');
  };

  function installContextMenuBlocker() {
    document.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  if (youtube) installContextMenuBlocker();

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.source === AUDIO_SOURCE && event.data.type === 'boost-status') emit('boost-status', event.data.payload || {});
    else if (event.data?.source === QUALITY_SOURCE && event.data.type === 'quality-status') emit('quality-status', event.data.payload || {});
  });

  function formatTime(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
      : `${minutes}:${String(remainder).padStart(2, '0')}`;
  }

  function installTimeDisplay() {
    const display = document.createElement('div');
    display.id = '__floating-time-display';
    display.setAttribute('role', 'timer');
    display.setAttribute('aria-label', 'Aktuelle Position und Videodauer');
    document.body.appendChild(display);
    const update = () => {
      const video = document.querySelector('video');
      display.hidden = !video;
      if (!video) return;
      const duration = Number(video.duration);
      const total = Number.isFinite(duration) && duration > 0
        ? formatTime(duration)
        : duration === Infinity ? 'LIVE' : '–:––';
      const text = `${formatTime(video.currentTime)} / ${total}`;
      if (display.textContent !== text) display.textContent = text;
    };
    for (const name of ['loadedmetadata', 'durationchange', 'timeupdate', 'emptied']) {
      document.addEventListener(name, update, true);
    }
    update();
    setInterval(update, 250);
  }

  function ensureFilters() {
    if (document.getElementById('__floating-sharpen-filters')) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = '__floating-sharpen-filters';
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `<defs>
      <filter id="__floating-sharpen-windowed" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"><feConvolveMatrix order="3" preserveAlpha="true" edgeMode="duplicate" kernelMatrix="0 -.42 0 -.42 2.68 -.42 0 -.42 0" /></filter>
      <filter id="__floating-sharpen-fullscreen" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"><feConvolveMatrix order="3" preserveAlpha="true" edgeMode="duplicate" kernelMatrix="0 -.6 0 -.6 3.4 -.6 0 -.6 0" /></filter>
    </defs>`;
    document.documentElement.appendChild(svg);
  }
  window.addEventListener('message', (event) => {
    if (event.data?.source !== HOST_SOURCE || event.data.type !== 'visual') return;
    const state = event.data.payload || {};
    ensureFilters();
    document.documentElement.classList.toggle('__floating-sharpen', Boolean(state.sharpen));
    document.documentElement.classList.toggle('__floating-fullscreen', Boolean(state.fullscreen));
  });

  const rejectPattern = /(alle ablehnen|ablehnen|reject all|reject|nur erforderliche|nur essenzielle)/i;
  const acceptPattern = /(akzeptieren|accept|zustimmen|agree|anpassen|customi[sz]e|mehr optionen|more options|anmelden|sign in)/i;
  function rejectConsent() {
    const candidates = [];
    const collect = (root) => {
      candidates.push(...root.querySelectorAll('button,[role="button"],input[type="submit"],a[role="button"]'));
      for (const element of root.querySelectorAll('*')) if (element.shadowRoot) collect(element.shadowRoot);
    };
    collect(document);
    for (const element of candidates) {
      const label = (element.innerText || element.value || element.getAttribute('aria-label') || '').trim();
      if (label && !acceptPattern.test(label) && rejectPattern.test(label)) { element.click(); return true; }
    }
    return false;
  }

  let adState = null;
  function skipAds() {
    const player = document.querySelector('.html5-video-player');
    if (!player) return;
    const skip = player.querySelector('.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-slot button,button[class*="ytp-ad-skip"]')
      || [...player.querySelectorAll('button')].find((button) => /(überspringen|skip ad|skip ads)/i.test(button.textContent || button.getAttribute('aria-label') || ''));
    skip?.click();
    const video = document.querySelector('video');
    const showing = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting') || player.hasAttribute('data-ad-showing');
    if (showing && video && Number.isFinite(video.duration) && video.duration > 0) {
      adState ||= { muted: video.muted, rate: video.playbackRate };
      video.muted = true;
      video.playbackRate = 16;
      video.currentTime = Math.max(0, video.duration - 0.05);
    } else if (!showing && adState && video) {
      video.muted = adState.muted;
      video.playbackRate = adState.rate;
      adState = null;
    }
    player.querySelector('.ytp-ad-overlay-close-button,.ytp-ad-overlay-close-container')?.click();
  }

  function isControl(event) {
    return event.composedPath().some((node) => node instanceof Element && node.matches([
      'button','a','input','select','[role="button"]','[role="slider"]','[contenteditable="true"]',
      '.ytp-chrome-controls','.ytp-progress-bar-container','.player-controls-bottom','player-middle-controls','yt-progress-bar','.ytp-popup',
    ].join(',')));
  }
  function installGestures() {
    let drag = null;
    let moved = false;
    document.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || isControl(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      drag = { id: event.pointerId, x: event.screenX, y: event.screenY };
      moved = false;
      event.target.setPointerCapture?.(event.pointerId);
      emit('drag-start', { x: event.screenX, y: event.screenY });
    }, true);
    document.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      moved ||= Math.hypot(event.screenX - drag.x, event.screenY - drag.y) > 3;
      event.preventDefault();
      event.stopImmediatePropagation();
      emit('drag-move', { x: event.screenX, y: event.screenY });
    }, true);
    const finish = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      drag = null;
      emit('drag-end');
    };
    document.addEventListener('pointerup', finish, true);
    document.addEventListener('pointercancel', finish, true);
    document.addEventListener('click', (event) => {
      if (isControl(event)) return;
      moved = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    document.addEventListener('dblclick', (event) => {
      if (isControl(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      emit('fullscreen-toggle');
    }, true);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') emit('fullscreen-leave'); }, true);
  }

  function installVideoReporter() {
    let last = 0, candidate = 0, hits = 0;
    const report = () => {
      const video = document.querySelector('video');
      if (!video || video.videoWidth < 2 || video.videoHeight < 2) return;
      const ratio = video.videoWidth / video.videoHeight;
      const width = Math.max(1, document.documentElement.clientWidth || innerWidth);
      const height = Math.max(1, document.documentElement.clientHeight || innerHeight);
      const viewportRatio = width / height;
      const unused = ratio > viewportRatio ? height - width / ratio : width - height * ratio;
      document.documentElement.classList.toggle('__floating-near-fit', unused >= 0 && unused <= NEAR_FIT_MAX_GAP);
      if (Math.abs(ratio - candidate) > ASPECT_EPSILON) { candidate = ratio; hits = 1; return; }
      hits += 1;
      if (hits >= 2 && (!last || Math.abs(Math.log(ratio / last)) > ASPECT_EPSILON)) { last = ratio; emit('video-metadata', { ratio }); }
    };
    document.addEventListener('loadedmetadata', report, true);
    setInterval(report, 500);
  }

  function installControlTimer() {
    let timer = null;
    const playing = () => { const video = document.querySelector('video'); return Boolean(video && !video.paused && !video.ended); };
    const reveal = () => {
      document.documentElement.classList.remove('__floating-controls-hidden');
      clearTimeout(timer);
      if (playing()) timer = setTimeout(() => document.documentElement.classList.add('__floating-controls-hidden'), 900);
    };
    for (const name of ['pointermove','pointerdown','touchstart','keydown','play','playing','pause','ended']) document.addEventListener(name, reveal, { capture: true, passive: true });
    setInterval(() => { if (!playing()) document.documentElement.classList.remove('__floating-controls-hidden'); }, 500);
  }

  function installWatchReporter() {
    if (window.top !== window) return;
    let last = '';
    setInterval(() => {
      if (location.pathname !== '/watch' && !location.pathname.startsWith('/live/')) return;
      const video = document.querySelector('video');
      const payload = {
        videoId: new URL(location.href).searchParams.get('v') || '',
        title: document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, ''),
        state: video?.ended ? 0 : video?.paused ? 2 : 1,
        index: Number(new URL(location.href).searchParams.get('index')) || -1,
        playlist: null,
      };
      const signature = JSON.stringify(payload);
      if (signature !== last) { last = signature; emit('watch-status', payload); }
    }, 750);
  }

  function boot() {
    ensureFilters();
    if (consentPage) { const timer = setInterval(() => { if (rejectConsent()) clearInterval(timer); }, 350); return; }
    if (!youtube) return;
    installGestures();
    installTimeDisplay();
    installVideoReporter();
    installControlTimer();
    installWatchReporter();
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; skipAds(); rejectConsent(); });
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class','data-ad-showing'] });
    setInterval(() => { skipAds(); rejectConsent(); }, 350);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
