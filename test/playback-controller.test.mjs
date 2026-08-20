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
