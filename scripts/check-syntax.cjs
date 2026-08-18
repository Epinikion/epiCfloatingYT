'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const roots = ['src', 'scripts', 'test'];
let failed = false;

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (/\.(?:cjs|mjs|js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (result.status !== 0) {
        failed = true;
        process.stderr.write(result.stderr || result.stdout);
      }
    }
  }
}

for (const relative of roots) visit(path.join(root, relative));
if (failed) process.exitCode = 1;
else console.log('Syntaxprüfung erfolgreich.');

