'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.mjs'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
const windowController = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'window-controller.cjs'), 'utf8');

test('exposes a complete shortcut and gesture help from every discoverable entry point', () => {
  for (const id of ['help', 'welcome-help', 'help-overlay', 'help-dialog', 'help-close']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const label of [
    'Leertaste', 'Strg', 'Shift', 'F1', 'Wiedergabe / Pause', 'Ton an / aus',
    'Lautstärke erhöhen / verringern', 'Einfacher Klick', 'Keine Wiedergabeaktion',
    'Klicks gehen an das Fenster darunter',
    'Datei / Ordner ablegen', 'Lokale Videos einzeln oder als Liste abspielen',
    'Soundboost', 'bis 300 % verstärken', 'Playlist-Symbol', 'Lokale oder YouTube-Warteschlange anzeigen',
    'Playlist anzeigen / schließen',
    'Vorheriger Titel', 'Nächster Titel', 'Deckkraft erhöhen / verringern',
    'Randlicht an / aus', 'Bildschärfung an / aus', 'Seitenverhältnis fixieren / freigeben',
    'Fenster verschieben', 'Doppelklick', 'Oberkante berühren',
  ]) assert.ok(html.includes(label), `Hilfetext fehlt: ${label}`);

  assert.match(renderer, /case 'help': this\.toggleHelp\(\)/);
  assert.match(windowController, /key === 'f1' && fromGuest/);
  assert.match(windowController, /name: 'volume-step'.*arrowup.*5.*-5/);
  assert.match(renderer, /adjustVolume\(key === 'arrowup' \? 5 : -5\)/);
  assert.match(renderer, /setCaption\(item\.value\)/);
  assert.match(renderer, /setSoundBoost\(item\.value\)/);
  assert.match(renderer, /selectQueue\(index\)/);
  assert.match(renderer, /case 'playlist':/);
  assert.match(windowController, /input\.shift && key === 'p'.*name: 'playlist'/);
  assert.match(windowController, /setIgnoreMouseEvents\(enabled, \{ forward: true \}\)/);
  assert.match(windowController, /overWindow && !overVideo/);
  assert.match(styles, /#help-overlay\s*\{[^}]*background:\s*transparent/s);
  assert.match(styles, /#help-overlay\s*\{[^}]*-webkit-app-region:\s*no-drag/s);
  assert.match(styles, /#help-overlay::before\s*\{[^}]*left:\s*var\(--stage-left\)[^}]*width:\s*var\(--stage-width\)/s);
  assert.doesNotMatch(styles.match(/#help-dialog\s*\{[^}]*\}/s)?.[0] || '', /box-shadow/);
});

test('clips toolbar hover effects to the rounded player edge', () => {
  const toolbarRule = styles.match(/#toolbar\s*\{[^}]*\}/s)?.[0] || '';
  assert.match(toolbarRule, /overflow:\s*hidden/);
  assert.match(toolbarRule, /border-radius:\s*12px 12px 0 0/);
  assert.match(toolbarRule, /clip-path:\s*inset\(0 round 12px 12px 0 0\)/);
});

test('uses an icon-only red hover treatment for every toolbar action', () => {
  const hoverRule = styles.match(/#toolbar button:hover\s*\{[^}]*\}/s)?.[0] || '';
  assert.match(hoverRule, /color:\s*#e11d48/);
  assert.match(hoverRule, /background:\s*transparent/);
  assert.doesNotMatch(styles, /#toolbar #close:hover/);
});

test('keeps the resize handles out of the window drag region', () => {
  // The welcome screen spans the whole stage as a drag region, so the handles
  // must opt out or the window system swallows their pointerdown.
  const handleRule = styles.match(/#resize-handles i\s*\{[^}]*\}/s)?.[0] || '';
  assert.match(handleRule, /-webkit-app-region:\s*no-drag/);
  assert.match(handleRule, /pointer-events:\s*auto/);
  assert.match(styles, /#welcome\s*\{[^}]*-webkit-app-region:\s*drag/s);
  // The container spans the whole window; a no-drag opt-out there would punch
  // a hole through the toolbar and welcome drag regions.
  const containerRule = styles.match(/#resize-handles\s*\{[^}]*\}/s)?.[0] || '';
  assert.doesNotMatch(containerRule, /-webkit-app-region/);
});
