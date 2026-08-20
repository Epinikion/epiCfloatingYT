(() => {
  'use strict';
  if (window.__floatingYtAudioBoost) return;
  window.__floatingYtAudioBoost = true;
  const HOST_SOURCE = 'floatingyt-host';
  const AUDIO_SOURCE = 'floatingyt-audio';
  let requestedGain = 1;
  let active = null;
  let applyGeneration = 0;

  function normalizedGain(value) {
    const numeric = Number(value);
    return [1, 1.5, 2, 3].includes(numeric) ? numeric : 1;
  }

  function report(supported, gain = requestedGain) {
    window.postMessage({
      source: AUDIO_SOURCE,
      type: 'boost-status',
      payload: { supported: Boolean(supported), gain },
    }, location.origin);
  }

  function processableVideo() {
    const video = document.querySelector('video');
    if (!video?.currentSrc) return null;
    try {
      return new URL(video.currentSrc, location.href).origin === location.origin ? video : false;
    } catch {
      return false;
    }
  }

  function createGraph(video) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio unavailable');
    const context = new AudioContextClass();
    const source = context.createMediaElementSource(video);
    const gain = context.createGain();
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = 0;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = .003;
    limiter.release.value = .18;
    source.connect(gain).connect(limiter).connect(context.destination);
    return { video, context, gain };
  }

  function applyNow() {
    const video = processableVideo();
    if (video === null) return null;
    if (video === false) return false;
    if (requestedGain === 1 && !active) {
      document.documentElement.dataset.floatingSoundBoost = '1';
      report(true, 1);
      return true;
    }
    try {
      if (!active || active.video !== video) active = createGraph(video);
      active.gain.gain.setTargetAtTime(requestedGain, active.context.currentTime, .015);
      document.documentElement.dataset.floatingSoundBoost = String(requestedGain);
      void active.context.resume().catch(() => {});
      report(true);
      return true;
    } catch (error) {
      document.documentElement.dataset.floatingSoundBoost = '1';
      document.documentElement.dataset.floatingSoundBoostError = String(error?.name || 'AudioError');
      report(false, 1);
      return false;
    }
  }

  function applyWithRetry() {
    const generation = ++applyGeneration;
    let attempts = 0;
    const attempt = () => {
      if (generation !== applyGeneration) return;
      const applied = applyNow();
      if (applied !== null) return;
      attempts += 1;
      if (attempts < 20) setTimeout(attempt, 100);
      else report(false, 1);
    };
    attempt();
  }

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

  window.addEventListener('message', (event) => {
    if (event.data?.source !== HOST_SOURCE || event.data.type !== 'boost' || !acceptsHostMessage(event)) return;
    requestedGain = normalizedGain(event.data.payload?.gain);
    applyWithRetry();
  });
  document.addEventListener('loadedmetadata', () => { if (requestedGain > 1) applyWithRetry(); }, true);
  for (const name of ['pointerdown', 'keydown', 'touchstart']) {
    document.addEventListener(name, () => { if (active?.context.state === 'suspended') void active.context.resume(); }, true);
  }
})();
