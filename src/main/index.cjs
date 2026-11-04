'use strict';

const path = require('node:path');
const { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, screen, session } = require('electron');
const { attachAdBlocker } = require('./adblock.cjs');
const { LocalPlayerServer } = require('./local-server.cjs');
const { collectMediaFiles } = require('./local-media.cjs');
const { MediaResolver } = require('./media-resolver.cjs');
const { COOKIE_BROWSERS, StateStore, caption, cookieBrowser, soundBoost } = require('./state-store.cjs');
const { VideoMetadataService } = require('./video-metadata.cjs');
const { VideoSearchService } = require('./video-search.cjs');
const { WindowController } = require('./window-controller.cjs');
const { importCookieFile } = require('./cookie-file.cjs');
const { MagentaGuide } = require('./magenta-guide.cjs');

const ROOT = path.join(__dirname, '..', '..');
const PARTITION = 'persist:floatingyt';
const GUEST_PRELOAD = path.join(ROOT, 'src', 'guest', 'guest-preload.cjs');
const APP_PRELOAD = path.join(ROOT, 'src', 'preload', 'app-preload.cjs');
const UI_FILE = path.join(ROOT, 'src', 'renderer', 'index.html');
const ICON_FILE = path.join(ROOT, 'build', 'icon.png');
// Global, because a faded click-through window receives no keys of its own.
const GHOST_SHORTCUT = 'CommandOrControl+Alt+G';

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setAppUserModelId('org.nerdwg.floatingyt');

let controller = null;
let playerServer = null;
let store = null;
let widevine = 'pending';

// castLabs Electron fetches the Widevine module that MagentaTV needs; plain
// Electron has no `components` and therefore no protected playback.
function prepareWidevine() {
  const { components } = require('electron');
  if (!components?.whenReady) {
    widevine = 'missing';
    return;
  }
  components.whenReady()
    .then(() => {
      const ready = Object.values(components.status() || {}).some((entry) => /widevine/i.test(entry?.title || '') && entry.version);
      widevine = ready ? 'ready' : 'missing';
    })
    .catch(() => { widevine = 'missing'; });
}

// Google and YouTube treat the default Electron user agent as an unknown browser.
function usePlainUserAgent(target) {
  const userAgent = target.getUserAgent()
    .replace(/\sElectron\/[\d.]+/, '')
    .replace(new RegExp(`\\s${app.getName()}\\/[\\d.]+`, 'i'), '');
  target.setUserAgent(userAgent);
}

async function configureYouTubeSession() {
  const youtubeSession = session.fromPartition(PARTITION);
  attachAdBlocker(youtubeSession);
  usePlainUserAgent(youtubeSession);
  youtubeSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'fullscreen'));
  const extensionDirectory = app.isPackaged
    ? path.join(process.resourcesPath, 'floatingyt-extension')
    : path.join(ROOT, 'src', 'extension');
  await youtubeSession.extensions.loadExtension(extensionDirectory, { allowFileAccess: false });
  return youtubeSession;
}

function findStartUrl(argv) {
  return argv.slice(1).find((argument) => /^(https?:\/\/)?([\w-]+\.)*(youtube\.com|youtube-nocookie\.com|youtu\.be|twitch\.tv)\//i.test(argument)) || null;
}

function registerIpc({ resolver, search, metadata, cookieFile, guide }) {
  ipcMain.handle('magenta:guide', () => guide.guide());
  ipcMain.handle('app:widevine', () => widevine);
  ipcMain.handle('app:get-state', () => ({
    ...store.value,
    baseUrl: playerServer.baseUrl,
    clipboard: clipboard.readText().trim(),
  }));
  ipcMain.handle('media:resolve-queue', (_event, payload) => {
    const id = String(payload?.id || '');
    const list = String(payload?.list || '');
    const number = Number(payload?.index);
    const index = Number.isSafeInteger(number) && number > 0 && number <= 100_000 ? number : 0;
    return resolver.resolveQueue({ id, list, index });
  });
  ipcMain.handle('video:search', (_event, query) => search.search(String(query || '')));
  ipcMain.handle('video:metadata', (_event, ids) => metadata.resolve(ids));
  ipcMain.handle('local-media:open', async (_event, inputPaths) => {
    const { files, truncated } = await collectMediaFiles(inputPaths);
    if (!files.length) return { items: [], error: 'Keine unterstützten Videodateien gefunden' };
    const items = playerServer.registerMedia(files);
    return { items, truncated, error: null };
  });
  ipcMain.handle('settings:cookie-browsers', () => COOKIE_BROWSERS);
  ipcMain.handle('settings:set-cookie-browser', (_event, value) => {
    store.patch((state) => { state.cookieBrowser = cookieBrowser(value); });
    resolver.forgetAccount();
    return store.value.cookieBrowser;
  });
  ipcMain.handle('youtube:account', (_event, refresh) => resolver.youtubeAccount({ refresh: refresh === true }));
  ipcMain.handle('youtube:import-cookie-file', async () => {
    const options = {
      title: 'YouTube-Cookie-Datei wählen',
      filters: [{ name: 'Cookie-Datei', extensions: ['txt'] }],
      properties: ['openFile'],
    };
    const choice = controller?.window ? await dialog.showOpenDialog(controller.window, options) : await dialog.showOpenDialog(options);
    if (choice.canceled || !choice.filePaths[0]) return { canceled: true };
    const { error } = await importCookieFile(choice.filePaths[0], cookieFile);
    if (error) return { error };
    store.patch((state) => { state.cookieBrowser = 'file'; });
    resolver.forgetAccount();
    return { browser: store.value.cookieBrowser, account: await resolver.youtubeAccount({ refresh: true }) };
  });
  ipcMain.handle('settings:set-caption', (_event, value) => {
    store.patch((state) => { state.caption = caption(value); });
    return store.value.caption;
  });
  ipcMain.handle('settings:set-ghost', (_event, value) => controller?.setGhost(value === true) ?? false);
  ipcMain.handle('settings:set-sound-boost', (_event, value) => {
    store.patch((state) => { state.soundBoost = soundBoost(value); });
    return store.value.soundBoost;
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
  ipcMain.on('guest:editing', (event, editing) => controller?.setGuestEditing(event.sender, editing === true));
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
    prepareWidevine();
    store = new StateStore(path.join(app.getPath('userData'), 'state.json'));
    const cookieFile = path.join(app.getPath('userData'), 'youtube-cookies.txt');
    const resolver = new MediaResolver({ cookieBrowser: () => store.value.cookieBrowser, cookieFile: () => cookieFile });
    playerServer = new LocalPlayerServer({ playerDirectory: path.join(ROOT, 'src', 'player') });
    await playerServer.start();
    const youtubeSession = await configureYouTubeSession();
    const search = new VideoSearchService({ fetchImpl: youtubeSession.fetch.bind(youtubeSession) });
    const metadata = new VideoMetadataService({ fetchImpl: youtubeSession.fetch.bind(youtubeSession) });
    registerIpc({ resolver, search, metadata, cookieFile, guide: new MagentaGuide() });
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
    globalShortcut.register(GHOST_SHORTCUT, () => controller?.toggleGhost());
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('before-quit', () => {
    store?.flush();
    playerServer?.close();
  });
}
