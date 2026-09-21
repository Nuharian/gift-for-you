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
const { getDb, reinitFirebase } = require('../firebase');
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

// A Firestore write that cannot reach the backend does not reject: the SDK
// queues it and leaves the promise pending forever. Without a deadline a
// single wedged write would keep its slot busy for the rest of the session,
// which is exactly how a student silently stops reporting while their app
// still looks fine. Anything slower than this is treated as a failure.
const WRITE_TIMEOUT_MS = 20000;

// Once writes have failed for this long, the connection itself is suspect and
// the client is rebuilt rather than retried forever.
const STALL_RECOVERY_MS = 5 * 60 * 1000;
// Never rebuild more often than this, so a genuine outage does not thrash.
const MIN_REBUILD_GAP_MS = 5 * 60 * 1000;

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
// A push already in flight; its interval skips rather than stacking another.
const inFlight = { heartbeat: false, live: false, daily: false, history: false };
let lastSuccessMs = Date.now();
let lastRebuildMs = 0;
let rebuilding = false;

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
  if (value) lastSuccessMs = Date.now();
  if (changed) {
    console.log(value ? '☁️ Firebase sync online' : '⚠️ Firebase sync offline: ' + (error || 'unknown'));
  }
}

function getSyncStatus() {
  return {
    online,
    lastError,
    queued: pendingSnapshots.length,
    lastSuccessMs,
    secondsSinceSuccess: Math.round((Date.now() - lastSuccessMs) / 1000),
  };
}

// Puts a deadline on a Firestore write so a stalled connection surfaces as a
// failure instead of a promise that never settles.
function withTimeout(promise, label) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' write timed out')), WRITE_TIMEOUT_MS);
    }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

// Rebuilds the client when nothing has been written successfully for a while.
// Runs off the back of the heartbeat, which is the most frequent writer.
async function recoverIfStalled() {
  if (rebuilding || online) return;
  const now = Date.now();
  if (now - lastSuccessMs < STALL_RECOVERY_MS) return;
  if (now - lastRebuildMs < MIN_REBUILD_GAP_MS) return;

  rebuilding = true;
  lastRebuildMs = now;
  try {
    console.warn('⚠️ No successful sync for '
      + Math.round((now - lastSuccessMs) / 1000) + 's — rebuilding Firebase client');
    await reinitFirebase();
  } catch (e) {
    console.error('Sync recovery failed:', e.message);
  } finally {
    rebuilding = false;
  }
}

// ── Heartbeat ───────────────────────────────────────
// The single most important write: it carries the live elapsed time, so the
// teacher's dashboard can show a running clock for every student.
async function pushHeartbeat() {
  if (!ready() || inFlight.heartbeat) return;
  inFlight.heartbeat = true;

  // The monitor reads live desktop state, so gathering it is as failure-prone
  // as the write itself and belongs inside the same guard. When this sat
  // outside the try, one bad read threw out of the interval callback, and with
  // no unhandledRejection handler that took the whole app down mid-session.
  try {
    const db = getDb();
    const { doc, setDoc } = fs();
    const activity = getCurrentActivity() || {};
    const study = studyTracker.getState() || {};
    const totals = getTotals() || {};

    const status = study.isStudying
      ? (study.isBreak ? 'break' : (study.isIdle || study.autoPaused ? 'idle' : 'studying'))
      : (activity.isUserIdle ? 'idle' : 'online');

    await withTimeout(setDoc(doc(db, 'gfy_students', studentId), {
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
    }, { merge: true }), 'heartbeat');
    setOnline(true);
  } catch (e) {
    setOnline(false, e.message);
    // The heartbeat is the most frequent writer, so it carries the watchdog.
    recoverIfStalled();
  } finally {
    inFlight.heartbeat = false;
  }
}

// ── Live document ───────────────────────────────────
async function pushLive() {
  if (!ready() || inFlight.live) return;
  inFlight.live = true;

  try {
    const db = getDb();
    const { doc, setDoc } = fs();
    const activity = getCurrentActivity() || {};

    await withTimeout(setDoc(doc(db, USAGE_COLLECTION, liveDocId()), {
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
    }), 'live');
    setOnline(true);
  } catch (e) {
    setOnline(false, e.message);
  } finally {
    inFlight.live = false;
  }
}

// ── Daily rollup ────────────────────────────────────
// Absolute totals for the day, not increments. The monitor persists its
// counters locally across restarts, so overwriting is always correct and a
// restart can never reset the teacher's view to zero.
async function pushDaily() {
  if (!ready() || inFlight.daily) return;
  inFlight.daily = true;

  try {
    const db = getDb();
    const { doc, setDoc } = fs();
    const date = getTrackingDate();
    const totals = getTotals() || {};
    const study = studyTracker.getState() || {};

    await withTimeout(setDoc(doc(db, USAGE_COLLECTION, dailyDocId(date)), {
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
    }, { merge: true }), 'daily');
    setOnline(true);
  } catch (e) {
    setOnline(false, e.message);
  } finally {
    inFlight.daily = false;
  }
}

// ── History snapshots ───────────────────────────────
function collectSnapshot() {
  try {
    const activity = getCurrentActivity();
    if (!activity || !activity.timestamp) return;
    const study = studyTracker.getState() || {};

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
  } catch (e) {
    // A snapshot is history, not state; losing one must never stop the timer.
    console.error('Snapshot collection failed:', e.message);
  }
}

async function flushSnapshots() {
  if (!ready() || inFlight.history || pendingSnapshots.length === 0) return;
  inFlight.history = true;

  try {
    const db = getDb();
    const { doc, writeBatch, collection } = fs();
    const batchItems = pendingSnapshots.slice(0, 100);

    const batch = writeBatch(db);
    for (const snap of batchItems) {
      const ref = doc(collection(db, 'gfy_activity'));
      batch.set(ref, { studentId, name: store.get('studentName') || '', ...snap });
    }
    await withTimeout(batch.commit(), 'history');
    // Only drop what was actually written; anything queued meanwhile stays.
    pendingSnapshots = pendingSnapshots.slice(batchItems.length);
    setOnline(true);
  } catch (e) {
    // Keep the queue for the next attempt.
    setOnline(false, e.message);
  } finally {
    inFlight.history = false;
  }
}

// ── Session records ─────────────────────────────────
async function saveSession(session) {
  if (!ready() || !session || session.seconds <= 0) return;
  const db = getDb();
  const { doc, setDoc } = fs();
  const id = 'session_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);

  try {
    await withTimeout(setDoc(doc(db, 'gfy_study_sessions', id), {
      id,
      studentId,
      name: store.get('studentName') || '',
      startTime: session.startedAt,
      endTime: session.endedAt,
      durationSeconds: session.seconds,
      // Kept for the existing dashboard views that read minutes.
      durationMin: Math.round(session.seconds / 60),
      date: session.date,
    }), 'session');
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
    await withTimeout(setDoc(doc(db, 'gfy_students', studentId), {
      isOnline: false,
      status: 'offline',
      lastSeen: new Date().toISOString(),
      lastSeenMs: Date.now(),
    }, { merge: true }), 'offline');
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

  // Timers are the app's lifeline to the dashboard; a rejection escaping one
  // of them must never be able to end the process.
  lastSuccessMs = Date.now();

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
