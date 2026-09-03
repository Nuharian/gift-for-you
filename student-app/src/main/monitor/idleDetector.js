// Idle Detector — random presence checks while a study session is running.
//
// The study clock already auto-pauses on real inactivity (see studyTracker).
// This adds the deliberate "are you still there?" prompt: a random check every
// 15-30 minutes that pauses the session if the student does not answer.
const { BrowserWindow, screen, powerMonitor } = require('electron');
const path = require('path');

const MIN_MINUTES = 15;
const MAX_MINUTES = 30;
const RESPONSE_TIMEOUT_MS = 2 * 60 * 1000;

let nextCheckTimer = null;
let responseTimer = null;
let idleAlertWindow = null;
let isIdle = false;
let idleStartTime = null;
let onIdleCallback = null;
let onResumeCallback = null;
let storeRef = null;
let windowRef = null;

function randomInterval(minMinutes, maxMinutes) {
  const min = minMinutes * 60 * 1000;
  const max = maxMinutes * 60 * 1000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function setupIdleDetector(store, mainWindow) {
  storeRef = store;
  windowRef = mainWindow;
  scheduleNextCheck();

  // A locked or sleeping machine is unambiguously idle — no need to ask.
  try {
    powerMonitor.on('lock-screen', () => markAsIdle('screen locked'));
    powerMonitor.on('suspend', () => markAsIdle('system suspended'));
    powerMonitor.on('resume', () => scheduleNextCheck());
    powerMonitor.on('unlock-screen', () => scheduleNextCheck());
  } catch (e) {
    // Power events are unavailable on some platforms.
  }

  console.log('💤 Idle detector started (' + MIN_MINUTES + '-' + MAX_MINUTES + ' min random checks)');
}

function scheduleNextCheck() {
  if (nextCheckTimer) clearTimeout(nextCheckTimer);

  const interval = randomInterval(MIN_MINUTES, MAX_MINUTES);
  console.log('⏰ Next presence check in ~' + Math.round(interval / 60000) + ' minutes');

  nextCheckTimer = setTimeout(triggerIdleCheck, interval);
}

function triggerIdleCheck() {
  // Only ask while a session is actually running; nobody wants a popup when
  // they are not studying.
  const study = storeRef && storeRef.get('studyState');
  if (!study || !study.isStudying) {
    scheduleNextCheck();
    return;
  }

  showIdleAlert();

  if (windowRef && !windowRef.isDestroyed()) {
    windowRef.webContents.send('idle:check', { timestamp: Date.now() });
  }

  responseTimer = setTimeout(() => markAsIdle('no response'), RESPONSE_TIMEOUT_MS);
}

function showIdleAlert() {
  if (idleAlertWindow && !idleAlertWindow.isDestroyed()) {
    idleAlertWindow.show();
    idleAlertWindow.focus();
    return;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  idleAlertWindow = new BrowserWindow({
    width: 500,
    height: 350,
    x: Math.round((width - 500) / 2),
    y: Math.round((height - 350) / 2),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, '../../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  idleAlertWindow.loadFile(path.join(__dirname, '../../renderer/idle-alert.html'));
  idleAlertWindow.setAlwaysOnTop(true, 'screen-saver');
  idleAlertWindow.once('ready-to-show', () => {
    idleAlertWindow.show();
    idleAlertWindow.focus();
  });
  idleAlertWindow.on('closed', () => { idleAlertWindow = null; });
}

function closeAlert() {
  if (idleAlertWindow && !idleAlertWindow.isDestroyed()) {
    idleAlertWindow.close();
  }
  idleAlertWindow = null;
}

function respondToIdleCheck(isHere) {
  if (responseTimer) {
    clearTimeout(responseTimer);
    responseTimer = null;
  }
  closeAlert();

  if (isHere) {
    isIdle = false;
    idleStartTime = null;
    console.log('✅ Student confirmed presence');

    if (windowRef && !windowRef.isDestroyed()) {
      windowRef.webContents.send('idle:resolved', { wasIdle: false });
    }
    if (onResumeCallback) onResumeCallback(0);
    scheduleNextCheck();
  } else {
    markAsIdle('student said no');
  }

  return { success: true };
}

function markAsIdle(reason) {
  if (responseTimer) {
    clearTimeout(responseTimer);
    responseTimer = null;
  }
  closeAlert();

  if (isIdle) return;
  isIdle = true;
  idleStartTime = Date.now();

  console.log('💤 Marked idle (' + reason + ') — study paused');

  if (windowRef && !windowRef.isDestroyed()) {
    windowRef.webContents.send('idle:detected', { timestamp: idleStartTime, reason, studyPaused: true });
  }

  if (onIdleCallback) onIdleCallback(reason);
  scheduleNextCheck();
}

function resumeFromIdle() {
  const idleDuration = idleStartTime ? Math.round((Date.now() - idleStartTime) / 1000) : 0;
  isIdle = false;
  idleStartTime = null;

  console.log('✅ Resumed from idle (was idle ' + idleDuration + 's)');

  if (windowRef && !windowRef.isDestroyed()) {
    windowRef.webContents.send('idle:resolved', { wasIdle: true, idleDurationSec: idleDuration });
  }

  if (onResumeCallback) onResumeCallback(idleDuration);
  scheduleNextCheck();
  return idleDuration;
}

function stopIdleDetector() {
  if (nextCheckTimer) { clearTimeout(nextCheckTimer); nextCheckTimer = null; }
  if (responseTimer) { clearTimeout(responseTimer); responseTimer = null; }
  closeAlert();
}

function getIdleState() {
  return { isIdle, idleStartTime };
}

function setCallbacks(onIdleCb, onResumeCb) {
  onIdleCallback = onIdleCb;
  onResumeCallback = onResumeCb;
}

module.exports = {
  setupIdleDetector,
  stopIdleDetector,
  respondToIdleCheck,
  resumeFromIdle,
  getIdleState,
  setCallbacks,
};
