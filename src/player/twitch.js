'use strict';

const query = new URLSearchParams(location.search);
const hostBridge = window.floatingHost || { emit() {}, onCommand() {} };
const video = /^\d{5,12}$/.test(query.get('video') || '') ? query.get('video') : '';
const channel = /^[A-Za-z0-9_]{2,25}$/.test(query.get('channel') || '') ? query.get('channel').toLowerCase() : '';
const start = Math.max(0, Number.parseInt(query.get('start') || '0', 10) || 0);
const status = { ready: false, error: null, state: -1, video, channel, ended: false };
let player = null;

function emitStatus() {
  hostBridge.emit('twitch-status', { ...status });
}

function timestamp(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 3600)}h${Math.floor((value % 3600) / 60)}m${value % 60}s`;
}

function boot() {
  if (!window.Twitch?.Player || (!video && !channel)) {
    status.error = window.Twitch?.Player ? 'missing' : 'script';
    emitStatus();
    return;
  }
  const options = {
    width: '100%',
    height: '100%',
    parent: [location.hostname],
    autoplay: true,
    muted: false,
  };
  if (video) options.video = `v${video}`;
  else options.channel = channel;
  if (video && start) options.time = timestamp(start);
  player = new Twitch.Player('player', options);
  const state = (value, extra = {}) => () => { Object.assign(status, { state: value, ...extra }); emitStatus(); };
  player.addEventListener(Twitch.Player.READY, () => {
    status.ready = true;
    emitStatus();
  });
  player.addEventListener(Twitch.Player.PLAYING, state(1, { ended: false, error: null }));
  player.addEventListener(Twitch.Player.PAUSE, state(2));
  player.addEventListener(Twitch.Player.ENDED, state(0, { ended: true }));
  player.addEventListener(Twitch.Player.OFFLINE, state(-1, { error: 'offline' }));
  player.addEventListener(Twitch.Player.ONLINE, state(status.state, { error: null }));
}

function qualities() {
  try {
    return (player.getQualities?.() || []).filter((quality) => quality?.group && quality?.name);
  } catch {
    return [];
  }
}

function volumePercent() {
  return Math.round((Number(player.getVolume?.()) || 0) * 100);
}

hostBridge.onCommand((command) => {
  if (!player || !command) return;
  const value = command.value;
  if (command.name === 'toggle') player.isPaused?.() ? player.play() : player.pause();
  else if (command.name === 'mute-toggle') player.setMuted?.(!player.getMuted?.());
  else if (command.name === 'muted') player.setMuted?.(Boolean(value));
  else if (command.name === 'volume') {
    player.setVolume?.(Math.max(0, Math.min(100, Number(value) || 0)) / 100);
    if (Number(value) > 0) player.setMuted?.(false);
  } else if (command.name === 'volume-step') {
    const volume = Math.max(0, Math.min(100, volumePercent() + (Number(value) || 0)));
    player.setVolume?.(volume / 100);
    if (volume > 0) player.setMuted?.(false);
    hostBridge.emit('volume-change', { volume, muted: Boolean(player.getMuted?.()) || volume === 0 });
  } else if (command.name === 'seek') {
    // Live channels have no seekable timeline in the embed.
    if (!video) return;
    const delta = Number(value) || 0;
    const duration = Number(player.getDuration?.()) || 0;
    const target = Math.max(0, (Number(player.getCurrentTime?.()) || 0) + delta);
    const time = duration > 0 ? Math.min(target, Math.max(0, duration - 0.5)) : target;
    player.seek?.(time);
    hostBridge.emit('seek-change', { delta, time, duration });
  } else if (command.name === 'quality') {
    const selected = qualities().find((quality) => quality.name === value || (value === 'auto' && quality.group === 'auto'));
    if (selected) player.setQuality?.(selected.group);
  } else if (command.name === 'info') {
    const levels = qualities();
    const active = player.getQuality?.();
    hostBridge.emit('player-info', {
      requestId: command.requestId,
      info: {
        quality: levels.find((quality) => quality.group === active)?.name || null,
        qualities: levels.map((quality) => quality.name),
        rate: 1,
        rates: [],
        volume: volumePercent(),
        muted: Boolean(player.getMuted?.()),
        currentTime: Number(player.getCurrentTime?.()) || 0,
        tracks: [],
        track: null,
      },
    });
  }
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();

setTimeout(() => {
  if (!status.ready && status.error == null) {
    status.error = 'timeout';
    emitStatus();
  }
}, 12000);
