import assert from 'node:assert/strict';
import test from 'node:test';

import { PlaybackController } from '../src/renderer/playback-controller.mjs';

class FakePlayer {
  constructor() {
    this.src = '';
    this.listeners = new Map();
    this.commands = [];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  focus() {}
  stop() {}
  send(channel, payload) { this.commands.push({ channel, payload }); }

  emitGuest(type, payload) {
    for (const listener of this.listeners.get('ipc-message') || []) {
      listener({ channel: 'guest-event', args: [{ type, payload }] });
    }
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('opens the YouTube watch page immediately when an embed is blocked', async () => {
  const player = new FakePlayer();
  const toasts = [];
  let streamResolutions = 0;
  const controller = new PlaybackController({
    player,
    baseUrl: 'http://127.0.0.1:3210',
    api: {
      resolveStream() { streamResolutions += 1; },
      setVideoAspect() {}, dragStart() {}, dragMove() {}, dragEnd() {},
      toggleFullscreen() {}, leaveFullscreen() {},
    },
    hooks: {
      toast: (message) => toasts.push(message),
      setEmpty() {}, setPlaylist() {}, setTitle() {}, openMenu() {},
    },
  });

  controller.load('AAAAAAAAAAA');
  player.emitGuest('embed-status', { videoId: 'AAAAAAAAAAA', error: 150, state: -1 });
  await settle();

  assert.equal(player.src, 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
  assert.equal(controller.current.mode, 'watch');
  assert.equal(streamResolutions, 0);
  assert.deepEqual(toasts, ['Embed gesperrt (150) – YouTube-Seite']);
});

test('returns from a personal-playlist watch fallback to the managed queue', async () => {
  const player = new FakePlayer();
  const toasts = [];
  const controller = new PlaybackController({
    player,
    baseUrl: 'http://127.0.0.1:3210',
    api: {
      setVideoAspect() {}, dragStart() {}, dragMove() {}, dragEnd() {},
      toggleFullscreen() {}, leaveFullscreen() {},
    },
    hooks: {
      toast: (message) => toasts.push(message),
      setEmpty() {}, setPlaylist() {}, setTitle() {}, openMenu() {},
    },
  });

  controller.load('https://www.youtube.com/watch?v=AAAAAAAAAAA&list=RDMMabc&index=4', {
    queue: ['AAAAAAAAAAA', 'BBBBBBBBBBB', 'CCCCCCCCCCC'],
  });
  player.emitGuest('embed-status', { videoId: 'AAAAAAAAAAA', index: -1, error: 101, state: -1 });
  await settle();
  assert.match(player.src, /^https:\/\/www\.youtube\.com\/watch\?/);
  assert.match(player.src, /list=RDMMabc/);
  assert.match(player.src, /index=4/);

  player.emitGuest('watch-status', { videoId: 'YouTubeNext', index: 5, state: 1 });
  await settle();
  assert.equal(player.src, 'http://127.0.0.1:3210/embed.html?v=BBBBBBBBBBB');
  assert.equal(controller.current.mode, 'embed');
  assert.equal(controller.current.index, 2);
  assert.equal(toasts.includes('Ursprüngliche Liste ist zu Ende'), false);
});

test('steps the real player volume and reports the resulting value', async () => {
  const player = new FakePlayer();
  const changes = [];
  const controller = new PlaybackController({
    player,
    baseUrl: 'http://127.0.0.1:3210',
    api: {},
    hooks: {
      toast() {}, setEmpty() {}, setPlaylist() {}, setTitle() {}, openMenu() {},
      setVolume: (volume, muted) => changes.push({ volume, muted }),
    },
  });

  controller.load('AAAAAAAAAAA');
  controller.adjustVolume(-5);
  assert.deepEqual(player.commands.at(-1), {
    channel: 'guest-command',
    payload: { name: 'volume-step', value: -5 },
  });

  player.emitGuest('volume-change', { volume: 65, muted: false });
  await settle();
  assert.deepEqual(changes, [{ volume: 65, muted: false }]);
});

test('applies the saved caption preference to embed and fallback playback', async () => {
  const player = new FakePlayer();
  const controller = new PlaybackController({
    player,
    baseUrl: 'http://127.0.0.1:3210',
    api: {},
    caption: 'de',
    hooks: { toast() {}, setEmpty() {}, setPlaylist() {}, setTitle() {}, openMenu() {} },
  });

  controller.load('AAAAAAAAAAA');
  player.emitGuest('embed-status', { videoId: 'AAAAAAAAAAA', ready: true, state: 1 });
  await settle();
  assert.ok(player.commands.some(({ payload }) => payload.name === 'caption' && payload.value === 'de'));

  controller.setPlayerOption('caption', null);
  assert.deepEqual(player.commands.at(-1), {
    channel: 'guest-command',
    payload: { name: 'caption', value: null },
  });
});

test('plays a dropped local queue and advances when a file ends', async () => {
  const player = new FakePlayer();
  const titles = [];
  const playlistStates = [];
  const queues = [];
  const controller = new PlaybackController({
    player,
    baseUrl: 'http://127.0.0.1:3210',
    api: {},
    hooks: {
      toast() {}, setEmpty() {}, openMenu() {},
      setTitle: (title) => titles.push(title),
      setPlaylist: (visible) => playlistStates.push(visible),
      setQueue: (queue) => queues.push(queue),
    },
  });
  const queue = [
    { id: 'a'.repeat(36), name: 'Clip 1.mp4' },
    { id: 'b'.repeat(36), name: 'Clip 2.webm' },
  ];

  assert.equal(controller.loadLocal(queue), true);
  assert.match(player.src, /^http:\/\/127\.0\.0\.1:3210\/local\.html\?/);
  assert.match(player.src, /media=a{36}/);
  assert.equal(controller.current.mode, 'local');
  assert.deepEqual(playlistStates, [true]);
  assert.deepEqual(queues.at(-1), { mode: 'local', items: queue, index: 0 });

  player.emitGuest('local-status', { mediaId: 'a'.repeat(36), title: 'Clip 1.mp4', ended: true });
  await settle();
  assert.match(player.src, /media=b{36}/);
  assert.equal(controller.current.index, 1);
  assert.equal(titles.at(-1), 'Clip 2.webm');

  assert.equal(await controller.neighbour(false), true);
  assert.equal(controller.current.index, 0);
});

test('publishes a selectable YouTube playlist and enriches its titles', async () => {
  const player = new FakePlayer();
  const queues = [];
  const controller = new PlaybackController({
    player,
    baseUrl: 'http://127.0.0.1:3210',
    api: {
      resolveVideoMetadata: async (ids) => ({
        items: ids.map((id, index) => ({ id, title: `Titel ${index + 1}` })),
      }),
    },
    hooks: {
      toast() {}, setEmpty() {}, setPlaylist() {}, setTitle() {}, openMenu() {},
      setQueue: (queue) => queues.push(queue),
    },
  });

  controller.load('https://www.youtube.com/watch?v=AAAAAAAAAAA&list=PLexample');
  player.emitGuest('embed-status', {
    videoId: 'AAAAAAAAAAA',
    title: 'Aktueller Titel',
    index: 0,
    playlist: ['AAAAAAAAAAA', 'BBBBBBBBBBB'],
    state: 1,
  });
  await settle();
  await settle();

  assert.equal(queues.at(-1).mode, 'youtube');
  assert.equal(queues.at(-1).index, 0);
  assert.deepEqual(queues.at(-1).items.map((item) => item.name), ['Titel 1', 'Titel 2']);
  assert.equal(controller.selectQueue(1), true);
  assert.match(player.src, /embed\.html\?v=BBBBBBBBBBB&list=PLexample/);
  assert.equal(queues.at(-1).index, 1);
});

test('reloads manual quality inside the embed at the current position', async () => {
  const player = new FakePlayer();
  const toasts = [];
  const controller = new PlaybackController({
    player,
    baseUrl: 'http://127.0.0.1:3210',
    api: {},
    hooks: {
      toast: (message) => toasts.push(message),
      setEmpty() {}, setPlaylist() {}, setTitle() {}, openMenu() {},
    },
  });

  controller.load('AAAAAAAAAAA');
  controller.setPlayerOption('quality', 'hd1440');
  const infoCommand = player.commands.find(({ payload }) => payload.name === 'info');
  player.emitGuest('player-info', { requestId: infoCommand.payload.requestId, info: { currentTime: 37.8 } });
  await settle();

  assert.equal(controller.current.mode, 'embed');
  assert.equal(player.src, 'http://127.0.0.1:3210/embed.html?v=AAAAAAAAAAA&start=37&quality=hd1440');
  assert.equal(toasts.at(-1), 'Auflösung wird im Embed neu geladen …');

  player.emitGuest('embed-status', { videoId: 'AAAAAAAAAAA', error: 'timeout', state: -1 });
  await settle();
  assert.equal(controller.current.mode, 'embed');
  assert.equal(controller.current.quality, null);
  assert.equal(player.src, 'http://127.0.0.1:3210/embed.html?v=AAAAAAAAAAA&start=37');
  assert.equal(toasts.at(-1), 'Gewählte Auflösung nicht verfügbar – zurück zu Auto');
});

test('applies and updates the persisted sound boost without changing player volume', async () => {
  const player = new FakePlayer();
  const toasts = [];
  const controller = new PlaybackController({
    player,
    baseUrl: 'http://127.0.0.1:3210',
    api: {},
    soundBoost: 2,
    hooks: {
      toast: (message) => toasts.push(message),
      setEmpty() {}, setPlaylist() {}, setTitle() {}, openMenu() {},
    },
  });

  controller.load('AAAAAAAAAAA');
  player.emitGuest('embed-status', { videoId: 'AAAAAAAAAAA', ready: true, state: 1 });
  await settle();
  assert.ok(player.commands.some(({ payload }) => payload.name === 'boost' && payload.value === 2));

  controller.setPlayerOption('boost', 3);
  assert.deepEqual(player.commands.at(-1), {
    channel: 'guest-command',
    payload: { name: 'boost', value: 3 },
  });
  player.emitGuest('boost-status', { supported: false, gain: 1 });
  await settle();
  assert.deepEqual(toasts, ['Soundboost ist für diese Medienquelle nicht verfügbar']);
});

test('keeps the full resolution list after pinning one inside the embed', async () => {
  const player = new FakePlayer();
  const controller = new PlaybackController({
    player,
    baseUrl: 'http://127.0.0.1:3210',
    api: {},
    hooks: { toast() {}, setEmpty() {}, setPlaylist() {}, setTitle() {}, openMenu() {} },
  });
  const ask = (qualities, quality) => {
    const pending = controller.requestInfo();
    const command = player.commands.filter(({ payload }) => payload.name === 'info').at(-1);
    player.emitGuest('player-info', { requestId: command.payload.requestId, info: { qualities, quality } });
    return pending;
  };

  controller.load('AAAAAAAAAAA');
  const offered = ['hd2160', 'hd1080', 'hd720', 'large', 'auto'];
  assert.deepEqual((await ask(offered, 'hd720')).qualities, offered);

  // Pinning a resolution constrains the stream, so the player reports only the
  // pinned level. The menu must still offer every resolution of this video.
  const pinned = await ask(['hd1080', 'auto'], 'hd1080');
  assert.deepEqual(pinned.qualities, offered);
  assert.equal(pinned.quality, 'hd1080');

  controller.load('BBBBBBBBBBB');
  assert.deepEqual((await ask(['hd720', 'auto'], 'hd720')).qualities, ['hd720', 'auto']);
});
