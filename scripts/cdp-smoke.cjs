'use strict';

const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const port = Number(process.argv[2]) || 9333;
  const videoId = process.argv.slice(3).find((argument) => !argument.startsWith('--')) || '';
  const openMenu = process.argv.includes('--menu');
  const openHelp = process.argv.includes('--help');
  const helpTab = process.argv.find((argument) => argument.startsWith('--tab='))?.slice(6) || '';
  const pressF1 = process.argv.includes('--press-f1');
  const pressEscape = process.argv.includes('--press-escape');
  const clickHelpClose = process.argv.includes('--click-close');
  const searchQuery = process.argv.find((argument) => argument.startsWith('--search='))?.slice(9) || '';
  const playFirstSearchResult = process.argv.includes('--play-first-result');
  const pressSearch = process.argv.includes('--press-search');
  const viewport = /^(\d+)x(\d+)$/.exec(process.argv.find((argument) => argument.startsWith('--viewport='))?.slice(11) || '');
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const target = targets.find((candidate) => candidate.type === 'page' && candidate.title === 'FloatingYT');
  if (!target) throw new Error('FloatingYT renderer target not found');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const issues = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params.exceptionDetails || {};
      issues.push({ type: 'exception', text: detail.text || 'Renderer exception', url: detail.url || '', line: detail.lineNumber });
    }
    if (message.method === 'Log.entryAdded' && ['error', 'warning'].includes(message.params.entry?.level)) {
      const entry = message.params.entry;
      issues.push({ type: entry.level, text: entry.text, url: entry.url || '', line: entry.lineNumber });
    }
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const clickElement = async (selector) => {
    const pointResult = await command('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => { const rect=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return rect ? {x:rect.x+rect.width/2,y:rect.y+rect.height/2} : null; })()`,
    });
    const point = pointResult.result.value;
    if (!point) return;
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  };

  await command('Runtime.enable');
  await command('Log.enable');
  if (viewport) {
    await command('Emulation.setDeviceMetricsOverride', {
      width: Number(viewport[1]), height: Number(viewport[2]), deviceScaleFactor: 1, mobile: false,
    });
  }
  if (pressSearch) {
    await command('Runtime.evaluate', { expression: `document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',code:'KeyF',ctrlKey:true,bubbles:true,cancelable:true}))` });
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (searchQuery) {
    await command('Runtime.evaluate', {
      expression: `(() => { if(!document.body.classList.contains('empty')&&!document.body.classList.contains('searching'))document.querySelector('#search')?.click();const input=document.querySelector('#url-input');input.value=${JSON.stringify(searchQuery)};input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(searchQuery)}}));input.focus(); })()`,
    });
    await new Promise((resolve) => setTimeout(resolve, 4500));
  }
  if (playFirstSearchResult) {
    await clickElement('.search-result');
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  if (videoId) {
    await command('Runtime.evaluate', {
      expression: `(() => { const input=document.querySelector('#url-input'); input.value=${JSON.stringify(videoId)}; input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return true; })()`,
    });
    await new Promise((resolve) => setTimeout(resolve, 12_000));
  }
  if (openMenu) {
    await command('Runtime.evaluate', { expression: `document.querySelector('#settings')?.click()` });
    await new Promise((resolve) => setTimeout(resolve, 2200));
  }
  if (openHelp) {
    await command('Runtime.evaluate', { expression: `(() => { if (document.querySelector('#help-overlay')?.hidden) document.querySelector('#help')?.click(); })()` });
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  if (helpTab) {
    await clickElement(`[data-help-tab="${helpTab}"]`);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  if (clickHelpClose) {
    await clickElement('#help-close');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  for (const shortcut of [
    pressF1 && { key: 'F1', code: 'F1' },
    pressEscape && { key: 'Escape', code: 'Escape' },
  ].filter(Boolean)) {
    await command('Runtime.evaluate', { expression: `(() => { const target=document.activeElement || document; target.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(shortcut.key)},code:${JSON.stringify(shortcut.code)},bubbles:true,cancelable:true})); target.dispatchEvent(new KeyboardEvent('keyup',{key:${JSON.stringify(shortcut.key)},code:${JSON.stringify(shortcut.code)},bubbles:true,cancelable:true})); })()` });
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const evaluation = await command('Runtime.evaluate', {
    returnByValue: true,
    awaitPromise: true,
    expression: `(() => {
      const stage = document.querySelector('#stage')?.getBoundingClientRect();
      const helpDialog = document.querySelector('#help-dialog');
      const helpClose = document.querySelector('#help-close');
      const helpCloseRect = helpClose?.getBoundingClientRect();
      return {
        title: document.title,
        bodyClass: document.body.className,
        viewport: { width: innerWidth, height: innerHeight },
        stage: stage && { x: stage.x, y: stage.y, width: stage.width, height: stage.height },
        inputFocused: document.activeElement?.id === 'url-input',
        apiReady: typeof window.floatingApi === 'object',
        webviewReady: Boolean(document.querySelector('#player')),
        menuHidden: document.querySelector('#settings-menu')?.hidden,
        helpOpen: !document.querySelector('#help-overlay')?.hidden,
        search: {
          open: document.body.classList.contains('empty') || document.body.classList.contains('searching'),
          query: document.querySelector('#url-input')?.value || '',
          feedback: document.querySelector('#search-feedback')?.textContent || '',
          resultCount: document.querySelectorAll('.search-result').length,
          selectedTitle: document.querySelector('.search-result[aria-selected="true"] .search-title')?.textContent || '',
        },
        helpLayout: helpDialog && !document.querySelector('#help-overlay')?.hidden ? {
          activeTab: document.querySelector('[data-help-tab][aria-selected="true"]')?.dataset.helpTab,
          clientHeight: helpDialog.clientHeight,
          scrollHeight: helpDialog.scrollHeight,
          closeRect: helpCloseRect && { x: helpCloseRect.x, y: helpCloseRect.y, width: helpCloseRect.width, height: helpCloseRect.height },
          closeHits: helpCloseRect ? [[3,3],[helpCloseRect.width/2,helpCloseRect.height/2],[helpCloseRect.width-3,helpCloseRect.height-3]].map(([x,y]) => document.elementFromPoint(helpCloseRect.x+x,helpCloseRect.y+y)?.closest?.('button')?.id || '') : [],
        } : null,
        playerUrl: document.querySelector('#player')?.src,
      };
    })()`,
  });
  const screenshot = await command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const output = path.join(__dirname, '..', 'test-output', videoId ? 'playback.png' : 'startup.png');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
  socket.close();
  const finalTargets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  console.log(JSON.stringify({
    renderer: evaluation.result.value,
    issues,
    targets: finalTargets.map(({ type, title, url }) => ({ type, title, url })),
    screenshot: output,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
