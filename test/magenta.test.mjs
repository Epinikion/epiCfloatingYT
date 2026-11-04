import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { MAGENTA_HOME, isMagentaHost, parseMagentaInput } from '../src/shared/magenta-url.mjs';
import { isSupportedVideoLink } from '../src/shared/twitch-url.mjs';
import { PlaybackController } from '../src/renderer/playback-controller.mjs';

const require = createRequire(import.meta.url);
const { isAllowedGuestUrl } = require('../src/main/window-controller.cjs');

test('recognizes MagentaTV links and the name, but no lookalike hosts', () => {
  const live = 'https://www.magenta.tv/streamen-tv/das-erste/259549736360';
  assert.deepEqual(parseMagentaInput(live), { platform: 'magenta', url: live });
  assert.deepEqual(parseMagentaInput('magenta.tv/tv/bares-fuer-rares/032f3c25'), { platform: 'magenta', url: 'https://magenta.tv/tv/bares-fuer-rares/032f3c25' });
  assert.deepEqual(parseMagentaInput('https://web.magentatv.de/'), { platform: 'magenta', url: MAGENTA_HOME });
  assert.deepEqual(parseMagentaInput('MagentaTV'), { platform: 'magenta', url: MAGENTA_HOME });
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
