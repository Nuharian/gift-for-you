// Gift For You — Student App UI controller.
const ENCOURAGING_MESSAGES = [
  "You're doing great! 🌟",
  'Keep it up! 💪',
  'Focus mode: ON 🎯',
  'Amazing dedication! 🌈',
  "You're a star! ⭐",
  'Knowledge is power! 📖',
  'Proud of you! 💛',
  'Stay strong! 🦁',
  'Almost there! 🏁',
  'Brilliant work! ✨',
];

let currentPage = 'dashboard';
let messageIndex = 0;
let lastStudyState = { isStudying: false, isBreak: false, elapsedSeconds: 0, isRunning: false };
let lastActivity = null;
let unreadCount = 0;
let updateStatus = null;

// ─── Boot ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('btnMinimize').onclick = () => window.api.minimizeWindow();
  document.getElementById('btnClose').onclick = () => window.api.closeWindow();

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  document.getElementById('popupDismiss').onclick = dismissPopup;

  // Subscribe before the first render so nothing is missed during startup.
  window.api.onMessage(handleNewMessage);
  window.api.onMessagesSync(handleMessagesSync);
  window.api.onIdleCheck(handleIdleCheck);
  window.api.onIdleDetected(handleIdleDetected);
  window.api.onIdleResolved(handleIdleResolved);
  window.api.onStudyUpdate(handleStudyUpdate);
  window.api.onActivityUpdate(handleActivityUpdate);
  window.api.onConnectionStatus(handleConnectionStatus);
  window.api.onUpdateStatus(handleUpdateStatus);

  const isRegistered = await window.api.isRegistered();
  if (isRegistered) {
    lastStudyState = await window.api.getStudyState();
    showApp();
  } else {
    renderRegisterPage();
  }

  window.api.getUpdateStatus().then((s) => { updateStatus = s; });
});

// ─── Navigation ───────────────────────────────────
function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  switch (page) {
    case 'dashboard': renderDashboard(); break;
    case 'activity': renderActivityPage(); break;
    case 'messages': renderMessagesPage(); break;
    case 'settings': renderSettingsPage(); break;
  }
}

function showApp() {
  document.getElementById('bottomNav').style.display = 'flex';
  renderDashboard();
}

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Register Page ────────────────────────────────
function renderRegisterPage() {
  document.getElementById('bottomNav').style.display = 'none';
  const container = document.getElementById('appContainer');
  container.innerHTML = `
    <div class="register-page animate-fadeIn">
      <div class="register-icon">🎁</div>
      <h1 class="register-title"><span class="text-gradient">Gift For You</span></h1>
      <p class="register-subtitle">Welcome! Please enter your full name to start.</p>

      <div class="register-disclaimer card">
        <h3 style="font-size:13px;color:var(--accent-tertiary);margin-bottom:8px;">⚠️ Monitoring Disclosure</h3>
        <p style="font-size:11px;color:var(--text-muted);line-height:1.6;">
          This application monitors open apps, browser tab names, active window, and study time.
          Data is sent to your teacher's portal for real-time monitoring.
          The app starts automatically with Windows and keeps itself up to date.
        </p>
      </div>

      <div class="register-form">
        <input class="input" id="regName" type="text" placeholder="Enter your full name…" autocomplete="off" autofocus />
        <button class="btn btn-primary btn-lg btn-full" id="regSubmit" style="margin-top:20px;">
          Start Studying 🚀
        </button>
        <p class="register-error" id="regError" style="display:none;"></p>
      </div>
    </div>
  `;

  const submit = async () => {
    const btn = document.getElementById('regSubmit');
    const name = document.getElementById('regName').value.trim();

    if (!name) {
      showError('regError', 'Please enter your name to register.');
      return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ Registering...';

    const result = await window.api.register(name);

    if (result.success) {
      showApp();
    } else {
      showError('regError', result.error || 'Registration failed.');
      btn.disabled = false;
      btn.textContent = 'Start Studying 🚀';
    }
  };

  document.getElementById('regSubmit').onclick = submit;
  document.getElementById('regName').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}

// ─── Dashboard Page ───────────────────────────────
async function renderDashboard() {
  const container = document.getElementById('appContainer');
  const [profile, studyState, stats] = await Promise.all([
    window.api.getProfile(),
    window.api.getStudyState(),
    window.api.getStats(),
  ]);
  lastStudyState = studyState;

  container.innerHTML = `
    <div class="animate-fadeIn">
      <div style="text-align:center;margin-bottom:20px;">
        <h1 style="font-size:30px;font-weight:800;">
          <span class="text-gradient">Gift For You</span>
        </h1>
        <p style="font-size:17px;margin-top:6px;">
          ${getGreeting()}, <strong>${esc(profile.name || 'Student')}</strong>! 💛
        </p>
      </div>

      <div class="card" id="studyCard" style="margin-bottom:14px;">
        ${renderStudyTracker(studyState)}
      </div>

      <div class="stat-row" style="margin-bottom:14px;">
        <div class="card stat-tile">
          <div class="stat-tile-value" id="statToday">${formatShort(stats.todayStudySeconds)}</div>
          <div class="stat-tile-label">📚 Studied today</div>
        </div>
        <div class="card stat-tile">
          <div class="stat-tile-value" id="statScreen">${formatShort(stats.usage.totalActiveSeconds)}</div>
          <div class="stat-tile-label">🖱️ Active on PC</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:14px;">
        <h3 class="card-title">📊 Right now</h3>
        <div id="quickActivity" class="muted-sm">Starting monitor…</div>
      </div>

      <div class="card">
        <h3 class="card-title">🏆 Most used today</h3>
        <div id="topApps">${renderUsageBars(stats.topApps, 'appName', 5)}</div>
      </div>
    </div>
  `;

  bindStudyTrackerEvents();
  if (lastActivity) updateQuickActivity(lastActivity);
  else {
    const activity = await window.api.getCurrentActivity();
    if (activity) updateQuickActivity(activity);
  }
}

function renderStudyTracker(state) {
  if (state.isStudying && !state.isBreak) {
    const paused = !state.isRunning;
    return `
      <h2 class="card-title" style="font-size:16px;">
        ${paused ? '⏸️ Paused — are you there?' : '📖 Studying…'}
      </h2>
      <div style="text-align:center;margin:14px 0;">
        <span class="text-gradient ${paused ? 'timer-paused' : ''}" id="studyTimer"
              style="font-size:46px;font-weight:800;font-family:var(--font-mono);">
          ${formatTime(state.elapsedSeconds)}
        </span>
      </div>
      <p style="text-align:center;color:var(--text-secondary);font-size:13px;margin-bottom:14px;" id="encourageMsg">
        ${paused ? 'The clock pauses when you step away — move the mouse to resume.' : ENCOURAGING_MESSAGES[messageIndex]}
      </p>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-secondary" style="flex:1;" id="btnBreak">☕ Break</button>
        <button class="btn btn-danger" style="flex:1;" id="btnStop">✋ Stop</button>
      </div>
    `;
  }

  if (state.isBreak) {
    return `
      <h2 class="card-title" style="font-size:16px;">☕ Break time</h2>
      <p class="muted-sm">Relax, you earned it. Session so far:
        <strong id="studyTimer" style="font-family:var(--font-mono);">${formatTime(state.elapsedSeconds)}</strong>
      </p>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button class="btn btn-primary" style="flex:1;" id="btnResume">📖 Resume</button>
        <button class="btn btn-danger" style="flex:1;" id="btnStop">✋ Done</button>
      </div>
    `;
  }

  return `
    <h2 class="card-title" style="font-size:16px;">📚 Study time</h2>
    <p class="muted-sm" style="margin-bottom:14px;">Ready to study?</p>
    <button class="btn btn-primary btn-lg btn-full" id="btnStart">Yes, let's go! 🚀</button>
  `;
}

function bindStudyTrackerEvents() {
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.onclick = fn;
  };

  bind('btnStart', async () => { await window.api.startStudying(); renderDashboard(); });
  bind('btnBreak', async () => { await window.api.startBreak(); renderDashboard(); });
  bind('btnResume', async () => { await window.api.resumeStudying(); renderDashboard(); });
  bind('btnStop', async () => {
    const result = await window.api.stopStudying();
    await renderDashboard();
    if (result.durationSeconds > 0) {
      toast('Session saved: ' + formatShort(result.durationSeconds) + ' 🎉');
    }
  });
}

// Horizontal bars make "which one dominates" readable at a glance.
function renderUsageBars(items, labelKey, limit) {
  if (!items || items.length === 0) {
    return '<p class="muted-sm">Nothing tracked yet — give it a minute.</p>';
  }
  const top = items.slice(0, limit);
  const max = Math.max(...top.map((i) => i.activeSeconds || 0), 1);

  return top.map((item) => {
    const label = item[labelKey] || item.title || 'Unknown';
    const pct = Math.max(2, Math.round(((item.activeSeconds || 0) / max) * 100));
    return `
      <div class="usage-row">
        <div class="usage-row-head">
          <span class="usage-name" title="${esc(label)}">${esc(label)}</span>
          <span class="usage-time">${formatShort(item.activeSeconds)}</span>
        </div>
        <div class="usage-bar"><div class="usage-bar-fill" style="width:${pct}%"></div></div>
      </div>
    `;
  }).join('');
}

// ─── Activity Page ────────────────────────────────
async function renderActivityPage() {
  const container = document.getElementById('appContainer');
  const [activity, titles] = await Promise.all([
    window.api.getCurrentActivity(),
    window.api.getTitleUsage(),
  ]);

  container.innerHTML = `
    <div class="animate-fadeIn">
      <h2 style="font-size:18px;font-weight:700;margin-bottom:14px;">🖥️ Activity monitor</h2>

      <div class="card" style="margin-bottom:12px;">
        <h3 class="card-title">CURRENTLY ACTIVE</h3>
        <p style="font-size:14px;font-weight:600;" id="activeWindowTitle">
          ${activity && activity.activeApp
            ? esc(activity.activeApp) + ' — ' + esc(activity.activeTitle)
            : 'Nothing detected'}
        </p>
      </div>

      <div class="card" style="margin-bottom:12px;">
        <h3 class="card-title">⏱️ MOST-USED TABS &amp; WINDOWS TODAY</h3>
        <div id="titleUsage">${renderUsageBars(titles, 'title', 8)}</div>
      </div>

      <div class="card">
        <h3 class="card-title">
          ALL OPEN WINDOWS (<span id="windowCount">${(activity && activity.totalWindows) || 0}</span>)
        </h3>
        <div id="windowsList" style="font-size:12px;">
          ${renderWindowsList((activity && activity.openWindows) || [])}
        </div>
      </div>
    </div>
  `;
}

function renderWindowsList(windows) {
  if (!windows || windows.length === 0) {
    return '<p class="muted-sm">No windows detected</p>';
  }
  return windows.map((w) => `
    <div class="window-row${w.isActive ? ' window-row-active' : ''}">
      <span class="window-app">${w.isActive ? '▶ ' : ''}${esc(w.appName)}</span>
      <span class="window-title">${esc(w.windowTitle)}</span>
    </div>
  `).join('');
}

// ─── Messages Page ────────────────────────────────
async function renderMessagesPage() {
  const container = document.getElementById('appContainer');
  const messages = await window.api.getMessages();

  container.innerHTML = `
    <div class="animate-fadeIn">
      <h2 style="font-size:18px;font-weight:700;margin-bottom:14px;">💬 Messages</h2>

      <div class="card reply-card">
        <h3 class="card-title">✍️ Reply to your teacher</h3>
        <textarea class="input" id="replyBox" rows="2" placeholder="Type a message…"></textarea>
        <button class="btn btn-primary btn-full" id="btnReply" style="margin-top:8px;">Send 📨</button>
        <p class="muted-sm" id="replyStatus" style="margin-top:6px;display:none;"></p>
      </div>

      <div id="messageList">${renderMessageList(messages)}</div>
    </div>
  `;

  document.getElementById('btnReply').onclick = async () => {
    const box = document.getElementById('replyBox');
    const btn = document.getElementById('btnReply');
    const text = box.value.trim();
    if (!text) return;

    btn.disabled = true;
    btn.textContent = '⏳ Sending…';
    const result = await window.api.replyToTeacher(text);
    btn.disabled = false;
    btn.textContent = 'Send 📨';

    const status = document.getElementById('replyStatus');
    status.style.display = 'block';
    if (result.success) {
      box.value = '';
      status.textContent = '✅ Sent to your teacher';
      renderMessagesPage();
    } else {
      status.textContent = '⚠️ ' + (result.error || 'Could not send. Check your connection.');
    }
  };

  // Opening the tab is the read receipt.
  for (const msg of messages) {
    if (!msg.isRead && msg.from !== 'student') await window.api.markMessageRead(msg.id);
  }
  setUnread(0);
}

function renderMessageList(messages) {
  if (!messages || messages.length === 0) {
    return `
      <div class="card" style="text-align:center;padding:32px;">
        <span style="font-size:40px;">📭</span>
        <p class="muted-sm" style="margin-top:8px;">No messages yet</p>
      </div>
    `;
  }

  return messages.map((msg) => {
    const mine = msg.from === 'student';
    return `
      <div class="card msg-card${mine ? ' msg-card-mine' : ''}"
           style="border-left:3px solid ${esc(msg.color || '#FFE5D9')};">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <span style="font-size:26px;">${esc(msg.emoji || '💛')}</span>
          <div style="flex:1;min-width:0;">
            ${msg.title ? `<h3 class="msg-card-title">${esc(msg.title)}</h3>` : ''}
            <p class="msg-card-body">${esc(msg.body || '')}</p>
            <span class="msg-card-meta">
              ${mine ? 'You · ' : 'Teacher · '}${formatWhen(msg.sentAt)}
              ${!mine ? (msg.isRead ? ' · ✅ Read' : ' · 📬 New') : ''}
            </span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ─── Settings Page ────────────────────────────────
async function renderSettingsPage() {
  const container = document.getElementById('appContainer');
  const [profile, settings, stats, update] = await Promise.all([
    window.api.getProfile(),
    window.api.getSettings(),
    window.api.getStats(),
    window.api.getUpdateStatus(),
  ]);
  updateStatus = update;

  container.innerHTML = `
    <div class="animate-fadeIn">
      <h2 style="font-size:18px;font-weight:700;margin-bottom:14px;">⚙️ Settings</h2>

      <div class="card" style="margin-bottom:12px;">
        <h3 class="card-title">PROFILE</h3>
        <p style="font-size:16px;font-weight:600;">${esc(profile.name)}</p>
        <p class="muted-xs">ID: ${esc(profile.id)}</p>
      </div>

      <div class="card" style="margin-bottom:12px;">
        <h3 class="card-title">PREFERENCES</h3>
        <label class="toggle-row">
          <span>Start automatically with Windows</span>
          <input type="checkbox" id="setAutoStart" ${settings.autoStart ? 'checked' : ''} />
        </label>
        <label class="toggle-row">
          <span>Start hidden in the tray</span>
          <input type="checkbox" id="setStartMinimized" ${settings.startMinimized ? 'checked' : ''} />
        </label>
        <label class="toggle-row">
          <span>Sound on new message</span>
          <input type="checkbox" id="setSound" ${settings.soundEnabled ? 'checked' : ''} />
        </label>
      </div>

      <div class="card" style="margin-bottom:12px;">
        <h3 class="card-title">SYNC</h3>
        <p style="font-size:13px;color:${stats.sync.online ? 'var(--accent-primary)' : 'var(--accent-tertiary)'};">
          ${stats.sync.online ? '🟢 Connected — data is reaching your teacher' : '🟠 Reconnecting…'}
        </p>
        <p class="muted-xs">Today: ${formatShort(stats.todayStudySeconds)} studied · ${formatShort(stats.usage.totalActiveSeconds)} active</p>
        <button class="btn btn-secondary btn-full" id="btnSyncNow" style="margin-top:10px;">🔄 Sync now</button>
      </div>

      <div class="card" style="margin-bottom:12px;">
        <h3 class="card-title">UPDATES</h3>
        <p style="font-size:13px;">Gift For You <strong>v${esc(profile.version)}</strong></p>
        <p class="muted-xs" id="updateMessage">${esc(describeUpdate(update))}</p>
        <div class="update-progress" id="updateProgress" style="display:${update.state === 'downloading' ? 'block' : 'none'};">
          <div class="update-progress-fill" id="updateProgressFill" style="width:${update.percent || 0}%"></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button class="btn btn-secondary" style="flex:1;" id="btnCheckUpdate">⬆️ Check for updates</button>
          <button class="btn btn-primary" style="flex:1;display:${update.state === 'ready' ? 'block' : 'none'};" id="btnInstallUpdate">
            Restart &amp; install
          </button>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">ABOUT</h3>
        <p class="muted-sm">This app runs in the background, auto-starts with Windows, and updates itself.</p>
      </div>
    </div>
  `;

  const toggle = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.onchange = () => window.api.setSetting(key, el.checked);
  };
  toggle('setAutoStart', 'autoStart');
  toggle('setStartMinimized', 'startMinimized');
  toggle('setSound', 'soundEnabled');

  document.getElementById('btnSyncNow').onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = '⏳ Syncing…';
    await window.api.syncNow();
    e.target.textContent = '✅ Synced';
    setTimeout(() => { e.target.disabled = false; e.target.textContent = '🔄 Sync now'; }, 1500);
  };

  document.getElementById('btnCheckUpdate').onclick = () => window.api.checkForUpdates();
  document.getElementById('btnInstallUpdate').onclick = () => window.api.installUpdate();
}

function describeUpdate(status) {
  if (!status) return '';
  switch (status.state) {
    case 'checking': return 'Checking for updates…';
    case 'downloading': return 'Downloading update… ' + (status.percent || 0) + '%';
    case 'ready': return 'Version ' + status.latestVersion + ' is ready — restart to install.';
    case 'uptodate': return 'You are on the latest version.';
    case 'unsupported': return status.message || 'Updates are not available in this build.';
    case 'error': return 'Update check failed: ' + status.message;
    default: return 'Updates install automatically in the background.';
  }
}

// ─── Event Handlers ───────────────────────────────
function handleNewMessage(message) {
  const popup = document.getElementById('messagePopup');
  const card = document.getElementById('messagePopupCard');
  document.getElementById('popupEmoji').textContent = message.emoji || '💛';
  document.getElementById('popupTitle').textContent = message.title || 'New message';
  document.getElementById('popupBody').textContent = message.body || '';
  card.style.borderColor = message.color || '#FFE5D9';
  card.dataset.msgid = message.id || '';
  popup.style.display = 'flex';

  playChime();
  setUnread(unreadCount + 1);
}

function dismissPopup() {
  const popup = document.getElementById('messagePopup');
  const id = document.getElementById('messagePopupCard').dataset.msgid;
  popup.style.display = 'none';
  if (id) window.api.markMessageRead(id);
}

function handleMessagesSync(data) {
  setUnread(data.unread || 0);
  if (currentPage === 'messages') {
    const list = document.getElementById('messageList');
    if (list) list.innerHTML = renderMessageList(data.messages);
  }
}

// A short WebAudio chime avoids shipping an audio file that may be missing.
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.4);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch (e) {
    // Audio is optional.
  }
}

function setUnread(count) {
  unreadCount = Math.max(0, count);
  const badge = document.getElementById('msgBadge');
  badge.textContent = String(unreadCount);
  badge.style.display = unreadCount > 0 ? 'flex' : 'none';
}

function handleIdleCheck() {
  console.log('Presence check triggered');
}

function handleIdleDetected() {
  if (currentPage === 'dashboard') renderDashboard();
}

function handleIdleResolved() {
  if (currentPage === 'dashboard') renderDashboard();
}

function handleStudyUpdate(state) {
  const wasRunning = lastStudyState.isRunning;
  lastStudyState = state;

  const timer = document.getElementById('studyTimer');
  if (timer) timer.textContent = formatTime(state.elapsedSeconds);

  // The pause banner and buttons change, so re-render on a state flip only.
  if (currentPage === 'dashboard' && wasRunning !== state.isRunning) renderDashboard();
}

function handleActivityUpdate(activity) {
  lastActivity = activity;
  updateQuickActivity(activity);

  const activeTitle = document.getElementById('activeWindowTitle');
  if (activeTitle && activity) {
    activeTitle.textContent = activity.activeApp
      ? activity.activeApp + ' — ' + activity.activeTitle
      : 'Nothing detected';
  }

  const windowsList = document.getElementById('windowsList');
  if (windowsList && activity && activity.openWindows) {
    windowsList.innerHTML = renderWindowsList(activity.openWindows);
    const count = document.getElementById('windowCount');
    if (count) count.textContent = activity.totalWindows;
  }
}

function handleConnectionStatus(data) {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if (data.connected) {
    dot.classList.add('connected');
    text.textContent = 'Connected — syncing with your teacher';
  } else {
    dot.classList.remove('connected');
    text.textContent = data.error ? 'Reconnecting…' : 'Connecting…';
  }
}

function handleUpdateStatus(status) {
  updateStatus = status;
  const msg = document.getElementById('updateMessage');
  if (msg) msg.textContent = describeUpdate(status);

  const progress = document.getElementById('updateProgress');
  const fill = document.getElementById('updateProgressFill');
  if (progress && fill) {
    progress.style.display = status.state === 'downloading' ? 'block' : 'none';
    fill.style.width = (status.percent || 0) + '%';
  }

  const install = document.getElementById('btnInstallUpdate');
  if (install) install.style.display = status.state === 'ready' ? 'block' : 'none';

  if (status.state === 'ready') toast('Update ready — restart to install ⬆️');
}

function updateQuickActivity(activity) {
  const el = document.getElementById('quickActivity');
  if (!el || !activity) return;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
      <span>Active: <strong style="color:var(--text-primary);">${esc(activity.activeApp || 'None')}</strong></span>
      <span>🪟 ${activity.totalWindows || 0} · 🌐 ${activity.totalTabs || 0}</span>
    </div>
    <div class="truncate" style="color:var(--text-muted);">${esc(activity.activeTitle || '')}</div>
  `;
}

// ─── Utilities ────────────────────────────────────
function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

function formatShort(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  if (s < 60) return s + 's';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return m + 'm';
  return h + 'h ' + m + 'm';
}

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return diffMin + 'm ago';
  if (diffMin < 60 * 24) return Math.floor(diffMin / 60) + 'h ago';
  return d.toLocaleDateString();
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function showError(elementId, message) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
    el.style.display = 'block';
  }
}

function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('toast-show');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove('toast-show'), 3200);
}

// Rotate the encouragement line, and refresh the day's totals periodically.
setInterval(() => {
  messageIndex = (messageIndex + 1) % ENCOURAGING_MESSAGES.length;
  const el = document.getElementById('encourageMsg');
  if (el && lastStudyState.isRunning) el.textContent = ENCOURAGING_MESSAGES[messageIndex];
}, 3 * 60 * 1000);

setInterval(async () => {
  if (currentPage !== 'dashboard') return;
  const stats = await window.api.getStats();
  const today = document.getElementById('statToday');
  const screen = document.getElementById('statScreen');
  const topApps = document.getElementById('topApps');
  if (today) today.textContent = formatShort(stats.todayStudySeconds);
  if (screen) screen.textContent = formatShort(stats.usage.totalActiveSeconds);
  if (topApps) topApps.innerHTML = renderUsageBars(stats.topApps, 'appName', 5);
}, 20000);
