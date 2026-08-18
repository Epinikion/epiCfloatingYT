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
