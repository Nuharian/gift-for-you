// Gift For You — Electron Main Process
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { initFirebase } = require('./firebase');
const { stopMonitoring } = require('./monitor/windowMonitor');
const { stopIdleDetector } = require('./monitor/idleDetector');
const { stopDataSync, markOffline, forceSyncNow } = require('./sync/dataSync');
const { stopFirebaseListeners } = require('./sync/socketClient');
const { setupAutoStart } = require('./autostart');
const { setupIpcHandlers, startAllServices } = require('./ipc/handlers');
const updater = require('./update/updater');
const studyTracker = require('./study/studyTracker');
const DEFAULT_FIREBASE_CONFIG = require('./firebaseConfig');

// A second copy of the app would double-count every timer, so the instance
// lock is taken before anything else is set up.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  return;
}

// Node terminates the process on an unhandled promise rejection, and every
// sync and monitor timer is async. One bad read inside an interval callback
// was therefore enough to kill a student's app mid-session — it vanished from
// the dashboard with no crash dialog and no log. This app is a background tray
// process that must outlive transient faults, so faults are logged and the
// timers are left to recover on their next tick.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (ignored, app kept alive):',
    (reason && reason.stack) || reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception (ignored, app kept alive):', error && error.stack);
});

const store = new Store({
  name: 'gift-for-you-config',
  defaults: {
    studentId: null,
    studentName: null,
    isRegistered: false,
    firebaseConfig: DEFAULT_FIREBASE_CONFIG,
    startMinimized: true,
    notificationsEnabled: true,
    soundEnabled: true,
  },
});

let mainWindow = null;
let tray = null;
let isQuitting = false;
let shuttingDown = false;

function createWindow() {
  // Launched by Windows at login, or relaunched after an update install.
  const launchedHidden = process.argv.includes('--hidden')
    || app.getLoginItemSettings().wasOpenedAsHidden;

  mainWindow = new BrowserWindow({
    width: 480,
    height: 760,
    minWidth: 400,
    minHeight: 600,
    frame: false,
    resizable: true,
    show: false,
    backgroundColor: '#0a0e1a',
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!launchedHidden) mainWindow.show();
  });

  // Closing hides to the tray; only an explicit Quit ends the session.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildTrayMenu() {
  const study = studyTracker.getState();
  const statusLabel = study.isStudying
    ? (study.isRunning ? '📖 Studying — ' + formatHms(study.elapsedSeconds) : '⏸️ Paused — ' + formatHms(study.elapsedSeconds))
    : '🟢 Online';

  return Menu.buildFromTemplate([
    {
      label: '📖 Open Gift For You',
      click: () => showWindow(),
    },
    { type: 'separator' },
    { label: statusLabel, enabled: false },
    { label: '📚 Today: ' + formatHms(studyTracker.getTodayTotalSeconds()), enabled: false },
    { type: 'separator' },
    {
      label: '🔄 Sync now',
      click: () => { forceSyncNow(); },
    },
    {
      label: '⬆️ Check for updates',
      click: () => updater.checkForUpdates(true),
    },
    { type: 'separator' },
    {
      label: '❌ Quit',
      click: () => quitApp(),
    },
  ]);
}

function formatHms(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

function showWindow() {
  if (!mainWindow) createWindow();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) trayIcon = nativeImage.createEmpty();
  } catch (e) {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Gift For You — Student Monitor');
  tray.setContextMenu(buildTrayMenu());
  tray.on('double-click', () => showWindow());

  // Keep the tray tooltip and menu showing the live clock.
  setInterval(() => {
    if (!tray || tray.isDestroyed()) return;
    const study = studyTracker.getState();
    tray.setToolTip(
      study.isStudying
        ? 'Gift For You — studying ' + formatHms(study.elapsedSeconds)
        : 'Gift For You — today ' + formatHms(studyTracker.getTodayTotalSeconds())
    );
    tray.setContextMenu(buildTrayMenu());
  }, 30000);
}

function startServices() {
  let fbConfig = store.get('firebaseConfig');
  if (!fbConfig || !fbConfig.apiKey) {
    fbConfig = DEFAULT_FIREBASE_CONFIG;
    store.set('firebaseConfig', fbConfig);
  }

  const initialized = initFirebase(fbConfig);

  if (initialized && store.get('isRegistered')) {
    startAllServices(store, mainWindow);
    console.log('🎁 Gift For You running for: ' + store.get('studentName'));
  }
}

// Flushes final state before exit so the teacher sees the student go offline
// instead of a stale "online" card.
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopIdleDetector();
  studyTracker.stopTicking();
  stopMonitoring();
  stopFirebaseListeners();
  updater.stopUpdater();
  try {
    await Promise.race([
      Promise.allSettled([forceSyncNow(), markOffline()]),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch (e) {
    // Never block the quit on a network failure.
  }
  stopDataSync();
}

function quitApp() {
  isQuitting = true;
  shutdown().finally(() => app.quit());
}

app.on('second-instance', () => showWindow());

app.whenReady().then(() => {
  createWindow();
  createTray();
  // Re-register every boot so an update's new install path is picked up, but
  // never override a student who deliberately turned auto-start off.
  if (store.get('autoStart') !== false) setupAutoStart(store);
  setupIpcHandlers(ipcMain, store, mainWindow, {
    onQuitRequested: () => { isQuitting = true; },
  });
  updater.setupUpdater(mainWindow);
  startServices();
});

app.on('window-all-closed', () => { /* keep running in the tray */ });
app.on('activate', () => { if (!mainWindow) createWindow(); });

app.on('before-quit', (event) => {
  isQuitting = true;
  if (!shuttingDown) {
    event.preventDefault();
    shutdown().finally(() => app.quit());
  }
});
