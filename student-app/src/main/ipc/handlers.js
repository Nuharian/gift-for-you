// IPC Handlers — bridge between the main process and the renderer.
const { app, shell } = require('electron');
const { initFirebase, getDb } = require('../firebase');
const {
  setupMonitoring, getCurrentActivity, getAppUsageSummary,
  getTitleUsageSummary, getTotals,
} = require('../monitor/windowMonitor');
const { setupIdleDetector, respondToIdleCheck, getIdleState } = require('../monitor/idleDetector');
const { setupDataSync, forceSyncNow, saveSession, getSyncStatus } = require('../sync/dataSync');
const { setupFirebaseListeners, sendReply } = require('../sync/socketClient');
const { setupAutoStart, disableAutoStart, isAutoStartEnabled } = require('../autostart');
const updater = require('../update/updater');
const studyTracker = require('../study/studyTracker');

const DEFAULT_FIREBASE_CONFIG = require('../firebaseConfig');

function setupIpcHandlers(ipcMain, store, mainWindow, hooks) {
  const onQuitRequested = (hooks && hooks.onQuitRequested) || (() => {});

  // ── Registration ──────────────────────────────────
  ipcMain.handle('register', async (event, payload) => {
    try {
      const name = typeof payload === 'string' ? payload : (payload && payload.name);
      if (!name || !name.trim()) {
        return { success: false, error: 'Please enter your name.' };
      }

      const firebaseConfig = (payload && payload.firebaseConfig && payload.firebaseConfig.apiKey)
        ? payload.firebaseConfig
        : DEFAULT_FIREBASE_CONFIG;

      store.set('firebaseConfig', firebaseConfig);
      if (!initFirebase(firebaseConfig)) {
        return { success: false, error: 'Failed to connect to the database.' };
      }

      const db = getDb();
      const { doc, setDoc } = require('firebase/firestore');
      const studentId = 'student_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);

      await setDoc(doc(db, 'gfy_students', studentId), {
        id: studentId,
        name: name.trim(),
        registeredAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        lastSeenMs: Date.now(),
        isOnline: true,
        status: 'online',
        appVersion: app.getVersion(),
      });

      store.set('studentId', studentId);
      store.set('studentName', name.trim());
      store.set('isRegistered', true);

      startAllServices(store, mainWindow);

      return { success: true, student: { id: studentId, name: name.trim() } };
    } catch (error) {
      console.error('Registration error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('getProfile', () => ({
    id: store.get('studentId'),
    name: store.get('studentName'),
    isRegistered: !!store.get('isRegistered'),
    version: app.getVersion(),
  }));

  ipcMain.handle('isRegistered', () => !!store.get('isRegistered'));

  // ── Study tracker ─────────────────────────────────
  ipcMain.handle('startStudying', async () => {
    const state = studyTracker.start();
    forceSyncNow();
    return state;
  });

  ipcMain.handle('stopStudying', async () => {
    const session = studyTracker.stop();
    await saveSession(session);
    await forceSyncNow();
    return { durationMin: Math.round(session.seconds / 60), durationSeconds: session.seconds };
  });

  ipcMain.handle('startBreak', async () => {
    const state = studyTracker.startBreak();
    forceSyncNow();
    return state;
  });

  ipcMain.handle('resumeStudying', async () => {
    const state = studyTracker.resume();
    forceSyncNow();
    return state;
  });

  ipcMain.handle('getStudyState', () => studyTracker.getState());

  ipcMain.handle('getStats', () => ({
    todayStudySeconds: studyTracker.getTodayTotalSeconds(),
    dayTotals: studyTracker.getDayTotals(),
    usage: getTotals(),
    topApps: getAppUsageSummary().slice(0, 10),
    topTitles: getTitleUsageSummary(10),
    sync: getSyncStatus(),
  }));

  // ── Idle check ────────────────────────────────────
  ipcMain.handle('respondToIdleCheck', (event, isHere) => respondToIdleCheck(isHere));
  ipcMain.handle('getIdleState', () => getIdleState());

  // ── Messages ──────────────────────────────────────
  // Equality-only query: Firestore serves it from the automatic single-field
  // index, so no composite index has to be deployed for messages to work.
  ipcMain.handle('getMessages', async () => {
    const db = getDb();
    if (!db) return [];
    try {
      const { collection, query, where, getDocs } = require('firebase/firestore');
      const studentId = store.get('studentId');
      const snapshot = await getDocs(query(
        collection(db, 'gfy_messages'),
        where('studentId', '==', studentId)
      ));
      return snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')));
    } catch (error) {
      console.error('Error fetching messages:', error.message);
      return [];
    }
  });

  ipcMain.handle('markMessageRead', async (event, messageId) => {
    const db = getDb();
    if (!db || !messageId) return { success: false };
    try {
      const { doc, updateDoc } = require('firebase/firestore');
      await updateDoc(doc(db, 'gfy_messages', messageId), {
        isRead: true,
        readAt: new Date().toISOString(),
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('replyToTeacher', async (event, text) =>
    sendReply(text, store.get('studentName')));

  // ── Activity ──────────────────────────────────────
  ipcMain.handle('getCurrentActivity', () => getCurrentActivity());
  ipcMain.handle('getAppUsage', () => getAppUsageSummary());
  ipcMain.handle('getTitleUsage', () => getTitleUsageSummary(30));
  ipcMain.handle('syncNow', async () => {
    await forceSyncNow();
    return getSyncStatus();
  });

  // ── Settings ──────────────────────────────────────
  ipcMain.handle('getSettings', () => ({
    autoStart: isAutoStartEnabled(),
    startMinimized: store.get('startMinimized') !== false,
    notificationsEnabled: store.get('notificationsEnabled') !== false,
    soundEnabled: store.get('soundEnabled') !== false,
    version: app.getVersion(),
  }));

  ipcMain.handle('setSetting', (event, key, value) => {
    if (key === 'autoStart') {
      if (value) setupAutoStart(store); else disableAutoStart();
    } else {
      store.set(key, value);
    }
    return { success: true };
  });

  // ── Updates ───────────────────────────────────────
  ipcMain.handle('getUpdateStatus', () => updater.getStatus());
  ipcMain.handle('checkForUpdates', () => {
    updater.checkForUpdates(true);
    return updater.getStatus();
  });
  ipcMain.handle('installUpdate', () => {
    onQuitRequested();
    return { success: updater.quitAndInstall() };
  });

  ipcMain.handle('openExternal', (event, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
  });

  // ── Window controls ───────────────────────────────
  ipcMain.on('window:minimize', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize(); });
  ipcMain.on('window:close', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); });
}

// Starts monitoring, idle checks, sync and the message listener. Safe to call
// after registration or on boot; each piece guards against double-starting.
function startAllServices(store, mainWindow) {
  const studentId = store.get('studentId');
  if (!studentId) return;

  studyTracker.init(store, mainWindow, (session) => { saveSession(session); });
  setupFirebaseListeners(studentId, mainWindow);
  setupMonitoring(store, mainWindow);
  setupIdleDetector(store, mainWindow);
  setupDataSync(store, app.getVersion());

  // A presence check that goes unanswered pauses the clock; confirming resumes.
  const { setCallbacks } = require('../monitor/idleDetector');
  setCallbacks(
    () => { studyTracker.setIdle(true); forceSyncNow(); },
    () => { studyTracker.setIdle(false); forceSyncNow(); }
  );
}

module.exports = { setupIpcHandlers, startAllServices };
