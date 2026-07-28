// Gift For You — Student App Main UI Controller
const ENCOURAGING_MESSAGES = [
  "You're doing great! 🌟",
  "Keep it up! 💪",
  "Focus mode: ON 🎯",
  "Amazing dedication! 🌈",
  "You're a star! ⭐",
  "Knowledge is power! 📖",
  "Proud of you! 💛",
  "Stay strong! 🦁",
  "Almost there! 🏁",
  "Brilliant work! ✨",
];

let currentPage = 'dashboard';
let messageIndex = 0;

// ─── Boot ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Window controls
  document.getElementById('btnMinimize').onclick = () => window.api.minimizeWindow();
  document.getElementById('btnClose').onclick = () => window.api.closeWindow();

  // Bottom nav
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  // Check if registered
  const isRegistered = await window.api.isRegistered();
  if (isRegistered) {
    showApp();
  } else {
    renderRegisterPage();
  }

  // Listen for events from main process
  window.api.onMessage(handleNewMessage);
  window.api.onIdleCheck(handleIdleCheck);
  window.api.onStudyUpdate(handleStudyUpdate);
  window.api.onActivityUpdate(handleActivityUpdate);
  window.api.onConnectionStatus(handleConnectionStatus);
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

// ─── Register Page (Clean: Name Only) ────────────
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
          The app starts automatically with Windows.
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

  document.getElementById('regSubmit').onclick = async () => {
    const name = document.getElementById('regName').value.trim();

    if (!name) {
      showError('regError', 'Please enter your name to register.');
      return;
    }

    document.getElementById('regSubmit').disabled = true;
    document.getElementById('regSubmit').textContent = '⏳ Registering...';

    const result = await window.api.register(name);

    if (result.success) {
      showApp();
    } else {
      showError('regError', result.error || 'Registration failed.');
      document.getElementById('regSubmit').disabled = false;
      document.getElementById('regSubmit').textContent = 'Start Studying 🚀';
    }
  };
}

// ─── Dashboard Page ───────────────────────────────
async function renderDashboard() {
  const container = document.getElementById('appContainer');
  const profile = await window.api.getProfile();
  const studyState = await window.api.getStudyState();

  const greeting = getGreeting();

  container.innerHTML = `
    <div class="animate-fadeIn">
      <!-- Greeting -->
      <div style="text-align:center;margin-bottom:24px;">
        <h1 style="font-size:32px;font-weight:800;">
          <span class="text-gradient">Gift For You</span>
        </h1>
        <p style="font-size:18px;margin-top:8px;">
          ${greeting}, <strong>${profile.name || 'Student'}</strong>! 💛
        </p>
      </div>

      <!-- Study Tracker Card -->
      <div class="card" id="studyCard" style="margin-bottom:16px;">
        ${renderStudyTracker(studyState)}
      </div>

      <!-- Quick Stats -->
      <div class="card" style="margin-bottom:16px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">📊 Activity Monitor</h3>
        <div id="quickActivity" style="font-size:12px;color:var(--text-muted);">Loading...</div>
      </div>
    </div>
  `;

  bindStudyTrackerEvents(studyState);

  // Load activity
  const activity = await window.api.getCurrentActivity();
  if (activity) updateQuickActivity(activity);
}

function renderStudyTracker(state) {
  if (state.isStudying && !state.isBreak) {
    return `
      <h2 style="font-size:16px;font-weight:700;margin-bottom:12px;">📖 Studying...</h2>
      <div style="text-align:center;margin:16px 0;">
        <span class="text-gradient" id="studyTimer" style="font-size:48px;font-weight:800;font-family:var(--font-mono);">
          ${formatTime(state.elapsedSeconds)}
        </span>
      </div>
      <p style="text-align:center;color:var(--text-secondary);font-size:14px;margin-bottom:16px;" id="encourageMsg">
        ${ENCOURAGING_MESSAGES[messageIndex]}
      </p>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-secondary" style="flex:1;" id="btnBreak">☕ Break</button>
        <button class="btn btn-danger" style="flex:1;" id="btnStop">✋ Stop</button>
      </div>
    `;
  }

  if (state.isBreak) {
    return `
      <h2 style="font-size:16px;font-weight:700;margin-bottom:12px;">☕ Break Time</h2>
      <p style="color:var(--text-secondary);font-size:13px;">Relax, you deserve it! Study time: ${formatTime(state.elapsedSeconds)}</p>
      <div style="display:flex;gap:8px;margin-top:16px;">
        <button class="btn btn-primary" style="flex:1;" id="btnResume">📖 Resume</button>
        <button class="btn btn-danger" style="flex:1;" id="btnStop">✋ Done</button>
      </div>
    `;
  }

  // Idle state
  return `
    <h2 style="font-size:16px;font-weight:700;margin-bottom:8px;">📚 Study Time</h2>
    <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px;">Ready to study?</p>
    <button class="btn btn-primary btn-lg btn-full" id="btnStart">
      Yes, let's go! 🚀
    </button>
  `;
}

function bindStudyTrackerEvents(state) {
  const btnStart = document.getElementById('btnStart');
  const btnBreak = document.getElementById('btnBreak');
  const btnResume = document.getElementById('btnResume');
  const btnStop = document.getElementById('btnStop');

  if (btnStart) btnStart.onclick = async () => {
    await window.api.startStudying();
    renderDashboard();
  };
  if (btnBreak) btnBreak.onclick = async () => {
    await window.api.startBreak();
    renderDashboard();
  };
  if (btnResume) btnResume.onclick = async () => {
    await window.api.resumeStudying();
    renderDashboard();
  };
  if (btnStop) btnStop.onclick = async () => {
    const result = await window.api.stopStudying();
    renderDashboard();
  };
}

// ─── Activity Page ────────────────────────────────
async function renderActivityPage() {
  const container = document.getElementById('appContainer');
  const activity = await window.api.getCurrentActivity();

  container.innerHTML = `
    <div class="animate-fadeIn">
      <h2 style="font-size:18px;font-weight:700;margin-bottom:16px;">🖥️ Activity Monitor</h2>

      <div class="card" style="margin-bottom:12px;">
        <h3 style="font-size:13px;color:var(--text-muted);margin-bottom:4px;">CURRENTLY ACTIVE</h3>
        <p style="font-size:14px;font-weight:600;" id="activeWindowTitle">
          ${activity?.activeApp ? `${activity.activeApp} — ${activity.activeTitle}` : 'Nothing detected'}
        </p>
      </div>

      <div class="card">
        <h3 style="font-size:13px;color:var(--text-muted);margin-bottom:8px;">
          ALL OPEN WINDOWS (${activity?.totalWindows || 0})
        </h3>
        <div id="windowsList" style="font-size:12px;">
          ${renderWindowsList(activity?.openWindows || [])}
        </div>
      </div>
    </div>
  `;
}

function renderWindowsList(windows) {
  if (!windows || windows.length === 0) return '<p style="color:var(--text-muted);">No windows detected</p>';
  return windows.map((w) => `
    <div style="padding:8px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;">
      <span style="color:var(--accent-primary);font-family:var(--font-mono);font-size:11px;">${w.appName}</span>
      <span style="color:var(--text-secondary);max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${w.windowTitle}</span>
    </div>
  `).join('');
}

// ─── Messages Page ────────────────────────────────
async function renderMessagesPage() {
  const container = document.getElementById('appContainer');
  const messages = await window.api.getMessages();

  container.innerHTML = `
    <div class="animate-fadeIn">
      <h2 style="font-size:18px;font-weight:700;margin-bottom:16px;">💬 Messages</h2>

      ${messages.length > 0 ? messages.map((msg) => `
        <div class="card" style="margin-bottom:8px;padding:16px;border-left:3px solid ${msg.color || '#FFE5D9'};" data-msgid="${msg.id}">
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="font-size:28px;">${msg.emoji || '💛'}</span>
            <div style="flex:1;">
              <h3 style="font-size:14px;font-weight:600;margin-bottom:2px;">${msg.title || '(No title)'}</h3>
              <p style="font-size:13px;color:var(--text-secondary);line-height:1.5;">${msg.body || ''}</p>
              <span style="font-size:11px;color:var(--text-muted);">
                ${new Date(msg.sentAt).toLocaleString()}
                ${msg.isRead ? ' · ✅ Read' : ' · 📬 New'}
              </span>
            </div>
          </div>
        </div>
      `).join('') : `
        <div class="card" style="text-align:center;padding:32px;">
          <span style="font-size:40px;">📭</span>
          <p style="color:var(--text-muted);margin-top:8px;">No messages yet</p>
        </div>
      `}
    </div>
  `;

  // Mark unread messages as read
  for (const msg of messages) {
    if (!msg.isRead) {
      await window.api.markMessageRead(msg.id);
    }
  }
}

// ─── Settings Page ────────────────────────────────
async function renderSettingsPage() {
  const container = document.getElementById('appContainer');
  const profile = await window.api.getProfile();

  container.innerHTML = `
    <div class="animate-fadeIn">
      <h2 style="font-size:18px;font-weight:700;margin-bottom:16px;">⚙️ Settings</h2>

      <div class="card" style="margin-bottom:12px;">
        <h3 style="font-size:13px;color:var(--text-muted);margin-bottom:8px;">PROFILE</h3>
        <p style="font-size:16px;font-weight:600;">${profile.name}</p>
        <p style="font-size:11px;color:var(--text-muted);margin-top:4px;">ID: ${profile.id}</p>
      </div>

      <div class="card" style="margin-bottom:12px;">
        <h3 style="font-size:13px;color:var(--text-muted);margin-bottom:8px;">STATUS</h3>
        <p style="font-size:13px;color:var(--accent-primary);">🟢 Monitoring Active</p>
        <p style="font-size:11px;color:var(--text-muted);margin-top:4px;">
          Data syncs automatically to your teacher's dashboard.
        </p>
      </div>

      <div class="card">
        <h3 style="font-size:13px;color:var(--text-muted);margin-bottom:8px;">ABOUT</h3>
        <p style="font-size:13px;color:var(--text-secondary);">Gift For You v1.0.0</p>
        <p style="font-size:11px;color:var(--text-muted);margin-top:4px;">
          This app runs in the background and auto-starts with Windows.
        </p>
      </div>
    </div>
  `;
}

// ─── Event Handlers ───────────────────────────────
function handleNewMessage(message) {
  const popup = document.getElementById('messagePopup');
  const card = document.getElementById('messagePopupCard');
  document.getElementById('popupEmoji').textContent = message.emoji || '💛';
  document.getElementById('popupTitle').textContent = message.title || 'New Message';
  document.getElementById('popupBody').textContent = message.body || '';
  card.style.borderColor = message.color || '#FFE5D9';
  popup.style.display = 'flex';

  try {
    const audio = new Audio('../../../assets/message.mp3');
    audio.play().catch(() => {});
  } catch (e) {}

  document.getElementById('popupDismiss').onclick = () => {
    popup.style.display = 'none';
    if (message.id) window.api.markMessageRead(message.id);
  };

  const badge = document.getElementById('msgBadge');
  const current = parseInt(badge.textContent || '0');
  badge.textContent = current + 1;
  badge.style.display = 'flex';
}

function handleIdleCheck(data) {
  console.log('Idle check triggered');
}

function handleStudyUpdate(state) {
  const timer = document.getElementById('studyTimer');
  if (timer) {
    timer.textContent = formatTime(state.elapsedSeconds);
  }
}

function handleActivityUpdate(activity) {
  updateQuickActivity(activity);

  const activeTitle = document.getElementById('activeWindowTitle');
  if (activeTitle && activity) {
    activeTitle.textContent = `${activity.activeApp} — ${activity.activeTitle}`;
  }

  const windowsList = document.getElementById('windowsList');
  if (windowsList && activity?.openWindows) {
    windowsList.innerHTML = renderWindowsList(activity.openWindows);
  }
}

function handleConnectionStatus(data) {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if (data.connected) {
    dot.classList.add('connected');
    text.textContent = 'Connected to server';
  } else {
    dot.classList.remove('connected');
    text.textContent = 'Connecting to server...';
  }
}

function updateQuickActivity(activity) {
  const el = document.getElementById('quickActivity');
  if (!el || !activity) return;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
      <span>Active: <strong style="color:var(--text-primary);">${activity.activeApp || 'None'}</strong></span>
      <span>🪟 ${activity.totalWindows || 0} windows</span>
    </div>
    <div style="color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
      ${activity.activeTitle || ''}
    </div>
  `;
}

// ─── Utilities ────────────────────────────────────
function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

setInterval(() => {
  messageIndex = (messageIndex + 1) % ENCOURAGING_MESSAGES.length;
  const el = document.getElementById('encourageMsg');
  if (el) el.textContent = ENCOURAGING_MESSAGES[messageIndex];
}, 3 * 60 * 1000);
