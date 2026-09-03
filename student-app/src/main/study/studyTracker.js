// Study Tracker — owns the study clock.
//
// The elapsed count is derived from wall-clock timestamps rather than from a
// counter incremented once a second, so a stalled or throttled timer (which
// Electron does to background windows) can never lose time. State is persisted
// on every tick, so closing or crashing the app resumes the same session.
const { powerMonitor } = require('electron');

const TICK_MS = 1000;
const PERSIST_EVERY_TICKS = 10;
// Auto-pause the clock once the machine has had no input for this long.
const AUTO_PAUSE_IDLE_SEC = 180;
// A "session" left running longer than this without input is stale (e.g. the
// student shut the lid); it is closed out rather than counted.
const MAX_SESSION_GAP_MS = 6 * 60 * 60 * 1000;

let store = null;
let mainWindow = null;
let tickTimer = null;
let tickCount = 0;
let onSessionEnd = null;

// accumulatedMs = time banked before the current running segment.
// segmentStart  = when the current running segment began (null when paused).
let state = {
  isStudying: false,
  isBreak: false,
  isIdle: false,
  autoPaused: false,
  startedAt: null,
  accumulatedMs: 0,
  segmentStart: null,
  date: null,
};

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function elapsedMs() {
  let ms = state.accumulatedMs;
  if (state.segmentStart) ms += Date.now() - state.segmentStart;
  return ms;
}

function publicState() {
  return {
    isStudying: state.isStudying,
    isBreak: state.isBreak,
    isIdle: state.isIdle,
    autoPaused: state.autoPaused,
    startedAt: state.startedAt,
    elapsedSeconds: Math.floor(elapsedMs() / 1000),
    isRunning: !!state.segmentStart,
    date: state.date,
  };
}

function persist() {
  if (!store) return;
  try {
    store.set('studySession', state);
    // Kept for the sync layer, which reads a flat snapshot.
    store.set('studyState', publicState());
  } catch (e) {
    // Non-fatal: the in-memory clock keeps running.
  }
}

function emit() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('study:update', publicState());
  }
}

// ── Day totals ──────────────────────────────────────
// Completed session minutes per day, so "today's total" survives restarts and
// the dashboard can show it without querying Firestore.
function addToDayTotal(seconds) {
  if (!store || seconds <= 0) return;
  const date = todayStr();
  const totals = store.get('studyDayTotals') || {};
  totals[date] = (totals[date] || 0) + seconds;
  // Keep about two months of history; the dashboard holds the rest.
  const keys = Object.keys(totals).sort();
  while (keys.length > 60) delete totals[keys.shift()];
  store.set('studyDayTotals', totals);
}

function getTodayTotalSeconds() {
  if (!store) return 0;
  const totals = store.get('studyDayTotals') || {};
  const banked = totals[todayStr()] || 0;
  // Include the session in progress so the number moves while studying.
  const live = state.isStudying && state.date === todayStr() ? Math.floor(elapsedMs() / 1000) : 0;
  return banked + live;
}

function getDayTotals() {
  return (store && store.get('studyDayTotals')) || {};
}

// ── Clock ───────────────────────────────────────────
function pauseSegment() {
  if (!state.segmentStart) return;
  state.accumulatedMs += Date.now() - state.segmentStart;
  state.segmentStart = null;
}

function resumeSegment() {
  if (state.segmentStart) return;
  state.segmentStart = Date.now();
}

function shouldRun() {
  return state.isStudying && !state.isBreak && !state.isIdle && !state.autoPaused;
}

function syncSegment() {
  if (shouldRun()) resumeSegment();
  else pauseSegment();
}

function tick() {
  if (!state.isStudying) return;

  // Auto-pause on real inactivity, and resume as soon as input returns.
  let idleSec = 0;
  try {
    idleSec = powerMonitor.getSystemIdleTime();
  } catch (e) {
    // Unsupported platform — never auto-pause.
  }

  const shouldAutoPause = idleSec >= AUTO_PAUSE_IDLE_SEC;
  if (shouldAutoPause !== state.autoPaused) {
    state.autoPaused = shouldAutoPause;
    // The idle stretch that triggered the pause was not study time.
    if (shouldAutoPause && state.segmentStart) {
      const overshoot = Math.min(idleSec * 1000, Date.now() - state.segmentStart);
      state.accumulatedMs += (Date.now() - state.segmentStart) - overshoot;
      state.segmentStart = null;
    }
    syncSegment();
    persist();
    emit();
    return;
  }

  syncSegment();
  emit();

  if (++tickCount % PERSIST_EVERY_TICKS === 0) persist();
}

function startTicking() {
  if (tickTimer) return;
  tickTimer = setInterval(tick, TICK_MS);
}

function stopTicking() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

// ── Public API ──────────────────────────────────────
function init(persistentStore, window, sessionEndCallback) {
  store = persistentStore;
  mainWindow = window;
  onSessionEnd = sessionEndCallback;

  const saved = store.get('studySession');
  if (saved && saved.isStudying) {
    const since = saved.segmentStart || saved.startedAt || 0;
    if (Date.now() - since > MAX_SESSION_GAP_MS) {
      // The app was closed for a long time mid-session — bank what was
      // definitely studied and start fresh rather than inventing hours.
      const banked = Math.floor((saved.accumulatedMs || 0) / 1000);
      if (banked > 0) addToDayTotal(banked);
      state = { ...state, isStudying: false, accumulatedMs: 0, segmentStart: null, startedAt: null, date: null };
    } else {
      state = { ...saved, segmentStart: null, autoPaused: false };
      // Time while the app was closed is not study time, so the clock resumes
      // from the banked total rather than from the old segment start.
      state.date = state.date || todayStr();
      syncSegment();
      startTicking();
      console.log('📚 Resumed study session at ' + Math.floor(elapsedMs() / 1000) + 's');
    }
  }
  persist();
}

function setWindow(window) {
  mainWindow = window;
}

function start() {
  state = {
    isStudying: true,
    isBreak: false,
    isIdle: false,
    autoPaused: false,
    startedAt: new Date().toISOString(),
    accumulatedMs: 0,
    segmentStart: Date.now(),
    date: todayStr(),
  };
  tickCount = 0;
  startTicking();
  persist();
  emit();
  return publicState();
}

function stop() {
  pauseSegment();
  const seconds = Math.floor(elapsedMs() / 1000);
  const startedAt = state.startedAt;
  const date = state.date || todayStr();

  stopTicking();
  if (seconds > 0) addToDayTotal(seconds);

  state = {
    isStudying: false,
    isBreak: false,
    isIdle: false,
    autoPaused: false,
    startedAt: null,
    accumulatedMs: 0,
    segmentStart: null,
    date: null,
  };
  persist();
  emit();

  const session = { seconds, startedAt, endedAt: new Date().toISOString(), date };
  if (seconds > 0 && onSessionEnd) onSessionEnd(session);
  return session;
}

function startBreak() {
  state.isBreak = true;
  syncSegment();
  persist();
  emit();
  return publicState();
}

function resume() {
  state.isBreak = false;
  state.isIdle = false;
  state.autoPaused = false;
  syncSegment();
  persist();
  emit();
  return publicState();
}

function setIdle(isIdle) {
  state.isIdle = !!isIdle;
  syncSegment();
  persist();
  emit();
  return publicState();
}

function getState() {
  return publicState();
}

module.exports = {
  init,
  setWindow,
  start,
  stop,
  startBreak,
  resume,
  setIdle,
  getState,
  getTodayTotalSeconds,
  getDayTotals,
  todayStr,
  stopTicking,
};
