// Auto-update — downloads and installs new versions in place.
//
// Backed by electron-updater against GitHub Releases. The student never
// re-downloads the installer by hand: the app checks on launch and every six
// hours, downloads in the background, and installs on quit (or immediately if
// the student clicks Restart).
const { app, dialog } = require('electron');

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 15000;

let autoUpdater = null;
let mainWindow = null;
let checkTimer = null;
let downloadedVersion = null;
let checking = false;
let manualCheck = false;

let status = {
  state: 'idle',        // idle | checking | available | downloading | ready | uptodate | error | unsupported
  version: app.getVersion(),
  latestVersion: null,
  percent: 0,
  message: '',
};

function setStatus(patch) {
  status = { ...status, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', status);
  }
}

function getStatus() {
  return status;
}

function setupUpdater(window) {
  mainWindow = window;

  // Updates only apply to a packaged, installed build.
  if (!app.isPackaged) {
    setStatus({ state: 'unsupported', message: 'Updates are disabled in development.' });
    console.log('⬆️ Auto-update skipped (not packaged)');
    return;
  }

  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    setStatus({ state: 'unsupported', message: 'Updater unavailable.' });
    console.warn('⬆️ electron-updater not installed:', e.message);
    return;
  }

  autoUpdater.autoDownload = true;
  // Installing during quit would race the tray teardown; we control the moment.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => {
    checking = true;
    setStatus({ state: 'checking', message: 'Checking for updates…' });
  });

  autoUpdater.on('update-available', (info) => {
    checking = false;
    setStatus({
      state: 'downloading',
      latestVersion: info.version,
      percent: 0,
      message: 'Downloading version ' + info.version + '…',
    });
    console.log('⬆️ Update available:', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    checking = false;
    setStatus({ state: 'uptodate', message: 'You are on the latest version.' });
    if (manualCheck) {
      manualCheck = false;
      showInfo('No updates available', 'Gift For You ' + app.getVersion() + ' is the latest version.');
    }
  });

  autoUpdater.on('download-progress', (p) => {
    setStatus({
      state: 'downloading',
      percent: Math.round(p.percent || 0),
      message: 'Downloading… ' + Math.round(p.percent || 0) + '%',
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    downloadedVersion = info.version;
    setStatus({
      state: 'ready',
      latestVersion: info.version,
      percent: 100,
      message: 'Version ' + info.version + ' is ready to install.',
    });
    console.log('⬆️ Update downloaded:', info.version);
    promptInstall(info.version);
  });

  autoUpdater.on('error', (err) => {
    checking = false;
    const msg = (err && err.message) || String(err);
    setStatus({ state: 'error', message: msg.slice(0, 200) });
    console.warn('⬆️ Update error:', msg);
    if (manualCheck) {
      manualCheck = false;
      showInfo('Update check failed', msg.slice(0, 300));
    }
  });

  setTimeout(() => checkForUpdates(false), FIRST_CHECK_DELAY_MS);
  checkTimer = setInterval(() => checkForUpdates(false), CHECK_INTERVAL_MS);

  console.log('⬆️ Auto-update enabled (current v' + app.getVersion() + ')');
}

function showInfo(title, message) {
  try {
    dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : null, {
      type: 'info', title, message, buttons: ['OK'],
    });
  } catch (e) {
    // Dialog is optional feedback.
  }
}

async function promptInstall(version) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update ready',
      message: 'Gift For You ' + version + ' has been downloaded.',
      detail: 'Restart now to use the new version, or it will install automatically next time you close the app.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) quitAndInstall();
  } catch (e) {
    // If the dialog fails the update still installs on quit.
  }
}

function checkForUpdates(isManual) {
  if (!autoUpdater) {
    if (isManual) showInfo('Updates unavailable', 'This build does not support automatic updates.');
    return;
  }
  if (checking) return;
  manualCheck = !!isManual;
  if (downloadedVersion) {
    setStatus({ state: 'ready', message: 'Version ' + downloadedVersion + ' is ready to install.' });
    if (isManual) promptInstall(downloadedVersion);
    return;
  }
  autoUpdater.checkForUpdates().catch((e) => {
    checking = false;
    setStatus({ state: 'error', message: (e.message || 'Check failed').slice(0, 200) });
  });
}

function quitAndInstall() {
  if (!autoUpdater || !downloadedVersion) return false;
  // The caller sets the quitting flag so the tray/window close handlers do not
  // cancel the shutdown.
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
}

function isUpdateReady() {
  return !!downloadedVersion;
}

function stopUpdater() {
  if (checkTimer) { clearInterval(checkTimer); checkTimer = null; }
}

module.exports = {
  setupUpdater,
  checkForUpdates,
  quitAndInstall,
  getStatus,
  isUpdateReady,
  stopUpdater,
};
