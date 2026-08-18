'use strict';

const video = document.getElementById('video');
const audio = document.getElementById('audio');
const slider = document.getElementById('position');
const time = document.getElementById('time');
let splitTracks = false;
let seeking = false;
let controlsTimer = null;

function sync(force = false) {
  if (!splitTracks) return;
  const drift = audio.currentTime - video.currentTime;
  if (force || Math.abs(drift) > 0.22) audio.currentTime = video.currentTime;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const tail = `${minutes}:${String(whole % 60).padStart(2, '0')}`;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}` : tail;
}

function paintTimeline() {
  if (!seeking && Number.isFinite(video.duration) && video.duration > 0) slider.value = String(Math.round(video.currentTime / video.duration * 1000));
  slider.style.setProperty('--progress', `${Number(slider.value) / 10}%`);
  time.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
}

function revealControls() {
  document.body.classList.add('controls');
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => document.body.classList.remove('controls'), 2200);
}

function startAudio() {
  if (!splitTracks) return;
  sync(true);
  audio.play().catch(() => {});
}

video.addEventListener('play', startAudio);
video.addEventListener('pause', () => splitTracks && audio.pause());
video.addEventListener('waiting', () => splitTracks && audio.pause());
video.addEventListener('playing', startAudio);
video.addEventListener('seeked', () => sync(true));
video.addEventListener('timeupdate', () => {
  if (splitTracks && !video.paused && audio.paused) audio.play().catch(() => {});
  sync();
  paintTimeline();
});
video.addEventListener('loadedmetadata', () => {
  paintTimeline();
  revealControls();
  window.floatingHost.emit('stream-state', { ready: true, duration: video.duration });
});
video.addEventListener('ended', () => window.floatingHost.emit('stream-state', { ended: true }));
video.addEventListener('error', () => window.floatingHost.emit('stream-state', { error: video.error?.message || 'Bildfehler' }));
audio.addEventListener('error', () => window.floatingHost.emit('stream-state', { error: audio.error?.message || 'Tonfehler' }));
document.addEventListener('pointermove', revealControls, true);

slider.addEventListener('pointerdown', () => { seeking = true; });
slider.addEventListener('input', () => {
  slider.style.setProperty('--progress', `${Number(slider.value) / 10}%`);
  if (Number.isFinite(video.duration)) time.textContent = `${formatTime(Number(slider.value) / 1000 * video.duration)} / ${formatTime(video.duration)}`;
});
function commitSeek() {
  if (!seeking) return;
  seeking = false;
  if (Number.isFinite(video.duration)) video.currentTime = Number(slider.value) / 1000 * video.duration;
}
slider.addEventListener('change', commitSeek);
slider.addEventListener('pointerup', commitSeek);

window.floatingHost.onCommand((command) => {
  if (!command) return;
  if (command.name === 'load-stream') {
    const source = command.value || {};
    splitTracks = Boolean(source.audio);
    video.src = source.video;
    if (splitTracks) {
      audio.src = source.audio;
      audio.load();
    } else audio.removeAttribute('src');
    video.load();
    const play = () => {
      video.play().catch(() => {});
      if (splitTracks) audio.play().catch(() => {});
    };
    video.readyState >= 1 ? play() : video.addEventListener('loadedmetadata', play, { once: true });
  } else if (command.name === 'toggle') video.paused ? video.play().catch(() => {}) : video.pause();
  else if (command.name === 'mute-toggle') (splitTracks ? audio : video).muted = !(splitTracks ? audio : video).muted;
  else if (command.name === 'muted') (splitTracks ? audio : video).muted = Boolean(command.value);
  else if (command.name === 'volume') {
    const volume = Math.max(0, Math.min(1, Number(command.value) / 100));
    video.volume = volume;
    audio.volume = volume;
  } else if (command.name === 'info') {
    const sound = splitTracks ? audio : video;
    window.floatingHost.emit('player-info', {
      requestId: command.requestId,
      info: { volume: Math.round(sound.volume * 100), muted: sound.muted, quality: null, qualities: [], rate: null, rates: [], tracks: [], track: null },
    });
  }
});

window.floatingHost.emit('guest-ready', { page: 'stream' });

