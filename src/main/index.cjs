'use strict';

const path = require('node:path');
const { app, BrowserWindow, clipboard, ipcMain, screen, session } = require('electron');
const { attachAdBlocker } = require('./adblock.cjs');
const { LocalPlayerServer } = require('./local-server.cjs');
const { MediaResolver, MediaSessionRegistry } = require('./media-resolver.cjs');
const { COOKIE_BROWSERS, StateStore, cookieBrowser } = require('./state-store.cjs');
const { VideoSearchService } = require('./video-search.cjs');
const { WindowController } = require('./window-controller.cjs');

const ROOT = path.join(__dirname, '..', '..');
const PARTITION = 'persist:floatingyt';
const GUEST_PRELOAD = path.join(ROOT, 'src', 'guest', 'guest-preload.cjs');
const APP_PRELOAD = path.join(ROOT, 'src', 'preload', 'app-preload.cjs');
const UI_FILE = path.join(ROOT, 'src', 'renderer', 'index.html');
const ICON_FILE = path.join(ROOT, 'build', 'icon.png');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setAppUserModelId('org.nerdwg.floatingyt');

let controller = null;
let playerServer = null;
let store = null;

async function configureYouTubeSession() {
  const youtubeSession = session.fromPartition(PARTITION);
  attachAdBlocker(youtubeSession);
  const userAgent = youtubeSession.getUserAgent()
    .replace(/\sElectron\/[\d.]+/, '')
    .replace(new RegExp(`\\s${app.getName()}\\/[\\d.]+`, 'i'), '');
  youtubeSession.setUserAgent(userAgent);
  youtubeSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'fullscreen'));
  const extensionDirectory = app.isPackaged
    ? path.join(process.resourcesPath, 'floatingyt-extension')
    : path.join(ROOT, 'src', 'extension');
  await youtubeSession.extensions.loadExtension(extensionDirectory, { allowFileAccess: false });
  return youtubeSession;
}

function findStartUrl(argv) {
  return argv.slice(1).find((argument) => /^(https?:\/\/)?([\w-]+\.)*(youtube\.com|youtube-nocookie\.com|youtu\.be)\//i.test(argument)) || null;
}

function registerIpc({ resolver, sessions, search }) {
  ipcMain.handle('app:get-state', () => ({
    ...store.value,
    baseUrl: playerServer.baseUrl,
    clipboard: clipboard.readText().trim(),
  }));
  ipcMain.handle('media:resolve-stream', async (_event, id) => {
    const result = await resolver.resolveStream(String(id || ''));
    if (result.error) return result;
    const token = sessions.add(result);
    return {
      video: `${playerServer.baseUrl}/media/${token}/video`,
      audio: result.audio ? `${playerServer.baseUrl}/media/${token}/audio` : null,
      title: result.title,
      duration: result.duration,
      height: result.height,
    };
  });
  ipcMain.handle('media:resolve-queue', (_event, payload) => {
    const id = String(payload?.id || '');
    const list = String(payload?.list || '');
    const number = Number(payload?.index);
    const index = Number.isSafeInteger(number) && number > 0 && number <= 100_000 ? number : 0;
    return resolver.resolveQueue({ id, list, index });
  });
  ipcMain.handle('video:search', (_event, query) => search.search(String(query || '')));
  ipcMain.handle('settings:cookie-browsers', () => COOKIE_BROWSERS);
  ipcMain.handle('settings:set-cookie-browser', (_event, value) => {
    store.patch((state) => { state.cookieBrowser = cookieBrowser(value); });
    return store.value.cookieBrowser;
  });

  ipcMain.on('window:toggle-pin', () => controller?.togglePin());
  ipcMain.on('window:minimize', () => controller?.window?.minimize());
  ipcMain.on('window:close', () => controller?.window?.close());
  ipcMain.on('window:toggle-fullscreen', () => controller?.toggleFullscreen());
  ipcMain.on('window:leave-fullscreen', () => controller?.leaveFullscreen());
  ipcMain.on('window:video-aspect', (_event, ratio) => controller?.setAspect(Number(ratio)));
  ipcMain.on('window:drag-start', (_event, payload) => controller?.startDrag(payload || {}));
  ipcMain.on('window:drag-move', (_event, payload) => controller?.moveDrag(payload || {}));
  ipcMain.on('window:drag-end', () => controller?.endDrag());
  ipcMain.on('window:resize-start', (_event, payload) => controller?.startResize(payload || {}));
  ipcMain.on('window:resize-move', (_event, payload) => controller?.moveResize(payload || {}));
  ipcMain.on('window:resize-end', () => controller?.endResize());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const window = controller?.window;
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
    const url = findStartUrl(argv);
    if (url) controller.send('app:shortcut', { name: 'load-url', url });
  });

  app.whenReady().then(async () => {
    store = new StateStore(path.join(app.getPath('userData'), 'state.json'));
    const sessions = new MediaSessionRegistry();
    const resolver = new MediaResolver({ cookieBrowser: () => store.value.cookieBrowser });
    playerServer = new LocalPlayerServer({ playerDirectory: path.join(ROOT, 'src', 'player'), mediaSessions: sessions });
    await playerServer.start();
    const youtubeSession = await configureYouTubeSession();
    const search = new VideoSearchService({ fetchImpl: youtubeSession.fetch.bind(youtubeSession) });
    registerIpc({ resolver, sessions, search });
    controller = new WindowController({
      BrowserWindow,
      screen,
      clipboard,
      store,
      appPreload: APP_PRELOAD,
      guestPreload: GUEST_PRELOAD,
      icon: ICON_FILE,
      uiFile: UI_FILE,
      partition: PARTITION,
      baseUrl: playerServer.baseUrl,
    });
    controller.create(findStartUrl(process.argv));
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    store?.flush();
    playerServer?.close();
  });
}
