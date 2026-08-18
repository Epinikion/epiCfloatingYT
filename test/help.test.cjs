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
  for (const id of ['help', 'welcome-help', 'help-from-settings', 'help-overlay', 'help-dialog', 'help-close']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const label of [
    'Leertaste', 'Strg', 'Shift', 'F1', 'Wiedergabe / Pause', 'Ton an / aus',
    'Vorheriger Titel', 'Nächster Titel', 'Deckkraft erhöhen / verringern',
    'Randlicht an / aus', 'Bildschärfung an / aus', 'Seitenverhältnis fixieren / freigeben',
    'Fenster verschieben', 'Doppelklick', 'Oberkante berühren',
  ]) assert.ok(html.includes(label), `Hilfetext fehlt: ${label}`);

  assert.match(renderer, /case 'help': this\.toggleHelp\(\)/);
  assert.match(windowController, /key === 'f1' && fromGuest/);
  assert.match(styles, /#help-overlay\s*\{[^}]*background:\s*transparent/s);
  assert.match(styles, /#help-overlay::before\s*\{[^}]*left:\s*var\(--stage-left\)[^}]*width:\s*var\(--stage-width\)/s);
  assert.doesNotMatch(styles.match(/#help-dialog\s*\{[^}]*\}/s)?.[0] || '', /box-shadow/);
});
