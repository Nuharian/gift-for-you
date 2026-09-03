// Data Sync — pushes activity and study time to Firestore.
//
// Three cadences, deliberately separated so the teacher sees a live clock
// without paying to rewrite heavy documents every few seconds:
//   heartbeat (10s)  → gfy_students/{id}           small: status + counters
//   live      (15s)  → gfy_app_usage/{id}__live     windows, top apps, top tabs
//   daily     (60s)  → gfy_app_usage/{id}__{date}   absolute day totals
//
// Every document is addressed by id, so none of this needs a composite index.
// They all live in collections the project's existing security rules already
// permit, so no rules deploy is needed for any of this to work.
const { getDb } = require('../firebase');
const {
  getCurrentActivity, getAppUsageSummary, getTitleUsageSummary,
  getTrackingDate, getTotals,
} = require('../monitor/windowMonitor');
const studyTracker = require('../study/studyTracker');

// Live state and day rollups are stored as fixed-id documents inside the
// usage collection, which keeps them index-free and inside the allowed rules.
const USAGE_COLLECTION = 'gfy_app_usage';

const HEARTBEAT_MS = 10000;
const LIVE_MS = 15000;
const DAILY_MS = 60000;
const HISTORY_MS = 120000;

let heartbeatTimer = null;
let liveTimer = null;
let dailyTimer = null;
let historyTimer = null;
let studentId = null;
let appVersion = '';
let store = null;
let online = true;
let lastError = null;
// History snapshots that could not be written yet (offline, transient error).
let pendingSnapshots = [];

function fs() {
  return require('firebase/firestore');
}

function liveDocId() {
  return studentId + '__live';
}

function dailyDocId(date) {
  return studentId + '__' + date;
}

function ready() {
  return !!getDb() && !!studentId;
}

function setOnline(value, error) {
  const changed = online !== value;
  online = value;
  lastError = error || null;
  if (changed) {
    console.log(value ? '☁️ Firebase sync online' : '⚠️ Firebase sync offline: ' + (error || 'unknown'));
  }
}

function getSyncStatus() {
  return { online, lastError, queued: pendingSnapshots.length };
}

// ── Heartbeat ───────────────────────────────────────
// The single most important write: it carries the live elapsed time, so the
// teacher's dashboard can show a running clock for every student.
async function pushHeartbeat() {
  if (!ready()) return;
  const db = getDb();
  const { doc, setDoc } = fs();
  const activity = getCurrentActivity();
  const study = studyTracker.getState();
  const totals = getTotals();

  const status = study.isStudying
    ? (study.isBreak ? 'break' : (study.isIdle || study.autoPaused ? 'idle' : 'studying'))
    : (activity.isUserIdle ? 'idle' : 'online');

  try {
    await setDoc(doc(db, 'gfy_students', studentId), {
      id: studentId,
      name: store.get('studentName') || '',
      isOnline: true,
      status,
      lastSeen: new Date().toISOString(),
      // Milliseconds since epoch — lets the dashboard detect a stale heartbeat
      // without parsing dates, and keep ticking the clock between writes.
      lastSeenMs: Date.now(),
      activeApp: activity.activeApp || null,
      activeTitle: activity.activeTitle || null,
      totalWindows: activity.totalWindows || 0,
      totalTabs: activity.totalTabs || 0,
      isUserIdle: !!activity.isUserIdle,
      // Live study clock.
      isStudying: !!study.isStudying,
      studyRunning: !!study.isRunning,
      currentSessionSeconds: study.elapsedSeconds || 0,
      todayStudySeconds: studyTracker.getTodayTotalSeconds(),
      todayActiveSeconds: totals.totalActiveSeconds || 0,
      todayScreenSeconds: totals.totalOpenSeconds || 0,
      date: totals.date,
      appVersion,
    }, { merge: true });
    setOnline(true);
  } catch (e) {
    setOnline(false, e.message);
  }
}

// ── Live document ───────────────────────────────────
async function pushLive() {
  if (!ready()) return;
  const db = getDb();
  const { doc, setDoc } = fs();
  const activity = getCurrentActivity();

  try {
    await setDoc(doc(db, USAGE_COLLECTION, liveDocId()), {
      studentId,
      name: store.get('studentName') || '',
      updatedAt: new Date().toISOString(),
      updatedAtMs: Date.now(),
      activeApp: activity.activeApp || null,
      activeTitle: activity.activeTitle || null,
      totalWindows: activity.totalWindows || 0,
      totalTabs: activity.totalTabs || 0,
      // Stored as an array of plain objects, capped so the document stays well
      // under Firestore's 1 MiB limit even with a very busy desktop.
      openWindows: (activity.openWindows || []).slice(0, 60).map((w) => ({
        appName: w.appName,
        windowTitle: w.windowTitle,
        isActive: !!w.isActive,
        isMinimized: !!w.isMinimized,
      })),
      browserTabs: (activity.browserWindows || []).slice(0, 40),
      topApps: getAppUsageSummary().slice(0, 15),
      topTitles: getTitleUsageSummary(20),
      docType: 'live',
    });
    setOnline(true);
  } catch (e) {
    setOnline(false, e.message);
  }
}

// ── Daily rollup ────────────────────────────────────
// Absolute totals for the day, not increments. The monitor persists its
// counters locally across restarts, so overwriting is always correct and a
// restart can never reset the teacher's view to zero.
async function pushDaily() {
  if (!ready()) return;
  const db = getDb();
  const { doc, setDoc } = fs();
  const date = getTrackingDate();
  const totals = getTotals();
  const study = studyTracker.getState();

  try {
    await setDoc(doc(db, USAGE_COLLECTION, dailyDocId(date)), {
      studentId,
      name: store.get('studentName') || '',
      date,
      updatedAt: new Date().toISOString(),
      totalScreenSeconds: totals.totalOpenSeconds || 0,
      totalActiveSeconds: totals.totalActiveSeconds || 0,
      studySeconds: studyTracker.getTodayTotalSeconds(),
      currentSessionSeconds: study.isStudying ? study.elapsedSeconds : 0,
      apps: getAppUsageSummary().slice(0, 40),
      titles: getTitleUsageSummary(40),
      docType: 'daily',
    }, { merge: true });
    setOnline(true);
  } catch (e) {
    setOnline(false, e.message);
  }
}

// ── History snapshots ───────────────────────────────
function collectSnapshot() {
  const activity = getCurrentActivity();
  if (!activity || !activity.timestamp) return;
  const study = studyTracker.getState();

  pendingSnapshots.push({
    timestamp: activity.timestamp,
    activeApp: activity.activeApp,
    activeTitle: activity.activeTitle,
    totalWindows: activity.totalWindows,
    totalTabs: activity.totalTabs,
    isStudying: !!study.isStudying,
    isIdle: !!activity.isUserIdle,
    studySeconds: study.elapsedSeconds || 0,
  });

  if (pendingSnapshots.length > 200) {
    pendingSnapshots = pendingSnapshots.slice(-200);
  }
}

async function flushSnapshots() {
  if (!ready() || pendingSnapshots.length === 0) return;
  const db = getDb();
  const { doc, writeBatch, collection } = fs();
  const batchItems = pendingSnapshots.slice(0, 100);

  try {
    const batch = writeBatch(db);
    for (const snap of batchItems) {
      const ref = doc(collection(db, 'gfy_activity'));
      batch.set(ref, { studentId, name: store.get('studentName') || '', ...snap });
    }
    await batch.commit();
    // Only drop what was actually written; anything queued meanwhile stays.
    pendingSnapshots = pendingSnapshots.slice(batchItems.length);
    setOnline(true);
  } catch (e) {
    // Keep the queue for the next attempt.
    setOnline(false, e.message);
  }
}

// ── Session records ─────────────────────────────────
async function saveSession(session) {
  if (!ready() || !session || session.seconds <= 0) return;
  const db = getDb();
  const { doc, setDoc } = fs();
  const id = 'session_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);

  try {
    await setDoc(doc(db, 'gfy_study_sessions', id), {
      id,
      studentId,
      name: store.get('studentName') || '',
      startTime: session.startedAt,
      endTime: session.endedAt,
      durationSeconds: session.seconds,
      // Kept for the existing dashboard views that read minutes.
      durationMin: Math.round(session.seconds / 60),
      date: session.date,
    });
    await pushDaily();
    setOnline(true);
  } catch (e) {
    setOnline(false, e.message);
  }
}

// ── Presence ────────────────────────────────────────
async function markOffline() {
  if (!ready()) return;
  const db = getDb();
  const { doc, setDoc } = fs();
  try {
    await setDoc(doc(db, 'gfy_students', studentId), {
      isOnline: false,
      status: 'offline',
      lastSeen: new Date().toISOString(),
      lastSeenMs: Date.now(),
    }, { merge: true });
  } catch (e) {
    // Shutting down anyway; the dashboard also ages out stale heartbeats.
  }
}

function setupDataSync(persistentStore, version) {
  store = persistentStore;
  studentId = store.get('studentId');
  appVersion = version || '';
  if (!studentId) return;

  stopDataSync();

  heartbeatTimer = setInterval(pushHeartbeat, HEARTBEAT_MS);
  liveTimer = setInterval(pushLive, LIVE_MS);
  dailyTimer = setInterval(pushDaily, DAILY_MS);
  historyTimer = setInterval(() => {
    collectSnapshot();
    flushSnapshots();
  }, HISTORY_MS);

  // Publish immediately so the teacher sees the student without waiting.
  pushHeartbeat();
  setTimeout(pushLive, 2500);
  setTimeout(pushDaily, 5000);

  console.log('🔄 Data sync started (heartbeat 10s / live 15s / daily 60s)');
}

function stopDataSync() {
  [heartbeatTimer, liveTimer, dailyTimer, historyTimer].forEach((t) => t && clearInterval(t));
  heartbeatTimer = liveTimer = dailyTimer = historyTimer = null;
}

async function forceSyncNow() {
  collectSnapshot();
  await Promise.allSettled([pushHeartbeat(), pushLive(), pushDaily(), flushSnapshots()]);
}

module.exports = {
  setupDataSync,
  stopDataSync,
  forceSyncNow,
  saveSession,
  markOffline,
  getSyncStatus,
};
