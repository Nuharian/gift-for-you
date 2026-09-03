// Window Monitor — tracks which apps/tabs are open and which one is in use.
//
// A single long-lived PowerShell worker is polled over stdin instead of
// spawning powershell.exe on every tick. Accumulated time is written through
// to disk on every tick so a crash or restart never loses the day's totals.
const { spawn } = require('child_process');
const readline = require('readline');
const { app, powerMonitor } = require('electron');
const { ensureScriptFile } = require('./psScript');

const POLL_MS = 3000;
// Windows stops counting user input as activity after this many idle seconds.
const IDLE_THRESHOLD_SEC = 120;
const MAX_TITLE_ENTRIES = 400;

let psProc = null;
let psReady = false;
let pollTimer = null;
let restartTimer = null;
let pendingPoll = false;
let consecutiveFailures = 0;
let store = null;

let currentActivity = {
  activeApp: null,
  activeTitle: null,
  openWindows: [],
  totalWindows: 0,
  totalTabs: 0,
  browserWindows: [],
  isUserIdle: false,
  systemIdleSec: 0,
  timestamp: null,
};

// { [appName]: { appName, openMs, activeMs, lastTitle } }
let appTimers = {};
// { [appName|||title]: { appName, title, openMs, activeMs, lastSeen } }
let titleTimers = {};

let trackingDate = todayStr();
let lastTickAt = null;

const BROWSERS = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc', 'iexplore', 'librewolf', 'zen'];

function todayStr() {
  // Local date, not UTC — a student's "today" is their own calendar day.
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function isBrowser(appName) {
  const a = (appName || '').toLowerCase();
  return BROWSERS.some((b) => a.includes(b));
}

function titleKey(appName, title) {
  return appName + '|||' + title;
}

// ── Persistence ─────────────────────────────────────
// Totals live in the store keyed by date so restarting the app (or crashing)
// resumes the same day's counters rather than restarting them at zero.
function loadPersisted() {
  if (!store) return;
  const saved = store.get('usageTracking');
  if (saved && saved.date === trackingDate) {
    appTimers = saved.appTimers || {};
    titleTimers = saved.titleTimers || {};
  } else {
    appTimers = {};
    titleTimers = {};
  }
}

function persist() {
  if (!store) return;
  try {
    store.set('usageTracking', { date: trackingDate, appTimers, titleTimers });
  } catch (e) {
    // Disk full or file locked — keep running on in-memory data.
  }
}

function rollDateIfNeeded() {
  const today = todayStr();
  if (today !== trackingDate) {
    persist();
    trackingDate = today;
    appTimers = {};
    titleTimers = {};
    persist();
  }
}

// ── Accounting ──────────────────────────────────────
function accrue(windows, isUserIdle) {
  const now = Date.now();
  // The first tick after a start or resume has no interval to attribute, and a
  // long gap (sleep/hibernate) must not be credited as usage.
  const deltaMs = lastTickAt ? Math.min(now - lastTickAt, POLL_MS * 4) : 0;
  lastTickAt = now;
  if (deltaMs <= 0) return;

  const seen = new Set();
  for (const w of windows) {
    const key = w.appName;
    if (!appTimers[key]) {
      appTimers[key] = { appName: key, openMs: 0, activeMs: 0, lastTitle: w.windowTitle };
    }
    // Count an app's "open" time once per tick even when it has many windows.
    if (!seen.has(key)) {
      appTimers[key].openMs += deltaMs;
      seen.add(key);
    }
    appTimers[key].lastTitle = w.windowTitle;

    const tk = titleKey(w.appName, w.windowTitle);
    if (!titleTimers[tk]) {
      titleTimers[tk] = { appName: w.appName, title: w.windowTitle, openMs: 0, activeMs: 0, lastSeen: now };
    }
    titleTimers[tk].openMs += deltaMs;
    titleTimers[tk].lastSeen = now;
  }

  // Focused time only accrues while the student is actually at the keyboard,
  // otherwise a window left in front overnight would look like 8h of work.
  if (!isUserIdle) {
    const focused = windows.find((w) => w.isActive);
    if (focused) {
      appTimers[focused.appName].activeMs += deltaMs;
      titleTimers[titleKey(focused.appName, focused.windowTitle)].activeMs += deltaMs;
    }
  }

  pruneTitles();
}

// Browser titles churn constantly; keep the table bounded by dropping the
// least-used stale entries rather than letting it grow without limit.
function pruneTitles() {
  const keys = Object.keys(titleTimers);
  if (keys.length <= MAX_TITLE_ENTRIES) return;
  keys
    .sort((a, b) => {
      const ta = titleTimers[a];
      const tb = titleTimers[b];
      return (ta.activeMs - tb.activeMs) || (ta.openMs - tb.openMs) || (ta.lastSeen - tb.lastSeen);
    })
    .slice(0, keys.length - MAX_TITLE_ENTRIES)
    .forEach((k) => { delete titleTimers[k]; });
}

// ── Public accessors ────────────────────────────────
function getCurrentActivity() {
  return currentActivity;
}

function getAppUsageSummary() {
  return Object.values(appTimers)
    .map((t) => ({
      appName: t.appName,
      windowTitle: t.lastTitle || '',
      openSeconds: Math.round(t.openMs / 1000),
      activeSeconds: Math.round(t.activeMs / 1000),
    }))
    .filter((t) => t.openSeconds > 0 || t.activeSeconds > 0)
    .sort((a, b) => b.activeSeconds - a.activeSeconds || b.openSeconds - a.openSeconds);
}

// "Which tab is most open, which one is being worked on" — per window title.
function getTitleUsageSummary(limit = 25) {
  return Object.values(titleTimers)
    .map((t) => ({
      appName: t.appName,
      title: t.title,
      isBrowserTab: isBrowser(t.appName),
      openSeconds: Math.round(t.openMs / 1000),
      activeSeconds: Math.round(t.activeMs / 1000),
      lastSeen: new Date(t.lastSeen).toISOString(),
    }))
    .filter((t) => t.openSeconds > 0 || t.activeSeconds > 0)
    .sort((a, b) => b.activeSeconds - a.activeSeconds || b.openSeconds - a.openSeconds)
    .slice(0, limit);
}

function getTrackingDate() {
  return trackingDate;
}

function getTotals() {
  let openMs = 0;
  let activeMs = 0;
  for (const t of Object.values(appTimers)) {
    openMs += t.openMs;
    activeMs += t.activeMs;
  }
  return {
    date: trackingDate,
    totalOpenSeconds: Math.round(openMs / 1000),
    totalActiveSeconds: Math.round(activeMs / 1000),
  };
}

function resetAppTimers() {
  appTimers = {};
  titleTimers = {};
  lastTickAt = null;
  persist();
}

// ── PowerShell worker ───────────────────────────────
function startWorker(onSnapshot) {
  const scriptPath = ensureScriptFile(app.getPath('userData'));

  psProc = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { windowsHide: true }
  );

  psReady = false;
  const rl = readline.createInterface({ input: psProc.stdout });

  rl.on('line', (line) => {
    if (line === 'READY') {
      psReady = true;
      consecutiveFailures = 0;
      console.log('🖥️ Window monitor worker ready');
      return;
    }
    if (line.indexOf('DATA ') === 0) {
      pendingPoll = false;
      try {
        let rows = JSON.parse(line.slice(5));
        if (!Array.isArray(rows)) rows = [rows];
        onSnapshot(rows);
        consecutiveFailures = 0;
      } catch (e) {
        console.error('Monitor parse error:', e.message);
      }
      return;
    }
    if (line.indexOf('ERR ') === 0) {
      pendingPoll = false;
      console.error('Monitor worker error:', line.slice(4));
    }
  });

  psProc.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) console.error('Monitor stderr:', msg.slice(0, 300));
  });

  psProc.on('exit', (code) => {
    psReady = false;
    pendingPoll = false;
    psProc = null;
    if (restartTimer || !pollTimer) return; // stopped deliberately
    consecutiveFailures++;
    // Back off after repeated crashes so a broken host doesn't spin the CPU.
    const delay = Math.min(30000, 2000 * consecutiveFailures);
    console.warn('Monitor worker exited (' + code + '); restarting in ' + delay + 'ms');
    restartTimer = setTimeout(() => {
      restartTimer = null;
      startWorker(onSnapshot);
    }, delay);
  });

  psProc.on('error', (e) => {
    console.error('Failed to start monitor worker:', e.message);
  });
}

function requestPoll() {
  if (!psProc || !psReady) return;
  // A hung worker must not build up an unbounded backlog of POLL commands.
  if (pendingPoll) {
    pendingPoll = false;
    return;
  }
  pendingPoll = true;
  try {
    psProc.stdin.write('POLL\n');
  } catch (e) {
    pendingPoll = false;
  }
}

function handleSnapshot(rows, mainWindow) {
  rollDateIfNeeded();

  const windows = rows
    .filter((r) => r && r.t)
    .map((r) => ({
      appName: r.a || 'Unknown',
      windowTitle: String(r.t).slice(0, 300),
      pid: r.p,
      isActive: !!r.f,
      isMinimized: !!r.m,
    }));

  let systemIdleSec = 0;
  try {
    systemIdleSec = powerMonitor.getSystemIdleTime();
  } catch (e) {
    // Unsupported platform — treat as active.
  }
  const isUserIdle = systemIdleSec >= IDLE_THRESHOLD_SEC;

  accrue(windows, isUserIdle);
  persist();

  const focused = windows.find((w) => w.isActive);
  const browserWindows = windows.filter((w) => isBrowser(w.appName) && !w.isMinimized);

  currentActivity = {
    activeApp: focused ? focused.appName : null,
    activeTitle: focused ? focused.windowTitle : null,
    openWindows: windows,
    totalWindows: windows.length,
    // Each browser window's title is its foreground tab, so this counts the
    // browser tabs currently on screen — not every tab that exists.
    totalTabs: browserWindows.length,
    browserWindows: browserWindows.map((w) => ({ appName: w.appName, windowTitle: w.windowTitle })),
    isUserIdle,
    systemIdleSec,
    timestamp: new Date().toISOString(),
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('activity:update', currentActivity);
  }
}

function setupMonitoring(persistentStore, mainWindow) {
  if (pollTimer) return; // already running
  store = persistentStore;
  trackingDate = todayStr();
  loadPersisted();
  lastTickAt = null;

  startWorker((rows) => handleSnapshot(rows, mainWindow));

  pollTimer = setInterval(requestPoll, POLL_MS);
  setTimeout(requestPoll, 1200);

  console.log('🖥️ Window monitoring started');
}

function stopMonitoring() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  persist();
  if (psProc) {
    const proc = psProc;
    psProc = null;
    try { proc.stdin.write('QUIT\n'); } catch (e) { /* already gone */ }
    setTimeout(() => { try { proc.kill(); } catch (e) { /* already exited */ } }, 500);
  }
  psReady = false;
  console.log('🖥️ Window monitoring stopped');
}

module.exports = {
  setupMonitoring,
  stopMonitoring,
  getCurrentActivity,
  getAppUsageSummary,
  getTitleUsageSummary,
  getTrackingDate,
  getTotals,
  resetAppTimers,
  isBrowser,
  todayStr,
};
