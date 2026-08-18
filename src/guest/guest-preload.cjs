'use strict';

const { contextBridge, ipcRenderer, webFrame } = require('electron');

const isTop = window.top === window;
const isLocal = location.hostname === '127.0.0.1';
const isYouTube = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i.test(location.hostname);
const send = (type, payload = {}) => ipcRenderer.sendToHost('guest-event', { type, payload });
const EXTENSION_SOURCE = 'floatingyt-extension';
const HOST_SOURCE = 'floatingyt-host';
const FORWARDED_EVENTS = new Set([
  'video-metadata', 'drag-start', 'drag-move', 'drag-end',
  'fullscreen-toggle', 'fullscreen-leave', 'watch-status',
]);
const ASPECT_EPSILON = 0.0005;
const NEAR_FIT_MAX_GAP = 3;

if (isLocal && isTop) {
  contextBridge.exposeInMainWorld('floatingHost', {
    emit: (type, payload) => {
      if (typeof type === 'string' && type.length < 64) send(type, payload);
    },
    onCommand: (callback) => {
      if (typeof callback === 'function') ipcRenderer.on('guest-command', (_event, command) => callback(command));
    },
  });
}

function validExtensionOrigin(origin) {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return ['youtube.com', 'youtube-nocookie.com'].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.source !== EXTENSION_SOURCE || !FORWARDED_EVENTS.has(message.type) || !validExtensionOrigin(event.origin)) return;
  send(message.type, message.payload || {});
});

function ensureLocalFilters() {
  if (!isLocal || document.getElementById('__floating-sharpen-filters')) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = '__floating-sharpen-filters';
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<defs>
    <filter id="__floating-sharpen-windowed" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
      <feConvolveMatrix order="3" preserveAlpha="true" edgeMode="duplicate" kernelMatrix="0 -.42 0 -.42 2.68 -.42 0 -.42 0" />
    </filter>
    <filter id="__floating-sharpen-fullscreen" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
      <feConvolveMatrix order="3" preserveAlpha="true" edgeMode="duplicate" kernelMatrix="0 -.6 0 -.6 3.4 -.6 0 -.6 0" />
    </filter>
  </defs>`;
  document.documentElement.appendChild(svg);
}

function applyVisualState(state) {
  if (isLocal) {
    ensureLocalFilters();
    document.documentElement.classList.toggle('__floating-sharpen', Boolean(state?.sharpen));
    document.documentElement.classList.toggle('__floating-fullscreen', Boolean(state?.fullscreen));
  }
  window.postMessage({ source: HOST_SOURCE, type: 'visual', payload: state || {} }, '*');
}

ipcRenderer.on('guest-visual', (_event, state) => applyVisualState(state));

function isControlEvent(event) {
  return event.composedPath().some((node) => node instanceof Element && node.matches([
    'button', 'a', 'input', 'select', '[role="button"]', '[role="slider"]', '[contenteditable="true"]', '#timeline',
  ].join(',')));
}

function installLocalGestures() {
  let drag = null;
  let moved = false;
  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || isControlEvent(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    drag = { pointerId: event.pointerId, x: event.screenX, y: event.screenY };
    moved = false;
    event.target.setPointerCapture?.(event.pointerId);
    send('drag-start', { x: event.screenX, y: event.screenY });
  }, true);
  document.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    moved ||= Math.hypot(event.screenX - drag.x, event.screenY - drag.y) > 3;
    event.preventDefault();
    event.stopImmediatePropagation();
    send('drag-move', { x: event.screenX, y: event.screenY });
  }, true);
  const finish = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    drag = null;
    send('drag-end');
  };
  document.addEventListener('pointerup', finish, true);
  document.addEventListener('pointercancel', finish, true);
  document.addEventListener('click', (event) => {
    if (!moved || isControlEvent(event)) return;
    moved = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener('dblclick', (event) => {
    if (isControlEvent(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    send('fullscreen-toggle');
  }, true);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') send('fullscreen-leave'); }, true);
}

function installLocalVideoReporter() {
  let last = 0;
  let candidate = 0;
  let hits = 0;
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
    if (hits >= 2 && (!last || Math.abs(Math.log(ratio / last)) > ASPECT_EPSILON)) {
      last = ratio;
      send('video-metadata', { ratio });
    }
  };
  document.addEventListener('loadedmetadata', report, true);
  setInterval(report, 500);
}

function playerCommandSource(command) {
  const player = `document.querySelector('.html5-video-player')`;
  const video = `document.querySelector('video')`;
  const value = command?.value;
  switch (command?.name) {
    case 'toggle': return `(() => {const v=${video};if(!v)return false;v.paused?v.play():v.pause();return true})()`;
    case 'mute-toggle': return `(() => {const v=${video};if(!v)return false;v.muted=!v.muted;return true})()`;
    case 'next': return `(() => {const p=${player};if(p?.nextVideo){p.nextVideo();return true}document.querySelector('.ytp-next-button')?.click();return true})()`;
    case 'previous': return `(() => {const p=${player},q=p?.getPlaylist?.(),i=p?.getPlaylistIndex?.();if(Array.isArray(q)&&i>0&&p.playVideoAt){p.playVideoAt(i-1);return true}if(p?.previousVideo){p.previousVideo();return true}document.querySelector('.ytp-prev-button,.ytp-previous-button')?.click();return true})()`;
    case 'volume': {
      const volume = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
      return `(() => {const p=${player},v=${video};if(p?.setVolume){p.setVolume(${volume});if(${volume}>0)p.unMute?.();return true}if(v){v.volume=${volume / 100};v.muted=false;return true}return false})()`;
    }
    case 'muted': return `(() => {const p=${player},v=${video};if(p){${value ? 'p.mute?.()' : 'p.unMute?.()'};return true}if(v){v.muted=${Boolean(value)};return true}return false})()`;
    case 'rate': return Number.isFinite(Number(value)) ? `(() => {const p=${player},v=${video};if(p?.setPlaybackRate){p.setPlaybackRate(${Number(value)});return true}if(v){v.playbackRate=${Number(value)};return true}return false})()` : null;
    case 'quality': {
      const allowed = ['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny', 'auto'];
      if (!allowed.includes(value)) return null;
      return `(() => {const p=${player};if(!p)return false;p.setPlaybackQualityRange?.(${JSON.stringify(value)});p.setPlaybackQuality?.(${JSON.stringify(value)});return true})()`;
    }
    case 'caption': {
      const track = value == null ? '{}' : `{languageCode:${JSON.stringify(String(value))}}`;
      return `(() => {const p=${player};if(!p)return false;try{if(!(p.getOptions?.()||[]).includes('captions'))p.loadModule?.('captions');p.setOption?.('captions','track',${track});return true}catch{return false}})()`;
    }
    case 'info': return `(() => {const p=${player},v=${video};if(!p)return v?{volume:Math.round(v.volume*100),muted:v.muted,quality:null,qualities:[],rate:v.playbackRate,rates:[.25,.5,.75,1,1.25,1.5,1.75,2],tracks:[],track:null}:null;let tracks=[],active=null;try{if(!(p.getOptions?.()||[]).includes('captions'))p.loadModule?.('captions');tracks=p.getOption?.('captions','tracklist')||[];active=p.getOption?.('captions','track')}catch{}return{quality:p.getPlaybackQuality?.(),qualities:p.getAvailableQualityLevels?.()||[],rate:p.getPlaybackRate?.()||1,rates:p.getAvailablePlaybackRates?.()||[],volume:p.getVolume?.()??100,muted:p.isMuted?.()??false,tracks:tracks.map(t=>({code:t.languageCode,name:t.languageName?.name||t.displayName||t.languageCode})),track:active?.languageCode||null}})()`;
    default: return null;
  }
}

async function handleYouTubeCommand(command) {
  const source = playerCommandSource(command);
  if (!source) return;
  let result = null;
  try { result = await webFrame.executeJavaScript(source, true); } catch {}
  if (command.name === 'info') send('player-info', { requestId: command.requestId, info: result });
}

function boot() {
  if (isLocal) {
    ensureLocalFilters();
    installLocalGestures();
    installLocalVideoReporter();
  } else if (isYouTube && isTop) {
    ipcRenderer.on('guest-command', (_event, command) => void handleYouTubeCommand(command));
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
