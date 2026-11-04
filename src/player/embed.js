'use strict';

const query = new URLSearchParams(location.search);
const hostBridge = window.floatingHost || { emit() {}, onCommand() {} };
const QUALITY_VALUES = new Set(['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny']);
const requestedQuality = query.get('quality') || '';
const initial = {
  videoId: query.get('v') || '',
  list: query.get('list') || '',
  start: Number.parseInt(query.get('start') || '0', 10) || 0,
  quality: QUALITY_VALUES.has(requestedQuality) ? requestedQuality : '',
};
const status = { ready: false, error: null, state: -1, videoId: initial.videoId, index: -1, playlist: null, title: '' };
let player = null;

function emitStatus() {
  hostBridge.emit('embed-status', { ...status });
}

function synchronize() {
  try {
    const data = player?.getVideoData?.();
    if (data?.video_id) status.videoId = data.video_id;
    if (data?.title) status.title = data.title;
    status.index = player?.getPlaylistIndex?.() ?? -1;
    const playlist = player?.getPlaylist?.();
    if (Array.isArray(playlist) && playlist.length) status.playlist = playlist;
  } catch {}
  emitStatus();
}

// The app remembers this position to resume the video later.
let lastPosition = -1;
function emitPosition() {
  try {
    const time = Number(player?.getCurrentTime?.()) || 0;
    lastPosition = Math.floor(time);
    hostBridge.emit('position', {
      videoId: player?.getVideoData?.()?.video_id || status.videoId,
      time,
      duration: Number(player?.getDuration?.()) || 0,
      ended: status.state === 0,
    });
  } catch {}
}

function fit() {
  player?.setSize?.(window.innerWidth, window.innerHeight);
}

function applyInitialQuality() {
  if (!initial.quality || !player) return;
  player.setPlaybackQualityRange?.(initial.quality);
  player.setPlaybackQuality?.(initial.quality);
}

function relayToPlayer(type, payload) {
  document.querySelector('iframe')?.contentWindow?.postMessage(
    { source: 'floatingyt-host', type, payload },
    'https://www.youtube-nocookie.com',
  );
}

window.onYouTubeIframeAPIReady = () => {
  const playerVars = {
    autoplay: 1,
    rel: 0,
    playsinline: 1,
    iv_load_policy: 3,
    fs: 0,
    enablejsapi: 1,
    origin: location.origin,
  };
  if (initial.start) playerVars.start = initial.start;
  if (initial.quality) playerVars.vq = initial.quality;
  if (initial.list) playerVars.list = initial.list;
  if (initial.list && !initial.videoId) playerVars.listType = 'playlist';

  player = new YT.Player('player', {
    host: 'https://www.youtube-nocookie.com',
    videoId: initial.videoId || undefined,
    playerVars,
    events: {
      onReady(event) {
        status.ready = true;
        fit();
        applyInitialQuality();
        synchronize();
        event.target.playVideo();
        setTimeout(applyInitialQuality, 0);
      },
      onError(event) {
        synchronize();
        status.error = event.data;
        emitStatus();
      },
      onStateChange(event) {
        status.state = event.data;
        if ([YT.PlayerState.PLAYING, YT.PlayerState.BUFFERING].includes(event.data)) status.error = null;
        synchronize();
        if ([YT.PlayerState.PAUSED, YT.PlayerState.ENDED].includes(event.data)) emitPosition();
      },
    },
  });
};

const apiScript = document.createElement('script');
apiScript.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(apiScript);

window.addEventListener('resize', () => {
  fit();
  requestAnimationFrame(fit);
});

function playerInfo() {
  if (!player?.getAvailableQualityLevels) return null;
  let tracks = [];
  let active = null;
  try {
    if (!(player.getOptions?.() || []).includes('captions')) player.loadModule?.('captions');
    tracks = player.getOption?.('captions', 'tracklist') || [];
    active = player.getOption?.('captions', 'track');
    if (!tracks.length && active?.languageCode) tracks = [active];
  } catch {}
  return {
    quality: player.getPlaybackQuality?.(),
    qualities: player.getAvailableQualityLevels?.() || [],
    rate: player.getPlaybackRate?.() || 1,
    rates: player.getAvailablePlaybackRates?.() || [],
    volume: player.getVolume?.() ?? 100,
    muted: player.isMuted?.() ?? false,
    currentTime: player.getCurrentTime?.() ?? 0,
    duration: player.getDuration?.() ?? 0,
    live: Boolean(player.getVideoData?.()?.isLive),
    tracks: tracks.map((track) => ({ code: track.languageCode, name: track.languageName?.name || track.displayName || track.languageCode })),
    track: active?.languageCode || null,
  };
}

hostBridge.onCommand((command) => {
  if (!player || !command) return;
  const value = command.value;
  if (command.name === 'toggle') {
    const state = player.getPlayerState?.();
    [YT.PlayerState.PLAYING, YT.PlayerState.BUFFERING].includes(state) ? player.pauseVideo() : player.playVideo();
  } else if (command.name === 'mute-toggle') {
    player.isMuted?.() ? player.unMute?.() : player.mute?.();
  } else if (command.name === 'next') player.nextVideo?.();
  else if (command.name === 'previous') {
    const index = player.getPlaylistIndex?.();
    if (Number.isInteger(index) && index > 0) player.playVideoAt?.(index - 1);
    else player.previousVideo?.();
  } else if (command.name === 'volume') {
    player.setVolume?.(Math.max(0, Math.min(100, Number(value) || 0)));
    if (Number(value) > 0) player.unMute?.();
  } else if (command.name === 'volume-step') {
    const volume = Math.max(0, Math.min(100, Math.round((player.getVolume?.() ?? 100) + (Number(value) || 0))));
    player.setVolume?.(volume);
    if (volume > 0) player.unMute?.();
    hostBridge.emit('volume-change', { volume, muted: player.isMuted?.() ?? volume === 0 });
  } else if (command.name === 'seek') {
    const delta = Number(value) || 0;
    const duration = Number(player.getDuration?.()) || 0;
    const target = Math.max(0, (Number(player.getCurrentTime?.()) || 0) + delta);
    const time = duration > 0 ? Math.min(target, Math.max(0, duration - 0.5)) : target;
    player.seekTo?.(time, true);
    hostBridge.emit('seek-change', { delta, time, duration });
  } else if (command.name === 'resume') {
    // Only resume while the video is still near its start, never into the last seconds.
    const time = Math.floor(Number(value) || 0);
    const duration = Number(player.getDuration?.()) || 0;
    if (time < 10 || !(duration > 0) || time > duration - 20 || (Number(player.getCurrentTime?.()) || 0) > 30) return;
    player.seekTo?.(time, true);
    hostBridge.emit('resume-change', { time, duration });
  } else if (command.name === 'muted') value ? player.mute?.() : player.unMute?.();
  else if (command.name === 'rate') player.setPlaybackRate?.(Number(value));
  else if (command.name === 'quality') {
    player.setPlaybackQualityRange?.(String(value));
    player.setPlaybackQuality?.(String(value));
  } else if (command.name === 'caption') {
    try {
      if (!(player.getOptions?.() || []).includes('captions')) player.loadModule?.('captions');
      player.setOption?.('captions', 'track', value == null ? {} : { languageCode: String(value) });
    } catch {}
  } else if (command.name === 'boost') {
    relayToPlayer('boost', { gain: Number(value) });
  } else if (command.name === 'info') {
    hostBridge.emit('player-info', { requestId: command.requestId, info: playerInfo() });
  }
});

// Relay the narrow visual-state message to the cross-origin player. The
// content extension applies it there without exposing Electron or Node APIs.
window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'floatingyt-host' || event.data.type !== 'visual') return;
  relayToPlayer('visual', event.data.payload || {});
});

// Also report a position that changed while paused, for example after seeking.
setInterval(() => {
  if (status.state === 1 || (status.ready && Math.floor(Number(player?.getCurrentTime?.()) || 0) !== lastPosition)) emitPosition();
}, 5000);

setTimeout(() => {
  if (!status.ready && status.error == null) {
    status.error = 'timeout';
    emitStatus();
  }
}, 9000);
