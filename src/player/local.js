'use strict';

const query = new URLSearchParams(location.search);
const mediaId = query.get('media') || '';
const title = (query.get('name') || 'Lokales Video').slice(0, 260);
const video = document.getElementById('video');
const play = document.getElementById('play');
const timeline = document.getElementById('timeline');
const time = document.getElementById('time');
const error = document.getElementById('error');
let seeking = false;
let controlsTimer = null;
let soundBoost = 1;
let audioGraph = null;

function formatTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function emitStatus(extra = {}) {
  window.floatingHost.emit('local-status', {
    mediaId,
    title,
    state: video.ended ? 0 : video.paused ? 2 : 1,
    ended: video.ended,
    ...extra,
  });
}

function updateTimeline() {
  const duration = Number(video.duration);
  const validDuration = Number.isFinite(duration) && duration > 0;
  const played = validDuration ? Math.max(0, Math.min(1, video.currentTime / duration)) : 0;
  let loaded = 0;
  if (validDuration && video.buffered.length) loaded = Math.max(played, Math.min(1, video.buffered.end(video.buffered.length - 1) / duration));
  if (!seeking) timeline.value = String(Math.round(played * 1000));
  timeline.style.setProperty('--played', `${played * 100}%`);
  timeline.style.setProperty('--loaded', `${loaded * 100}%`);
  time.textContent = `${formatTime(video.currentTime)} / ${validDuration ? formatTime(duration) : '–:––'}`;
}

function revealControls() {
  document.body.classList.remove('controls-hidden');
  clearTimeout(controlsTimer);
  if (!video.paused && !video.ended) controlsTimer = setTimeout(() => document.body.classList.add('controls-hidden'), 900);
}

function paintState() {
  document.body.classList.toggle('playing', !video.paused && !video.ended);
  play.setAttribute('aria-label', video.paused || video.ended ? 'Video abspielen' : 'Wiedergabe pausieren');
  revealControls();
  updateTimeline();
}

function togglePlayback() {
  if (video.paused || video.ended) void video.play();
  else video.pause();
}

async function applySoundBoost(value) {
  soundBoost = [1, 1.5, 2, 3].includes(Number(value)) ? Number(value) : 1;
  document.documentElement.dataset.soundBoost = String(soundBoost);
  if (soundBoost === 1 && !audioGraph) {
    window.floatingHost.emit('boost-status', { supported: true, gain: 1 });
    return;
  }
  try {
    if (!audioGraph) {
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
      audioGraph = { context, gain };
    }
    audioGraph.gain.gain.setTargetAtTime(soundBoost, audioGraph.context.currentTime, .015);
    await audioGraph.context.resume();
    window.floatingHost.emit('boost-status', { supported: true, gain: soundBoost });
  } catch {
    soundBoost = 1;
    document.documentElement.dataset.soundBoost = '1';
    window.floatingHost.emit('boost-status', { supported: false, gain: 1 });
  }
}

play.addEventListener('click', togglePlayback);
timeline.addEventListener('pointerdown', () => { seeking = true; });
timeline.addEventListener('input', () => {
  const duration = Number(video.duration);
  if (!Number.isFinite(duration) || duration <= 0) return;
  video.currentTime = duration * Number(timeline.value) / 1000;
  updateTimeline();
});
for (const name of ['change', 'pointerup', 'pointercancel']) timeline.addEventListener(name, () => { seeking = false; updateTimeline(); });

for (const name of ['play', 'playing', 'pause', 'ended']) video.addEventListener(name, () => { paintState(); emitStatus(); });
for (const name of ['loadedmetadata', 'durationchange', 'timeupdate', 'progress', 'seeked']) video.addEventListener(name, updateTimeline);
video.addEventListener('loadedmetadata', () => emitStatus({ ready: true }));
video.addEventListener('error', () => {
  const code = video.error?.code || 0;
  error.hidden = false;
  error.textContent = code === 4 ? 'Dieses Videoformat oder der verwendete Codec wird nicht unterstützt.' : 'Das lokale Video konnte nicht abgespielt werden.';
  emitStatus({ error: code || 'media' });
});
for (const name of ['pointermove', 'pointerdown', 'touchstart', 'keydown']) document.addEventListener(name, revealControls, { capture: true, passive: true });

window.floatingHost.onCommand((command) => {
  if (!command) return;
  const value = command.value;
  if (command.name === 'toggle') togglePlayback();
  else if (command.name === 'mute-toggle') video.muted = !video.muted;
  else if (command.name === 'volume') {
    video.volume = Math.max(0, Math.min(1, (Number(value) || 0) / 100));
    if (Number(value) > 0) video.muted = false;
  } else if (command.name === 'volume-step') {
    const volume = Math.max(0, Math.min(100, Math.round(video.volume * 100 + (Number(value) || 0))));
    video.volume = volume / 100;
    if (volume > 0) video.muted = false;
    window.floatingHost.emit('volume-change', { volume, muted: video.muted });
  } else if (command.name === 'muted') video.muted = Boolean(value);
  else if (command.name === 'rate') video.playbackRate = Math.max(.25, Math.min(4, Number(value) || 1));
  else if (command.name === 'boost') void applySoundBoost(value);
  else if (command.name === 'info') {
    window.floatingHost.emit('player-info', {
      requestId: command.requestId,
      info: {
        quality: null,
        qualities: [],
        rate: video.playbackRate,
        rates: [.25, .5, .75, 1, 1.25, 1.5, 1.75, 2],
        volume: Math.round(video.volume * 100),
        muted: video.muted,
        tracks: [],
        track: null,
        soundBoost,
      },
    });
  }
});

if (/^[a-f0-9]{36}$/.test(mediaId)) video.src = `/media/${mediaId}`;
else {
  error.hidden = false;
  error.textContent = 'Die lokale Videodatei ist nicht mehr verfügbar.';
  emitStatus({ error: 'missing' });
}
document.title = title;
paintState();
