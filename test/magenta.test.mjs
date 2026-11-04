import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { MAGENTA_HOME, MAGENTA_TV_PAGE, isMagentaHost, parseMagentaInput } from '../src/shared/magenta-url.mjs';
import { isSupportedVideoLink } from '../src/shared/twitch-url.mjs';
import { PlaybackController } from '../src/renderer/playback-controller.mjs';

const require = createRequire(import.meta.url);
const { WindowController, isAllowedGuestUrl } = require('../src/main/window-controller.cjs');

test('recognizes MagentaTV links and the name, but no lookalike hosts', () => {
  const live = 'https://www.magenta.tv/streamen-tv/das-erste/259549736360';
  assert.deepEqual(parseMagentaInput(live), { platform: 'magenta', url: live });
  assert.deepEqual(parseMagentaInput('magenta.tv/tv/bares-fuer-rares/032f3c25'), { platform: 'magenta', url: 'https://magenta.tv/tv/bares-fuer-rares/032f3c25' });
  assert.deepEqual(parseMagentaInput('https://web.magentatv.de/'), { platform: 'magenta', url: MAGENTA_TV_PAGE });
  assert.deepEqual(parseMagentaInput('MagentaTV'), { platform: 'magenta', url: MAGENTA_TV_PAGE });
  for (const input of ['https://magenta.tv.evil.test/', 'https://example.com/magenta.tv', 'magenta', '', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ']) {
    assert.equal(parseMagentaInput(input), null, input);
  }
  assert.equal(isSupportedVideoLink(live), true);
  assert.equal(isMagentaHost('accounts.login.idm.telekom.com'), true);
  assert.equal(isMagentaHost('telekom.de.evil.test'), false);
});

test('lets the player reach MagentaTV and the Telekom sign-in only', () => {
  const origin = 'http://127.0.0.1:4321';
  assert.equal(isAllowedGuestUrl('https://www.magenta.tv/streamen-tv/das-erste/259549736360', origin), true);
  assert.equal(isAllowedGuestUrl('https://accounts.login.idm.telekom.com/oauth2/auth', origin), true);
  assert.equal(isAllowedGuestUrl('https://www.ardmediathek.de/video/x', origin), false);
  assert.equal(isAllowedGuestUrl('https://magenta.tv.evil.test/', origin), false);
});

test('opens MagentaTV as a page and refuses it without Widevine', () => {
  const player = { src: '', commands: [], addEventListener() {}, focus() {}, send(channel, payload) { this.commands.push(payload); } };
  const toasts = [];
  const titles = [];
  const controller = new PlaybackController({
    player,
    baseUrl: 'http://127.0.0.1:3210',
    api: {},
    hooks: { toast: (message) => toasts.push(message), setEmpty() {}, setPlaylist() {}, setQueue() {}, setTitle: (title) => titles.push(title), openMenu() {} },
  });

  assert.equal(controller.load('https://www.magenta.tv/streamen-tv/das-erste/259549736360'), true);
  assert.equal(controller.current.mode, 'magenta');
  assert.equal(player.src, 'https://www.magenta.tv/streamen-tv/das-erste/259549736360');
  assert.deepEqual(titles, ['MagentaTV']);
  controller.togglePlay();
  assert.deepEqual(player.commands.at(-1), { name: 'toggle', value: undefined });

  controller.widevine = 'missing';
  assert.equal(controller.load(MAGENTA_HOME), false);
  assert.equal(toasts.at(-1), 'MagentaTV braucht Widevine, das hier fehlt');
});

test('zaps channels and goes back inside MagentaTV', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const inputs = [];
  const loaded = [];
  let wentBack = 0;
  let canGoBack = true;
  let url = 'https://www.magenta.tv/streamen-tv/vox/vox';
  const player = {
    src: '', addEventListener() {}, focus() {}, send() {},
    sendInputEvent: (event) => inputs.push(event),
    canGoBack: () => canGoBack,
    goBack: () => { wentBack += 1; },
    getURL: () => url,
    loadURL: (next) => { loaded.push(next); url = next; },
  };
  const toasts = [];
  const controller = new PlaybackController({
    player,
    baseUrl: 'http://127.0.0.1:3210',
    api: {},
    hooks: { toast: (message) => toasts.push(message), setEmpty() {}, setPlaylist() {}, setQueue() {}, setTitle() {}, openMenu() {} },
  });
  assert.equal(controller.back(), false);
  controller.load(MAGENTA_TV_PAGE);
  assert.equal(await controller.neighbour(true), true);
  assert.deepEqual(inputs, [{ type: 'keyDown', keyCode: 'Up' }, { type: 'keyUp', keyCode: 'Up' }]);
  await controller.neighbour(false);
  assert.deepEqual(inputs.slice(2).map(({ keyCode }) => keyCode), ['Down', 'Down']);
  assert.deepEqual(toasts, ['Nächster Sender', 'Vorheriger Sender']);

  // A step back the player catches falls back to the channel list.
  assert.equal(controller.back(), true);
  assert.equal(wentBack, 1);
  t.mock.timers.tick(1500);
  assert.deepEqual(loaded, [MAGENTA_TV_PAGE]);

  // Without history the channel list is the last stop.
  canGoBack = false;
  assert.equal(controller.back(), false);
  assert.equal(toasts.at(-1), 'Keine vorherige Seite');
  url = 'https://www.magenta.tv/streamen-tv/zdf/zdf';
  assert.equal(controller.back(), true);
  assert.deepEqual(loaded, [MAGENTA_TV_PAGE, MAGENTA_TV_PAGE]);
});

test('passes up and down to MagentaTV and maps back keys to going back', () => {
  const controller = new WindowController({});
  const messages = [];
  let url = 'https://www.magenta.tv/streamen-tv/vox/vox';
  controller.window = {};
  controller.guest = { getURL: () => url };
  controller.send = (_channel, payload) => messages.push(payload.name);
  assert.equal(controller.handleInput({ type: 'keyDown', key: 'ArrowUp' }, true), false);
  assert.equal(controller.handleInput({ type: 'keyDown', key: 'ArrowDown' }, true), false);
  assert.equal(controller.handleInput({ type: 'keyDown', key: 'Backspace' }, true), true);
  assert.equal(controller.handleInput({ type: 'keyDown', key: 'ArrowLeft', alt: true }, true), true);
  url = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
  assert.equal(controller.handleInput({ type: 'keyDown', key: 'ArrowUp' }, true), true);
  assert.deepEqual(messages, ['back', 'back', 'volume-step']);
});

test('goes back when the page reports the mouse back button', async () => {
  const listeners = new Map();
  let wentBack = 0;
  let url = 'https://www.magenta.tv/streamen-tv/zdf/zdf';
  const player = {
    src: '', focus() {}, send() {},
    addEventListener: (type, listener) => listeners.set(type, listener),
    canGoBack: () => true,
    goBack: () => { wentBack += 1; url = MAGENTA_TV_PAGE; },
    getURL: () => url,
  };
  const controller = new PlaybackController({
    player,
    baseUrl: 'http://127.0.0.1:3210',
    api: {},
    hooks: { toast() {}, setEmpty() {}, setPlaylist() {}, setQueue() {}, setTitle() {}, openMenu() {} },
  });
  controller.load(MAGENTA_TV_PAGE);
  listeners.get('ipc-message')({ channel: 'guest-event', args: [{ type: 'history-back', payload: {} }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(wentBack, 1);
});
