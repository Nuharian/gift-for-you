'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { subscribeToStudents, decorateStudent } from '../../lib/studentService';
import { subscribeToLive, subscribeToDaily, getDailyRange } from '../../lib/activityService';
import { getStudyStats, formatSeconds, formatClock } from '../../lib/studyService';
import {
  sendMessage, broadcastMessage, subscribeToAllMessages,
  deleteMessage, markThreadRead,
} from '../../lib/messagingService';
import {
  gatherExportData, buildSummaryCsv, buildAppsCsv, buildWindowsCsv,
  buildSessionsCsv, buildMarkdownReport, downloadFile, exportFilename,
} from '../../lib/exportService';
import {
  DAY_NAMES, ALL_DAYS, isRoutine, sendRoutine, deleteRoutine, cleanTasks,
  sortTasks, toMinutes, fromMinutes, formatDuration, formatDays,
} from '../../lib/routineService';

const PRESET_COLORS = [
  { label: 'Peach', value: '#FFE5D9' },
  { label: 'Lavender', value: '#E2D1F9' },
  { label: 'Mint', value: '#D4F5E9' },
  { label: 'Gold', value: '#FFD700' },
  { label: 'Coral', value: '#FF6B6B' },
  { label: 'Sky Blue', value: '#45B7D1' },
];

const EMOJI_GRID = [
  '📚', '💪', '🌟', '💛', '🎯', '🔥', '✨', '🌙', '💫', '🎉',
  '👋', '😊', '🌺', '🦋', '🌈', '☀️', '💎', '🏆', '📖', '🤗',
];

const PRIORITIES = [
  { value: 'normal', label: '💚 Normal' },
  { value: 'urgent', label: '🔥 Urgent' },
  { value: 'fun', label: '✨ Fun' },
];

const QUICK_MESSAGES = [
  { emoji: '👋', title: 'Checking in', body: 'Just checking in — how is it going?' },
  { emoji: '📚', title: 'Time to study', body: 'Time to start your study session!' },
  { emoji: '🌟', title: 'Great work', body: 'Great work today — keep it up!' },
  { emoji: '🎯', title: 'Stay focused', body: 'Try to stay focused on the task at hand.' },
];

function getStatusBadge(status) {
  const map = {
    studying: { className: 'badge-studying', label: '📖 Studying' },
    idle: { className: 'badge-idle', label: '💤 Idle' },
    break: { className: 'badge-break', label: '☕ Break' },
    online: { className: 'badge-online', label: '🟢 Online' },
    offline: { className: 'badge-offline', label: '⚫ Offline' },
  };
  return map[status] || map.offline;
}

function getStatusDotClass(status) {
  const map = {
    studying: 'status-dot-studying',
    idle: 'status-dot-idle',
    break: 'status-dot-break',
    online: 'status-dot-online',
    offline: 'status-dot-offline',
  };
  return map[status] || 'status-dot-offline';
}

const ROUTINE_STATUS = {
  pending: { className: 'badge-break', label: '⏳ Waiting for answer' },
  accepted: { className: 'badge-online', label: '✅ Accepted' },
  declined: { className: 'badge-idle', label: '✖ Declined' },
};

let taskKey = 0;
function newTaskRow(start = '16:00') {
  taskKey += 1;
  return { key: taskKey, title: '', start, durationMin: 45, note: '' };
}

function timeSince(isoString) {
  if (!isoString) return 'Never';
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// A horizontal bar list — the fastest way to read "what dominated the day".
function UsageBars({ items, labelKey, limit = 8, emptyText }) {
  if (!items || items.length === 0) {
    return <p className="muted-text">{emptyText || 'Nothing tracked yet.'}</p>;
  }
  const top = items.slice(0, limit);
  const max = Math.max(...top.map((i) => i.activeSeconds || 0), 1);

  return (
    <div className="usage-list">
      {top.map((item, i) => {
        const label = item[labelKey] || item.title || item.appName || 'Unknown';
        const pct = Math.max(2, Math.round(((item.activeSeconds || 0) / max) * 100));
        return (
          <div className="usage-row" key={`${label}-${i}`}>
            <div className="usage-row-head">
              <span className="usage-name" title={label}>{label}</span>
              <span className="usage-time">{formatSeconds(item.activeSeconds)}</span>
            </div>
            <div className="usage-bar">
              <div className="usage-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WeekChart({ weeklyStats }) {
  if (!weeklyStats || weeklyStats.length === 0) return null;
  const max = Math.max(...weeklyStats.map((d) => d.totalSeconds || 0), 1);

  return (
    <div className="week-chart">
      {weeklyStats.map((day) => (
        <div className="week-col" key={day.date}>
          <div className="week-bar-track">
            <div
              className={`week-bar${day.isToday ? ' week-bar-today' : ''}`}
              style={{ height: `${Math.max(3, Math.round(((day.totalSeconds || 0) / max) * 100))}%` }}
              title={`${day.dayName}: ${formatSeconds(day.totalSeconds)}`}
            />
          </div>
          <span className="week-label">{day.dayName}</span>
          <span className="week-value">{formatSeconds(day.totalSeconds)}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [students, setStudents] = useState([]);
  const [studentStats, setStudentStats] = useState({});
  const [allMessages, setAllMessages] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [broadcastMode, setBroadcastMode] = useState(true);
  const [live, setLive] = useState(null);
  const [daily, setDaily] = useState(null);
  const [weekly, setWeekly] = useState([]);
  const [search, setSearch] = useState('');
  const [detailTab, setDetailTab] = useState('now');
  const [error, setError] = useState('');

  // A ticking clock so live study timers advance between heartbeats.
  const [now, setNow] = useState(() => Date.now());

  const [msgTitle, setMsgTitle] = useState('');
  const [msgBody, setMsgBody] = useState('');
  const [msgColor, setMsgColor] = useState('#FFE5D9');
  const [msgEmoji, setMsgEmoji] = useState('💛');
  const [msgPriority, setMsgPriority] = useState('normal');
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  const [exportDays, setExportDays] = useState(7);
  const [exportScope, setExportScope] = useState('all');
  const [exporting, setExporting] = useState('');
  const [exportNote, setExportNote] = useState('');

  const [rtTitle, setRtTitle] = useState('');
  const [rtDays, setRtDays] = useState(ALL_DAYS);
  const [rtTasks, setRtTasks] = useState(() => [newTaskRow()]);
  const [rtTarget, setRtTarget] = useState('all');
  const [rtSending, setRtSending] = useState(false);
  const [rtNote, setRtNote] = useState('');

  const statsLoadedFor = useRef('');

  // Auth check
  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('gfy_admin_auth') !== 'true') {
      router.push('/');
    }
  }, [router]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Roster (real-time)
  useEffect(() => {
    const unsub = subscribeToStudents(setStudents, (e) => setError(e.message));
    return unsub;
  }, []);

  // Every message, so unread reply badges work without opening each thread.
  useEffect(() => {
    const unsub = subscribeToAllMessages(setAllMessages);
    return unsub;
  }, []);

  const decorated = useMemo(
    () => students.map((s) => decorateStudent(s, now)),
    [students, now]
  );

  const selected = useMemo(
    () => decorated.find((s) => s.id === selectedId) || null,
    [decorated, selectedId]
  );

  const visibleStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? decorated.filter((s) => String(s.name || '').toLowerCase().includes(q))
      : decorated;
    // Active students first, then by today's study time.
    return [...list].sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      return (b.liveTodaySeconds || 0) - (a.liveTodaySeconds || 0);
    });
  }, [decorated, search]);

  // Study stats for the roster cards. Recomputed when the set of students
  // changes, not on every heartbeat, so this stays cheap.
  const studentKey = useMemo(() => students.map((s) => s.id).sort().join(','), [students]);

  useEffect(() => {
    if (!studentKey || statsLoadedFor.current === studentKey) return;
    statsLoadedFor.current = studentKey;
    let cancelled = false;

    (async () => {
      const ids = studentKey.split(',').filter(Boolean);
      const results = await Promise.all(ids.map(async (id) => [id, await getStudyStats(id)]));
      if (!cancelled) setStudentStats(Object.fromEntries(results));
    })();

    return () => { cancelled = true; };
  }, [studentKey]);

  // Live + daily detail for the selected student only.
  useEffect(() => {
    if (!selectedId) {
      setLive(null);
      setDaily(null);
      setWeekly([]);
      return undefined;
    }
    const unsubLive = subscribeToLive(selectedId, setLive);
    const unsubDaily = subscribeToDaily(selectedId, new Date(), setDaily);
    getDailyRange(selectedId, 7).then((days) => {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      setWeekly(days.map((d) => ({
        date: d.date,
        dayName: dayNames[new Date(d.date + 'T00:00:00').getDay()],
        totalSeconds: d.studySeconds || 0,
        isToday: d.date === new Date().toISOString().split('T')[0],
      })));
    });
    return () => { unsubLive(); unsubDaily(); };
  }, [selectedId]);

  // Routines share the messages collection but are not part of the chat.
  const routines = useMemo(() => allMessages.filter(isRoutine), [allMessages]);

  const threadMessages = useMemo(
    () => (selectedId ? allMessages.filter((m) => m.studentId === selectedId && !isRoutine(m)) : []),
    [allMessages, selectedId]
  );

  const visibleRoutines = useMemo(
    () => (selectedId ? routines.filter((r) => r.studentId === selectedId) : routines),
    [routines, selectedId]
  );

  // The most recent routine per student, for the roster cards. `routines` is
  // already newest first.
  const latestRoutineByStudent = useMemo(() => {
    const map = {};
    for (const r of routines) if (!map[r.studentId]) map[r.studentId] = r;
    return map;
  }, [routines]);

  const studentNames = useMemo(
    () => Object.fromEntries(decorated.map((s) => [s.id, s.name])),
    [decorated]
  );

  // Sending to one student needs one selected; fall back to the class.
  const routineTargets = rtTarget === 'selected' && selected ? [selected] : decorated;
  const plannedTasks = useMemo(() => cleanTasks(rtTasks), [rtTasks]);
  const plannedMinutes = plannedTasks.reduce((sum, t) => sum + t.durationMin, 0);

  const updateTask = (key, patch) =>
    setRtTasks((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // A new row starts where the last one ends, which is how a routine is
  // usually written down.
  const addTask = () => setRtTasks((rows) => {
    const last = rows[rows.length - 1];
    const lastStart = last ? toMinutes(last.start) : null;
    const start = lastStart === null ? '16:00' : fromMinutes(lastStart + (Number(last.durationMin) || 0));
    return [...rows, newTaskRow(start)];
  });

  const removeTask = (key) =>
    setRtTasks((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : [newTaskRow()]));

  const toggleDay = (day) =>
    setRtDays((days) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort()));

  const loadRoutineAsTemplate = (routine) => {
    setRtTitle(routine.title || '');
    setRtDays(routine.days && routine.days.length ? routine.days : ALL_DAYS);
    setRtTasks(sortTasks(routine.tasks).map((t) => ({
      ...newTaskRow(t.start), title: t.title, durationMin: t.durationMin, note: t.note || '',
    })));
    setRtNote('Loaded into the builder — change it and send again.');
    setTimeout(() => setRtNote(''), 4000);
  };

  const handleSendRoutine = useCallback(async () => {
    if (plannedTasks.length === 0 || routineTargets.length === 0) return;
    setRtSending(true);
    setRtNote('');
    try {
      const sent = await sendRoutine(routineTargets, { title: rtTitle, days: rtDays, tasks: plannedTasks });
      setRtNote(`✅ Sent to ${sent} student${sent === 1 ? '' : 's'} — they will be asked to accept it.`);
      setRtTitle('');
      setRtTasks([newTaskRow()]);
    } catch (e) {
      setRtNote('⚠️ Could not send: ' + e.message);
    }
    setRtSending(false);
    setTimeout(() => setRtNote(''), 6000);
  }, [plannedTasks, routineTargets, rtTitle, rtDays]);

  // Mark student replies read once the teacher is looking at the thread.
  useEffect(() => {
    if (selectedId && detailTab === 'messages' && threadMessages.length > 0) {
      markThreadRead(threadMessages);
    }
  }, [selectedId, detailTab, threadMessages]);

  const unreadByStudent = useMemo(() => {
    const map = {};
    for (const m of allMessages) {
      if (m.from === 'student' && !m.readByTeacher) {
        map[m.studentId] = (map[m.studentId] || 0) + 1;
      }
    }
    return map;
  }, [allMessages]);

  const handleSend = useCallback(async () => {
    if (!msgTitle.trim() && !msgBody.trim()) return;
    setSending(true);

    const payload = {
      title: msgTitle, body: msgBody, emoji: msgEmoji, color: msgColor, priority: msgPriority,
    };

    if (!broadcastMode && selectedId) {
      await sendMessage(selectedId, payload);
    } else {
      await broadcastMessage(decorated.map((s) => s.id), payload);
    }

    setMsgTitle('');
    setMsgBody('');
    setMsgPriority('normal');
    setSending(false);
    setSendSuccess(true);
    setTimeout(() => setSendSuccess(false), 2000);
  }, [msgTitle, msgBody, msgEmoji, msgColor, msgPriority, broadcastMode, selectedId, decorated]);

  const applyQuickMessage = (quick) => {
    setMsgEmoji(quick.emoji);
    setMsgTitle(quick.title);
    setMsgBody(quick.body);
  };

  // Exports are built from the same rollup documents the dashboard shows, so
  // what is downloaded always matches what is on screen.
  const runExport = useCallback(async (kind) => {
    const targets = exportScope === 'selected' && selected ? [selected] : decorated;
    if (targets.length === 0) return;

    setExporting(kind);
    setExportNote('');
    try {
      const data = await gatherExportData(targets, exportDays);
      const who = exportScope === 'selected' && selected ? selected.name : null;

      if (kind === 'markdown') {
        downloadFile(exportFilename('report', 'md', who), buildMarkdownReport(data), 'text/markdown;charset=utf-8');
      } else if (kind === 'copy') {
        await navigator.clipboard.writeText(buildMarkdownReport(data));
        setExportNote('Markdown copied — paste it straight into Claude.');
      } else {
        const builders = {
          summary: buildSummaryCsv,
          apps: buildAppsCsv,
          windows: buildWindowsCsv,
          sessions: buildSessionsCsv,
        };
        downloadFile(exportFilename(kind, 'csv', who), builders[kind](data), 'text/csv;charset=utf-8');
      }
    } catch (e) {
      setExportNote('Export failed: ' + e.message);
    }
    setExporting('');
    setTimeout(() => setExportNote(''), 6000);
  }, [exportScope, exportDays, selected, decorated]);

  const handleLogout = () => {
    sessionStorage.removeItem('gfy_admin_auth');
    router.push('/');
  };

  const onlineCount = decorated.filter((s) => s.isOnline).length;
  const studyingCount = decorated.filter((s) => s.status === 'studying').length;
  const idleCount = decorated.filter((s) => s.status === 'idle').length;
  const totalStudiedToday = decorated.reduce((sum, s) => sum + (s.liveTodaySeconds || 0), 0);

  return (
    <div className="page-container animate-fadeIn">
      <div className="top-bar">
        <h1 className="top-bar-title">
          🎁 <span className="text-gradient">Gift For You</span>
          <span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 400 }}>Dashboard</span>
        </h1>
        <div className="top-bar-actions">
          <input
            className="input input-search"
            type="search"
            placeholder="Search students…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-secondary btn-sm" onClick={handleLogout}>Logout 👋</button>
        </div>
      </div>

      {error && (
        <div className="card alert-card">⚠️ Connection problem: {error}</div>
      )}

      <div className="stats-grid animate-slideUp stagger-1">
        <div className="card stat-card stat-card-green">
          <div className="stat-icon">👥</div>
          <div className="stat-value text-gradient">{decorated.length}</div>
          <div className="stat-label">Total Students</div>
        </div>
        <div className="card stat-card stat-card-blue">
          <div className="stat-icon">🟢</div>
          <div className="stat-value">{onlineCount}</div>
          <div className="stat-label">Online Now</div>
        </div>
        <div className="card stat-card stat-card-purple">
          <div className="stat-icon">📖</div>
          <div className="stat-value">{studyingCount}</div>
          <div className="stat-label">Studying</div>
        </div>
        <div className="card stat-card stat-card-amber">
          <div className="stat-icon">⏱️</div>
          <div className="stat-value">{formatSeconds(totalStudiedToday)}</div>
          <div className="stat-label">Studied Today (all)</div>
        </div>
      </div>

      <section className="section">
        <div className="section-header">
          <h2 className="section-title">👤 Students</h2>
          <span className="muted-text">{idleCount > 0 ? `${idleCount} idle` : 'Live'}</span>
        </div>

        {visibleStudents.length > 0 ? (
          <div className="students-grid">
            {visibleStudents.map((student, i) => {
              const stats = studentStats[student.id] || {};
              const statusBadge = getStatusBadge(student.status);
              const dotClass = getStatusDotClass(student.status);
              const unread = unreadByStudent[student.id] || 0;
              const isSelected = student.id === selectedId;

              return (
                <div
                  key={student.id}
                  className={`card card-interactive student-card animate-slideUp stagger-${Math.min(i + 1, 5)}${isSelected ? ' student-card-selected' : ''}`}
                  onClick={() => {
                    setSelectedId(student.id);
                    setBroadcastMode(false);
                  }}
                >
                  <div className="student-card-header">
                    <div className="student-card-name">
                      <span className={`status-dot ${dotClass}`} />
                      {student.name}
                      {unread > 0 && <span className="reply-badge">{unread}</span>}
                    </div>
                    <span className={`badge ${statusBadge.className}`}>{statusBadge.label}</span>
                  </div>

                  {/* The live session clock — the number the teacher wanted. */}
                  {student.isOnline && student.isStudying ? (
                    <div className="student-live-timer">
                      <span className="live-timer-value">{formatClock(student.liveSessionSeconds)}</span>
                      <span className="live-timer-label">
                        {student.studyRunning ? 'current session' : 'paused'}
                      </span>
                    </div>
                  ) : null}

                  <div className="student-card-info">
                    {student.isOnline && student.activeTitle && (
                      <div className="student-card-active-window">
                        🖥️ {student.activeApp}: {student.activeTitle}
                      </div>
                    )}
                    {student.isOnline && !student.activeTitle && (
                      <div className="student-card-active-window">🖥️ Monitoring active…</div>
                    )}
                    {!student.isOnline && student.stoppedUnexpectedly && (
                      <div
                        className="student-card-active-window"
                        style={{ color: '#f59e0b', fontWeight: 600 }}
                        title="The app stopped without shutting down cleanly. It may have crashed, lost connection, or the computer was switched off."
                      >
                        ⚠️ Not reporting — app stopped {timeSince(student.lastSeen)}
                      </div>
                    )}
                    {!student.isOnline && !student.stoppedUnexpectedly && (
                      <div className="student-card-active-window" style={{ opacity: 0.5 }}>
                        ⚫ Offline — last seen {timeSince(student.lastSeen)}
                      </div>
                    )}
                  </div>

                  <div className="student-card-stats">
                    <span className="student-card-stat">
                      📚 Today: {formatSeconds(student.liveTodaySeconds || (stats.todaySeconds || 0))}
                    </span>
                    <span className="student-card-stat">🔥 Streak: {stats.streak || 0}d</span>
                    <span className="student-card-stat">
                      🪟 {student.totalWindows || 0} · 🌐 {student.totalTabs || 0}
                    </span>
                    {latestRoutineByStudent[student.id] && (
                      <span className="student-card-stat">
                        🗓️ {(ROUTINE_STATUS[latestRoutineByStudent[student.id].status] || ROUTINE_STATUS.pending).label}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card empty-state">
            <span className="empty-state-icon">👻</span>
            <p className="empty-state-text">
              {search
                ? `No student matches “${search}”.`
                : 'No students registered yet. They appear here once they install the Gift For You app.'}
            </p>
          </div>
        )}
      </section>

      {/* ── Selected student detail ─────────────────── */}
      {selected && (
        <section className="section animate-fadeIn">
          <div className="section-header">
            <h2 className="section-title">🔍 {selected.name}</h2>
            <button className="btn btn-secondary btn-sm" onClick={() => setSelectedId(null)}>Close ✕</button>
          </div>

          <div className="tab-row">
            {[
              { id: 'now', label: '🖥️ Right now' },
              { id: 'usage', label: '⏱️ Time breakdown' },
              { id: 'messages', label: `💬 Messages${unreadByStudent[selected.id] ? ` (${unreadByStudent[selected.id]})` : ''}` },
            ].map((tab) => (
              <button
                key={tab.id}
                className={`tab-btn${detailTab === tab.id ? ' active' : ''}`}
                onClick={() => setDetailTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {detailTab === 'now' && (
            <div className="card">
              <div className="detail-summary">
                <div>
                  <div className="detail-label">Current session</div>
                  <div className="detail-value">
                    {selected.isStudying ? formatClock(selected.liveSessionSeconds) : '—'}
                  </div>
                </div>
                <div>
                  <div className="detail-label">Studied today</div>
                  <div className="detail-value">{formatSeconds(selected.liveTodaySeconds)}</div>
                </div>
                <div>
                  <div className="detail-label">Active on PC today</div>
                  <div className="detail-value">{formatSeconds(selected.todayActiveSeconds)}</div>
                </div>
              </div>

              <h3 className="detail-heading">
                Currently viewing:{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  {selected.activeApp
                    ? `${selected.activeApp} — ${selected.activeTitle}`
                    : 'nothing detected'}
                </strong>
              </h3>

              {live && live.openWindows && live.openWindows.length > 0 ? (
                <>
                  <h4 className="detail-subheading">
                    All open windows ({live.openWindows.length})
                  </h4>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>App</th>
                          <th>Window / tab title</th>
                          <th>State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {live.openWindows.map((w, i) => (
                          <tr key={i} className={w.isActive ? 'row-active' : ''}>
                            <td className="mono">{w.appName}</td>
                            <td>{w.windowTitle}</td>
                            <td>{w.isActive ? '▶ In use' : w.isMinimized ? 'Minimized' : 'Open'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="muted-text">
                  {selected.isOnline
                    ? 'Waiting for the next update from the student app…'
                    : 'Student is offline.'}
                </p>
              )}
            </div>
          )}

          {detailTab === 'usage' && (
            <div className="detail-grid">
              <div className="card">
                <h3 className="detail-subheading">🏆 Most-used apps today</h3>
                <UsageBars
                  items={(daily && daily.apps) || (live && live.topApps) || []}
                  labelKey="appName"
                  emptyText="No app time recorded yet today."
                />
              </div>
              <div className="card">
                <h3 className="detail-subheading">🌐 Most-used tabs &amp; windows today</h3>
                <UsageBars
                  items={(daily && daily.titles) || (live && live.topTitles) || []}
                  labelKey="title"
                  emptyText="No window time recorded yet today."
                />
              </div>
              <div className="card card-wide">
                <h3 className="detail-subheading">📅 Study time this week</h3>
                <WeekChart weeklyStats={weekly} />
              </div>
            </div>
          )}

          {detailTab === 'messages' && (
            <div className="card">
              <div className="thread">
                {threadMessages.length === 0 && (
                  <p className="muted-text">No messages yet. Send the first one below.</p>
                )}
                {[...threadMessages].reverse().map((msg) => (
                  <div
                    key={msg.id}
                    className={`thread-msg${msg.from === 'student' ? ' thread-msg-student' : ''}`}
                    style={msg.from !== 'student' ? { borderLeftColor: msg.color || '#FFE5D9' } : undefined}
                  >
                    <div className="thread-msg-head">
                      <span className="thread-emoji">{msg.emoji || '💛'}</span>
                      <span className="thread-who">{msg.from === 'student' ? selected.name : 'You'}</span>
                      <span className="thread-time">{timeSince(msg.sentAt)}</span>
                      {msg.from !== 'student' && (
                        <span className="thread-read">{msg.isRead ? '✅ Read' : '📬 Unread'}</span>
                      )}
                      <button
                        className="btn btn-icon thread-delete"
                        onClick={() => deleteMessage(msg.id)}
                        title="Delete"
                      >
                        🗑️
                      </button>
                    </div>
                    {msg.title && <div className="thread-title">{msg.title}</div>}
                    <div className="thread-body">{msg.body}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Routines ────────────────────────────────── */}
      <section className="section">
        <div className="section-header">
          <h2 className="section-title">🗓️ Routines</h2>
          <span className="muted-text">
            {routines.filter((r) => r.status === 'accepted').length} accepted ·{' '}
            {routines.filter((r) => !r.status || r.status === 'pending').length} waiting ·{' '}
            {routines.filter((r) => r.status === 'declined').length} declined
          </span>
        </div>

        <div className="routine-layout">
          <div className="card">
            <h3 className="detail-subheading">✍️ Build a routine</h3>
            <p className="muted-text" style={{ marginBottom: '14px' }}>
              The student is asked to accept it. Once they do, their app reminds them when each
              task starts and when its time is up. Times are in the student&apos;s own clock.
            </p>

            <div className="msg-option-group">
              <div className="msg-option-label">Send to</div>
              <div className="priority-row">
                <button
                  className={`btn btn-secondary priority-btn ${rtTarget === 'all' ? 'active' : ''}`}
                  onClick={() => setRtTarget('all')}
                >
                  All students ({decorated.length})
                </button>
                <button
                  className={`btn btn-secondary priority-btn ${rtTarget === 'selected' && selected ? 'active' : ''}`}
                  onClick={() => setRtTarget('selected')}
                  disabled={!selected}
                >
                  {selected ? selected.name : 'Select a student first'}
                </button>
              </div>
            </div>

            <input
              className="input"
              type="text"
              placeholder="Routine name, e.g. After-school plan"
              value={rtTitle}
              onChange={(e) => setRtTitle(e.target.value)}
              style={{ marginTop: '14px' }}
            />

            <div className="msg-option-group" style={{ marginTop: '14px' }}>
              <div className="msg-option-label">Days</div>
              <div className="day-row">
                {DAY_NAMES.map((name, day) => (
                  <button
                    key={name}
                    className={`day-chip ${rtDays.includes(day) ? 'active' : ''}`}
                    onClick={() => toggleDay(day)}
                  >
                    {name}
                  </button>
                ))}
                <button className="quick-chip" onClick={() => setRtDays(ALL_DAYS)}>Every day</button>
                <button className="quick-chip" onClick={() => setRtDays([1, 2, 3, 4, 5])}>Weekdays</button>
              </div>
            </div>

            <div className="msg-option-label" style={{ marginTop: '14px' }}>Tasks</div>
            <div className="task-rows">
              <div className="task-row task-row-head">
                <span>Starts</span><span>Task</span><span>Minutes</span><span />
              </div>
              {rtTasks.map((t) => (
                <div className="task-row" key={t.key}>
                  <input
                    className="input"
                    type="time"
                    value={t.start}
                    onChange={(e) => updateTask(t.key, { start: e.target.value })}
                  />
                  <div className="task-text">
                    <input
                      className="input"
                      type="text"
                      placeholder="What to do, e.g. Maths homework"
                      value={t.title}
                      onChange={(e) => updateTask(t.key, { title: e.target.value })}
                    />
                    <input
                      className="input input-note"
                      type="text"
                      placeholder="Note (optional)"
                      value={t.note}
                      onChange={(e) => updateTask(t.key, { note: e.target.value })}
                    />
                  </div>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="600"
                    value={t.durationMin}
                    onChange={(e) => updateTask(t.key, { durationMin: e.target.value })}
                  />
                  <button className="btn btn-icon" onClick={() => removeTask(t.key)} title="Remove task">✕</button>
                </div>
              ))}
            </div>
            <button className="btn btn-secondary btn-sm" onClick={addTask} style={{ marginTop: '10px' }}>
              ＋ Add task
            </button>

            <p className="muted-text" style={{ marginTop: '14px' }}>
              {plannedTasks.length} task{plannedTasks.length === 1 ? '' : 's'} · {formatDuration(plannedMinutes)} in
              total · {formatDays(rtDays)}
            </p>

            <button
              className="btn btn-primary btn-lg"
              onClick={handleSendRoutine}
              disabled={rtSending || plannedTasks.length === 0 || routineTargets.length === 0}
              style={{ marginTop: '12px' }}
            >
              {rtSending
                ? '⏳ Sending…'
                : rtTarget === 'selected' && selected
                  ? `Send routine to ${selected.name} 🗓️`
                  : `Send routine to all (${decorated.length}) 🗓️`}
            </button>
            {rtNote && <p className="export-note">{rtNote}</p>}
          </div>

          <div className="card">
            <h3 className="detail-subheading">
              📋 {selected ? `${selected.name}'s routines` : 'Sent routines'}
            </h3>
            {visibleRoutines.length === 0 ? (
              <p className="muted-text">
                {selected ? 'No routine sent to this student yet.' : 'No routines sent yet.'}
              </p>
            ) : (
              <div className="routine-list">
                {visibleRoutines.map((r) => {
                  const status = ROUTINE_STATUS[r.status] || ROUTINE_STATUS.pending;
                  return (
                    <div className="routine-item" key={r.id}>
                      <div className="routine-item-head">
                        <div>
                          <div className="routine-item-title">{r.title || 'Daily routine'}</div>
                          <div className="muted-text">
                            {!selected && <>{studentNames[r.studentId] || r.studentName || 'Unknown'} · </>}
                            {formatDays(r.days)} · sent {timeSince(r.sentAt)}
                            {r.respondedAt && <> · answered {timeSince(r.respondedAt)}</>}
                          </div>
                        </div>
                        <span className={`badge ${status.className}`}>{status.label}</span>
                      </div>
                      <ul className="routine-tasks">
                        {sortTasks(r.tasks).map((t) => (
                          <li key={t.id}>
                            <span className="mono">{t.start}–{fromMinutes(toMinutes(t.start) + t.durationMin)}</span>
                            <span>{t.title}</span>
                            <span className="muted-text">{formatDuration(t.durationMin)}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="routine-item-actions">
                        <button className="btn btn-secondary btn-sm" onClick={() => loadRoutineAsTemplate(r)}>
                          ✏️ Use as template
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => deleteRoutine(r.id)}>
                          🗑️ Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Data export ─────────────────────────────── */}
      <section className="section">
        <div className="section-header">
          <h2 className="section-title">📥 Export data</h2>
        </div>

        <div className="card">
          <p className="muted-text" style={{ marginBottom: '14px' }}>
            Raw numbers with percentages already worked out — ready to open in a
            spreadsheet, or paste straight into Claude or another AI to analyse.
          </p>

          <div className="export-controls">
            <div className="msg-option-group">
              <div className="msg-option-label">Who</div>
              <div className="priority-row">
                <button
                  className={`btn btn-secondary priority-btn ${exportScope === 'all' ? 'active' : ''}`}
                  onClick={() => setExportScope('all')}
                >
                  All students ({decorated.length})
                </button>
                <button
                  className={`btn btn-secondary priority-btn ${exportScope === 'selected' ? 'active' : ''}`}
                  onClick={() => setExportScope('selected')}
                  disabled={!selected}
                >
                  {selected ? selected.name : 'Select a student first'}
                </button>
              </div>
            </div>

            <div className="msg-option-group">
              <div className="msg-option-label">Period</div>
              <div className="priority-row">
                {[7, 14, 30].map((d) => (
                  <button
                    key={d}
                    className={`btn btn-secondary priority-btn ${exportDays === d ? 'active' : ''}`}
                    onClick={() => setExportDays(d)}
                  >
                    {d} days
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="msg-option-label" style={{ marginTop: '16px' }}>For AI analysis</div>
          <div className="export-row">
            <button className="btn btn-primary" onClick={() => runExport('copy')} disabled={!!exporting}>
              {exporting === 'copy' ? '⏳…' : '📋 Copy Markdown'}
            </button>
            <button className="btn btn-secondary" onClick={() => runExport('markdown')} disabled={!!exporting}>
              {exporting === 'markdown' ? '⏳…' : '📝 Download .md'}
            </button>
          </div>

          <div className="msg-option-label" style={{ marginTop: '16px' }}>Spreadsheet (CSV)</div>
          <div className="export-row">
            <button className="btn btn-secondary" onClick={() => runExport('summary')} disabled={!!exporting}>
              {exporting === 'summary' ? '⏳…' : '📊 Daily summary'}
            </button>
            <button className="btn btn-secondary" onClick={() => runExport('apps')} disabled={!!exporting}>
              {exporting === 'apps' ? '⏳…' : '🖥️ App time'}
            </button>
            <button className="btn btn-secondary" onClick={() => runExport('windows')} disabled={!!exporting}>
              {exporting === 'windows' ? '⏳…' : '🌐 Tabs &amp; windows'}
            </button>
            <button className="btn btn-secondary" onClick={() => runExport('sessions')} disabled={!!exporting}>
              {exporting === 'sessions' ? '⏳…' : '⏱️ Study sessions'}
            </button>
          </div>

          {exportNote && <p className="export-note">{exportNote}</p>}
        </div>
      </section>

      {/* ── Composer ────────────────────────────────── */}
      <section className="section">
        <div className="section-header">
          <h2 className="section-title">📣 Send message</h2>
        </div>

        <div className="student-selector">
          <button
            className={`student-chip ${broadcastMode ? 'active' : ''}`}
            onClick={() => setBroadcastMode(true)}
          >
            📢 Broadcast all
          </button>
          {decorated.map((s) => (
            <button
              key={s.id}
              className={`student-chip ${!broadcastMode && selectedId === s.id ? 'active' : ''}`}
              onClick={() => { setSelectedId(s.id); setBroadcastMode(false); }}
            >
              {s.name}
            </button>
          ))}
        </div>

        <div className="card">
          <div className="msg-composer">
            <div className="quick-row">
              {QUICK_MESSAGES.map((q) => (
                <button key={q.title} className="quick-chip" onClick={() => applyQuickMessage(q)}>
                  {q.emoji} {q.title}
                </button>
              ))}
            </div>

            <input
              className="input"
              type="text"
              placeholder="Message title…"
              value={msgTitle}
              onChange={(e) => setMsgTitle(e.target.value)}
            />
            <textarea
              className="input"
              placeholder="Write your message…"
              value={msgBody}
              onChange={(e) => setMsgBody(e.target.value)}
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend();
              }}
            />

            <div className="msg-options-row">
              <div className="msg-option-group">
                <div className="msg-option-label">Color</div>
                <div className="color-grid">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c.value}
                      className={`color-btn ${msgColor === c.value ? 'active' : ''}`}
                      style={{ backgroundColor: c.value }}
                      onClick={() => setMsgColor(c.value)}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              <div className="msg-option-group">
                <div className="msg-option-label">Emoji</div>
                <div className="emoji-grid">
                  {EMOJI_GRID.map((e) => (
                    <button
                      key={e}
                      className={`emoji-btn ${msgEmoji === e ? 'active' : ''}`}
                      onClick={() => setMsgEmoji(e)}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="msg-options-row">
              <div className="msg-option-group">
                <div className="msg-option-label">Priority</div>
                <div className="priority-row">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p.value}
                      className={`btn btn-secondary priority-btn ${msgPriority === p.value ? 'active' : ''}`}
                      onClick={() => setMsgPriority(p.value)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              className="btn btn-primary btn-lg"
              onClick={handleSend}
              disabled={(!msgTitle.trim() && !msgBody.trim()) || sending || decorated.length === 0}
              style={{ alignSelf: 'flex-start' }}
            >
              {sendSuccess
                ? '✅ Sent!'
                : sending
                  ? '⏳ Sending…'
                  : !broadcastMode && selected
                    ? `Send to ${selected.name} 📣`
                    : `Broadcast to all (${decorated.length}) 📢`}
            </button>
            <span className="muted-text">Tip: Ctrl+Enter sends.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
