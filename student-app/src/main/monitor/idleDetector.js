// Idle Detector — Random 15-30 min notifications with loud alarm
const { BrowserWindow, screen } = require('electron');
const path = require('path');

let idleCheckInterval = null;
let idleAlertWindow = null;
let idleTimeout = null;
let isIdle = false;
let studyPaused = false;
let idleStartTime = null;
let onIdleCallback = null;
let onResumeCallback = null;

// Generate random interval between min and max minutes
function randomInterval(minMinutes, maxMinutes) {
  const min = minMinutes * 60 * 1000;
  const max = maxMinutes * 60 * 1000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function setupIdleDetector(store, mainWindow) {
  // Schedule the first idle check
  scheduleNextCheck(store, mainWindow);
  console.log('💤 Idle detector started (15-30 min random intervals)');
}

function scheduleNextCheck(store, mainWindow) {
  if (idleCheckInterval) clearTimeout(idleCheckInterval);

  const interval = randomInterval(15, 30);
  const minutesApprox = Math.round(interval / 60000);
  console.log(`⏰ Next idle check in ~${minutesApprox} minutes`);

  idleCheckInterval = setTimeout(() => {
    triggerIdleCheck(store, mainWindow);
  }, interval);
}

function triggerIdleCheck(store, mainWindow) {
  // Show the idle check alert
  showIdleAlert(mainWindow);

  // Send event to renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('idle:check', { timestamp: Date.now() });
  }

  // Set timeout — if not responded in 2 minutes, mark as idle
  idleTimeout = setTimeout(() => {
    markAsIdle(store, mainWindow);
  }, 2 * 60 * 1000); // 2 minutes timeout
}

function showIdleAlert(mainWindow) {
  // Get the primary display size for a full-screen overlay
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

  // Load the idle alert HTML
  idleAlertWindow.loadFile(path.join(__dirname, '../../renderer/idle-alert.html'));
  idleAlertWindow.setAlwaysOnTop(true, 'screen-saver');
  idleAlertWindow.show();
  idleAlertWindow.focus();
}

function respondToIdleCheck(isHere, store, mainWindow) {
  // Clear the timeout
  if (idleTimeout) {
    clearTimeout(idleTimeout);
    idleTimeout = null;
  }

  // Close alert window
  if (idleAlertWindow && !idleAlertWindow.isDestroyed()) {
    idleAlertWindow.close();
    idleAlertWindow = null;
  }

  if (isHere) {
    // Student confirmed they're here
    isIdle = false;
    studyPaused = false;
    console.log('✅ Student confirmed presence');

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('idle:resolved', { wasIdle: false });
    }
  } else {
    markAsIdle(store, mainWindow);
  }

  // Schedule next check
  scheduleNextCheck(store, mainWindow);
}

function markAsIdle(store, mainWindow) {
  isIdle = true;
  studyPaused = true;
  idleStartTime = Date.now();

  console.log('💤 Student marked as IDLE — study paused');

  // Close alert window
  if (idleAlertWindow && !idleAlertWindow.isDestroyed()) {
    idleAlertWindow.close();
    idleAlertWindow = null;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('idle:detected', {
      timestamp: idleStartTime,
      studyPaused: true,
    });
  }

  if (onIdleCallback) onIdleCallback();
}

function resumeFromIdle(store, mainWindow) {
  const idleDuration = idleStartTime ? Math.round((Date.now() - idleStartTime) / 1000) : 0;
  isIdle = false;
  studyPaused = false;
  idleStartTime = null;

  console.log(`✅ Resumed from idle (was idle for ${idleDuration}s)`);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('idle:resolved', {
      wasIdle: true,
      idleDurationSec: idleDuration,
    });
  }

  if (onResumeCallback) onResumeCallback(idleDuration);
  scheduleNextCheck(store, mainWindow);
}

function stopIdleDetector() {
  if (idleCheckInterval) {
    clearTimeout(idleCheckInterval);
    idleCheckInterval = null;
  }
  if (idleTimeout) {
    clearTimeout(idleTimeout);
    idleTimeout = null;
  }
  if (idleAlertWindow && !idleAlertWindow.isDestroyed()) {
    idleAlertWindow.close();
    idleAlertWindow = null;
  }
}

function getIdleState() {
  return { isIdle, studyPaused, idleStartTime };
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
