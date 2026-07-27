// Gift For You — Electron Main Process (Firebase Edition)
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { initFirebase } = require('./firebase');
const { setupMonitoring, stopMonitoring } = require('./monitor/windowMonitor');
const { setupIdleDetector } = require('./monitor/idleDetector');
const { setupDataSync } = require('./sync/dataSync');
const { setupFirebaseListeners } = require('./sync/socketClient');
const { setupAutoStart } = require('./autostart');
const { setupIpcHandlers } = require('./ipc/handlers');

const store = new Store({
  name: 'gift-for-you-config',
  defaults: {
    studentId: null,
    studentName: null,
    isRegistered: false,
    syncInterval: 5,
    firebaseConfig: {
      apiKey: '',
      authDomain: '',
      projectId: '',
      storageBucket: '',
      messagingSenderId: '',
      appId: '',
    },
  },
});

let mainWindow = null;
let tray = null;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 400,
    minHeight: 600,
    frame: false,
    resizable: true,
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) trayIcon = nativeImage.createEmpty();
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Gift For You — Student Monitor');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '📖 Open Gift For You',
      click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } },
    },
    { type: 'separator' },
    { label: '📚 Status: Online', enabled: false, id: 'status' },
    { type: 'separator' },
    {
      label: '❌ Quit',
      click: () => { isQuitting = true; stopMonitoring(); app.quit(); },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

// Initialize Firebase and start monitoring
function startServices() {
  const fbConfig = store.get('firebaseConfig');
  const initialized = initFirebase(fbConfig);

  if (initialized && store.get('isRegistered')) {
    const studentId = store.get('studentId');
    const studentName = store.get('studentName');

    setupFirebaseListeners(studentId, mainWindow);
    setupMonitoring(store, mainWindow);
    setupIdleDetector(store, mainWindow);
    setupDataSync(store);

    console.log(`🎁 Gift For You running for: ${studentName}`);
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  setupAutoStart();
  setupIpcHandlers(ipcMain, store, mainWindow);
  startServices();
});

app.on('window-all-closed', () => { /* Don't quit — keep running in tray */ });
app.on('activate', () => { if (!mainWindow) createWindow(); });
app.on('before-quit', () => { isQuitting = true; stopMonitoring(); });

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}
