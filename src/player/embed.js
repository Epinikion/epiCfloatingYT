'use strict';

const query = new URLSearchParams(location.search);
const initial = {
  videoId: query.get('v') || '',
  list: query.get('list') || '',
  start: Number.parseInt(query.get('start') || '0', 10) || 0,
};
const status = { ready: false, error: null, state: -1, videoId: initial.videoId, index: -1, playlist: null, title: '' };
let player = null;

function emitStatus() {
  window.floatingHost.emit('embed-status', { ...status });
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

function fit() {
  player?.setSize?.(window.innerWidth, window.innerHeight);
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
        synchronize();
        event.target.playVideo();
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
    tracks: tracks.map((track) => ({ code: track.languageCode, name: track.languageName?.name || track.displayName || track.languageCode })),
    track: active?.languageCode || null,
  };
}

window.floatingHost.onCommand((command) => {
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
    window.floatingHost.emit('volume-change', { volume, muted: player.isMuted?.() ?? volume === 0 });
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
  } else if (command.name === 'info') {
    window.floatingHost.emit('player-info', { requestId: command.requestId, info: playerInfo() });
  }
});

// Relay the narrow visual-state message to the cross-origin player. The
// content extension applies it there without exposing Electron or Node APIs.
window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'floatingyt-host' || event.data.type !== 'visual') return;
  document.querySelector('iframe')?.contentWindow?.postMessage(event.data, 'https://www.youtube-nocookie.com');
});

setTimeout(() => {
  if (!status.ready && status.error == null) {
    status.error = 'timeout';
    emitStatus();
  }
}, 9000);
