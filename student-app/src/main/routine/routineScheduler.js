// Routine reminders.
//
// The teacher sends routines as tagged documents in gfy_messages; the message
// listener hands every routine here. Only routines the student accepted are
// scheduled. Each task produces two reminders on the days it applies: one when
// it starts (what to do, and for how long) and one when its time is up (what
// comes next).
//
// Reminders are checked against the wall clock on a short interval rather than
// with one long setTimeout per task, so sleep, hibernation and clock changes
// cannot leave a timer pointing at the wrong moment. Fired reminders are
// remembered in the store, so restarting the app never repeats one.
const { Notification } = require('electron');

const CHECK_INTERVAL_MS = 20 * 1000;
// A reminder that is this late (the PC was asleep, the app was closed) is
// skipped rather than delivered out of context.
const LATE_GRACE_MS = 3 * 60 * 1000;

let store = null;
let mainWindow = null;
let timer = null;
let routines = [];

function pad(n) { return String(n).padStart(2, '0'); }

function dateKey(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function toMinutes(hhmm) {
  const parts = String(hhmm || '').split(':').map(Number);
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  return parts[0] * 60 + parts[1];
}

function fromMinutes(total) {
  const t = ((total % 1440) + 1440) % 1440;
  return pad(Math.floor(t / 60)) + ':' + pad(t % 60);
}

function formatDuration(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
}

function appliesOn(routine, day) {
  const days = Array.isArray(routine.days) ? routine.days : [];
  return days.length === 0 || days.includes(day);
}

// Every accepted task for the given calendar day, earliest first.
function scheduleFor(date) {
  const day = date.getDay();
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const entries = [];

  for (const routine of routines) {
    if (routine.status !== 'accepted' || !appliesOn(routine, day)) continue;
    for (const task of routine.tasks || []) {
      const startMin = toMinutes(task.start);
      if (startMin === null) continue;
      const durationMin = Math.max(1, Math.round(Number(task.durationMin) || 0));
      entries.push({
        routineId: routine.id,
        routineTitle: routine.title || 'Daily routine',
        taskId: task.id || task.title,
        title: task.title || 'Task',
        note: task.note || '',
        start: fromMinutes(startMin),
        end: fromMinutes(startMin + durationMin),
        startMin,
        endMin: startMin + durationMin,
        durationMin,
        startMs: midnight + startMin * 60000,
        endMs: midnight + (startMin + durationMin) * 60000,
        date: dateKey(date),
      });
    }
  }
  return entries.sort((a, b) => a.startMin - b.startMin);
}

function firedLog() {
  const log = (store && store.get('routineFired')) || {};
  // Keep only today and yesterday; older keys can never match again.
  const now = new Date();
  const keep = new Set([dateKey(now), dateKey(new Date(now.getTime() - 86400000))]);
  for (const key of Object.keys(log)) {
    if (!keep.has(key.split('|')[0])) delete log[key];
  }
  return log;
}

function check() {
  if (!routines.some((r) => r.status === 'accepted')) return;

  const nowMs = Date.now();
  const today = new Date();
  const yesterday = new Date(nowMs - 86400000);
  // Yesterday's schedule is included so a task that runs past midnight still
  // gets its time's-up reminder.
  const entries = [...scheduleFor(yesterday), ...scheduleFor(today)];
  const todays = entries.filter((e) => e.date === dateKey(today));
  const log = firedLog();
  let changed = false;

  for (const entry of entries) {
    const base = entry.date + '|' + entry.routineId + '|' + entry.taskId;

    if (nowMs >= entry.startMs && nowMs < entry.startMs + LATE_GRACE_MS && !log[base + '|start']) {
      log[base + '|start'] = true;
      changed = true;
      remind('start', entry, null);
    }

    if (nowMs >= entry.endMs && nowMs < entry.endMs + LATE_GRACE_MS && !log[base + '|end']) {
      log[base + '|end'] = true;
      changed = true;
      const next = todays.find((e) => e.startMs >= entry.endMs - 60000 && e !== entry) || null;
      remind('end', entry, next);
    }
  }

  if (changed && store) store.set('routineFired', log);
}

function remind(type, entry, next) {
  let title;
  let body;
  if (type === 'start') {
    title = '⏰ Time for: ' + entry.title;
    body = formatDuration(entry.durationMin) + ' · until ' + entry.end
      + (entry.note ? '\n' + entry.note : '');
  } else {
    title = '✅ Time\'s up: ' + entry.title;
    body = next
      ? 'Next: ' + next.title + ' at ' + next.start + ' (' + formatDuration(next.durationMin) + ')'
      : 'That was the last task for today. Well done! 🎉';
  }

  console.log('🗓️ Routine reminder:', title);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('routine:reminder', { type, title, body, task: entry, next });
    mainWindow.flashFrame(true);
  }

  try {
    if (Notification.isSupported()) {
      const notification = new Notification({ title, body, urgency: 'critical', silent: false });
      notification.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('routine:open');
        }
      });
      notification.show();
    }
  } catch (e) {
    // The in-app popup still carries the reminder.
  }
}

function init(persistentStore, window) {
  store = persistentStore;
  mainWindow = window;
  if (!timer) timer = setInterval(check, CHECK_INTERVAL_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

// Called with every routine the listener sees, newest first.
function setRoutines(list) {
  routines = Array.isArray(list) ? list : [];
  check();
}

function getRoutines() {
  return routines;
}

function getToday() {
  return scheduleFor(new Date());
}

module.exports = { init, stop, setRoutines, getRoutines, getToday };
