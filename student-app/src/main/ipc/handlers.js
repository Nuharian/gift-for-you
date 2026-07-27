// IPC Handlers — Bridge between main process and renderer (Firebase Edition)
const { initFirebase, getDb } = require('../firebase');
const { setupMonitoring, stopMonitoring, getCurrentActivity } = require('../monitor/windowMonitor');
const { setupIdleDetector, respondToIdleCheck } = require('../monitor/idleDetector');
const { setupDataSync, forceSyncNow } = require('../sync/dataSync');
const { setupFirebaseListeners } = require('../sync/socketClient');

let studyState = {
  isStudying: false,
  isBreak: false,
  isIdle: false,
  startTime: null,
  elapsedSeconds: 0,
};
let studyTimer = null;

function setupIpcHandlers(ipcMain, store, mainWindow) {

  // ── Registration ──────────────────────────────────
  ipcMain.handle('register', async (event, { name, firebaseConfig }) => {
    try {
      // Save Firebase config and init
      store.set('firebaseConfig', firebaseConfig);
      const initialized = initFirebase(firebaseConfig);
      if (!initialized) {
        return { success: false, error: 'Failed to connect to Firebase. Check your config.' };
      }

      const db = getDb();
      const { doc, setDoc } = require('firebase/firestore');

      // Generate student ID
      const studentId = 'student_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);

      // Register in Firestore
      await setDoc(doc(db, 'gfy_students', studentId), {
        id: studentId,
        name: name.trim(),
        registeredAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        isOnline: true,
        status: 'online',
      });

      // Save locally
      store.set('studentId', studentId);
      store.set('studentName', name.trim());
      store.set('isRegistered', true);

      // Start all services
      setupFirebaseListeners(studentId, mainWindow);
      setupMonitoring(store, mainWindow);
      setupIdleDetector(store, mainWindow);
      setupDataSync(store);

      return { success: true, student: { id: studentId, name: name.trim() } };
    } catch (error) {
      console.error('Registration error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('getProfile', () => ({
    id: store.get('studentId'),
    name: store.get('studentName'),
    isRegistered: store.get('isRegistered'),
  }));

  ipcMain.handle('isRegistered', () => store.get('isRegistered') || false);

  // ── Study Tracker ─────────────────────────────────
  ipcMain.handle('startStudying', async () => {
    studyState = {
      isStudying: true,
      isBreak: false,
      isIdle: false,
      startTime: Date.now(),
      elapsedSeconds: 0,
    };
    store.set('studyState', studyState);

    if (studyTimer) clearInterval(studyTimer);
    studyTimer = setInterval(() => {
      if (studyState.isStudying && !studyState.isBreak && !studyState.isIdle) {
        studyState.elapsedSeconds++;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('study:update', studyState);
        }
      }
    }, 1000);

    // Update status in Firebase
    const db = getDb();
    if (db) {
      const { doc, updateDoc } = require('firebase/firestore');
      const studentId = store.get('studentId');
      try {
        await updateDoc(doc(db, 'gfy_students', studentId), { status: 'studying' });
      } catch (e) { /* ignore */ }
    }

    return studyState;
  });

  ipcMain.handle('stopStudying', async () => {
    if (studyTimer) { clearInterval(studyTimer); studyTimer = null; }

    const duration = studyState.elapsedSeconds;
    const durationMin = Math.round(duration / 60);

    // Save session to Firebase
    if (durationMin > 0) {
      const db = getDb();
      if (db) {
        const { doc, setDoc } = require('firebase/firestore');
        const studentId = store.get('studentId');
        const sessionId = 'session_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
        const today = new Date().toISOString().split('T')[0];

        try {
          await setDoc(doc(db, 'gfy_study_sessions', sessionId), {
            id: sessionId,
            studentId,
            startTime: new Date(studyState.startTime).toISOString(),
            endTime: new Date().toISOString(),
            durationMin,
            date: today,
          });
        } catch (e) {
          console.error('Failed to save study session:', e);
        }

        // Update status
        try {
          const { updateDoc: update } = require('firebase/firestore');
          await update(doc(db, 'gfy_students', studentId), { status: 'online' });
        } catch (e) { /* ignore */ }
      }
    }

    studyState = { isStudying: false, isBreak: false, isIdle: false, startTime: null, elapsedSeconds: 0 };
    store.set('studyState', studyState);

    await forceSyncNow(store);
    return { durationMin };
  });

  ipcMain.handle('startBreak', async () => {
    studyState.isBreak = true;
    store.set('studyState', studyState);

    const db = getDb();
    if (db) {
      const { doc, updateDoc } = require('firebase/firestore');
      const studentId = store.get('studentId');
      try { await updateDoc(doc(db, 'gfy_students', studentId), { status: 'break' }); } catch (e) {}
    }

    return studyState;
  });

  ipcMain.handle('resumeStudying', async () => {
    studyState.isBreak = false;
    store.set('studyState', studyState);

    const db = getDb();
    if (db) {
      const { doc, updateDoc } = require('firebase/firestore');
      const studentId = store.get('studentId');
      try { await updateDoc(doc(db, 'gfy_students', studentId), { status: 'studying' }); } catch (e) {}
    }

    return studyState;
  });

  ipcMain.handle('getStudyState', () => studyState);

  // ── Idle Check ────────────────────────────────────
  ipcMain.handle('respondToIdleCheck', (event, isHere) => {
    respondToIdleCheck(isHere, store, mainWindow);
    return { success: true };
  });

  // ── Messages ──────────────────────────────────────
  ipcMain.handle('getMessages', async () => {
    const db = getDb();
    if (!db) return [];
    try {
      const { collection, query, where, orderBy, getDocs } = require('firebase/firestore');
      const studentId = store.get('studentId');
      const q = query(
        collection(db, 'gfy_messages'),
        where('studentId', '==', studentId),
        orderBy('sentAt', 'desc')
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (error) {
      console.error('Error fetching messages:', error);
      return [];
    }
  });

  ipcMain.handle('markMessageRead', async (event, messageId) => {
    const db = getDb();
    if (!db) return { success: false };
    try {
      const { doc, updateDoc } = require('firebase/firestore');
      await updateDoc(doc(db, 'gfy_messages', messageId), {
        isRead: true,
        readAt: new Date().toISOString(),
      });
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  });

  // ── Activity ──────────────────────────────────────
  ipcMain.handle('getCurrentActivity', () => getCurrentActivity());

  // ── Window Controls ───────────────────────────────
  ipcMain.on('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.on('window:close', () => { if (mainWindow) mainWindow.hide(); });
}

module.exports = { setupIpcHandlers };
