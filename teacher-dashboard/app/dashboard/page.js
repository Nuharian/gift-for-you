'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { subscribeToStudents } from '../../lib/studentService';
import { subscribeToActivity } from '../../lib/activityService';
import { getStudyStats, formatDuration } from '../../lib/studyService';
import { sendMessage, broadcastMessage, getMessages, deleteMessage } from '../../lib/messagingService';

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

export default function DashboardPage() {
  const router = useRouter();
  const [students, setStudents] = useState([]);
  const [liveActivity, setLiveActivity] = useState({});
  const [studentStats, setStudentStats] = useState({});
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [messages, setMessages] = useState([]);

  // Message form
  const [msgTitle, setMsgTitle] = useState('');
  const [msgBody, setMsgBody] = useState('');
  const [msgColor, setMsgColor] = useState('#FFE5D9');
  const [msgEmoji, setMsgEmoji] = useState('💛');
  const [msgPriority, setMsgPriority] = useState('normal');
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  // Auth check
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const auth = sessionStorage.getItem('gfy_admin_auth');
      if (auth !== 'true') router.push('/');
    }
  }, [router]);

  // Subscribe to students (real-time)
  useEffect(() => {
    const unsub = subscribeToStudents((data) => {
      setStudents(data);
    });
    return unsub;
  }, []);

  // Subscribe to live activity for each student
  useEffect(() => {
    const unsubs = [];
    for (const student of students) {
      const unsub = subscribeToActivity(student.id, (activity) => {
        setLiveActivity((prev) => ({ ...prev, [student.id]: activity }));
      });
      unsubs.push(unsub);
    }
    return () => unsubs.forEach((u) => u());
  }, [students]);

  // Load stats for each student
  useEffect(() => {
    async function loadStats() {
      for (const student of students) {
        try {
          const stats = await getStudyStats(student.id);
          setStudentStats((prev) => ({ ...prev, [student.id]: stats }));
        } catch (e) {
          // silent
        }
      }
    }
    if (students.length > 0) loadStats();
  }, [students]);

  // Load messages when student selected
  useEffect(() => {
    if (selectedStudent) {
      loadMessages(selectedStudent.id);
    }
  }, [selectedStudent]);

  const loadMessages = async (studentId) => {
    const msgs = await getMessages(studentId);
    setMessages(msgs);
  };

  const handleSend = async () => {
    if (!msgTitle.trim() && !msgBody.trim()) return;
    setSending(true);

    if (selectedStudent) {
      await sendMessage(selectedStudent.id, {
        title: msgTitle, body: msgBody, emoji: msgEmoji, color: msgColor, priority: msgPriority,
      });
      await loadMessages(selectedStudent.id);
    } else {
      // Broadcast to all
      const ids = students.map((s) => s.id);
      await broadcastMessage(ids, {
        title: msgTitle, body: msgBody, emoji: msgEmoji, color: msgColor, priority: msgPriority,
      });
    }

    setMsgTitle('');
    setMsgBody('');
    setMsgColor('#FFE5D9');
    setMsgEmoji('💛');
    setMsgPriority('normal');
    setSending(false);
    setSendSuccess(true);
    setTimeout(() => setSendSuccess(false), 2000);
  };

  const handleDeleteMessage = async (msgId) => {
    await deleteMessage(msgId);
    if (selectedStudent) await loadMessages(selectedStudent.id);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('gfy_admin_auth');
    router.push('/');
  };

  // Computed stats
  const onlineCount = students.filter((s) => s.isOnline).length;
  const studyingCount = students.filter((s) => s.status === 'studying').length;
  const idleCount = students.filter((s) => s.status === 'idle').length;

  return (
    <div className="page-container animate-fadeIn">
      {/* Top Bar */}
      <div className="top-bar">
        <h1 className="top-bar-title">
          🎁 <span className="text-gradient">Gift For You</span>
          <span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 400 }}>Dashboard</span>
        </h1>
        <div className="top-bar-actions">
          <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
            Logout 👋
          </button>
        </div>
      </div>

      {/* Global Stats */}
      <div className="stats-grid animate-slideUp stagger-1">
        <div className="card stat-card stat-card-green">
          <div className="stat-icon">👥</div>
          <div className="stat-value text-gradient animate-countUp">{students.length}</div>
          <div className="stat-label">Total Students</div>
        </div>
        <div className="card stat-card stat-card-blue">
          <div className="stat-icon">🟢</div>
          <div className="stat-value animate-countUp">{onlineCount}</div>
          <div className="stat-label">Online Now</div>
        </div>
        <div className="card stat-card stat-card-purple">
          <div className="stat-icon">📖</div>
          <div className="stat-value animate-countUp">{studyingCount}</div>
          <div className="stat-label">Studying</div>
        </div>
        <div className="card stat-card stat-card-amber">
          <div className="stat-icon">💤</div>
          <div className="stat-value animate-countUp">{idleCount}</div>
          <div className="stat-label">Idle</div>
        </div>
      </div>

      {/* Student Cards */}
      <section className="section">
        <div className="section-header">
          <h2 className="section-title">👤 Students</h2>
        </div>

        {students.length > 0 ? (
          <div className="students-grid">
            {students.map((student, i) => {
              const activity = liveActivity[student.id];
              const stats = studentStats[student.id] || {};
              const statusBadge = getStatusBadge(student.status);
              const dotClass = getStatusDotClass(student.status);

              return (
                <div
                  key={student.id}
                  className={`card card-interactive student-card animate-slideUp stagger-${Math.min(i + 1, 5)}`}
                  onClick={() => setSelectedStudent(student)}
                >
                  <div className="student-card-header">
                    <div className="student-card-name">
                      <span className={`status-dot ${dotClass}`} />
                      {student.name}
                    </div>
                    <span className={`badge ${statusBadge.className}`}>{statusBadge.label}</span>
                  </div>

                  <div className="student-card-info">
                    {activity && activity.activeTitle && (
                      <div className="student-card-active-window">
                        🖥️ {activity.activeApp}: {activity.activeTitle}
                      </div>
                    )}

                    {!activity?.activeTitle && student.isOnline && (
                      <div className="student-card-active-window">
                        🖥️ Monitoring active...
                      </div>
                    )}

                    {!student.isOnline && (
                      <div className="student-card-active-window" style={{ opacity: 0.5 }}>
                        ⚫ Offline — Last seen: {timeSince(student.lastSeen)}
                      </div>
                    )}
                  </div>

                  <div className="student-card-stats">
                    <span className="student-card-stat">
                      📚 Today: {formatDuration(stats.todayTotal || 0)}
                    </span>
                    <span className="student-card-stat">
                      🔥 Streak: {stats.streak || 0}d
                    </span>
                    {activity && (
                      <span className="student-card-stat">
                        🪟 {activity.totalWindows || 0} windows
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
              No students registered yet. Students will appear here once they install the Gift For You app.
            </p>
          </div>
        )}
      </section>

      {/* Messaging Section */}
      <section className="section animate-slideUp" style={{ animationDelay: '0.3s', opacity: 0 }}>
        <div className="section-header">
          <h2 className="section-title">📣 Send Message</h2>
        </div>

        {/* Student Selector */}
        <div className="student-selector">
          <button
            className={`student-chip ${!selectedStudent ? 'active' : ''}`}
            onClick={() => setSelectedStudent(null)}
          >
            📢 Broadcast All
          </button>
          {students.map((s) => (
            <button
              key={s.id}
              className={`student-chip ${selectedStudent?.id === s.id ? 'active' : ''}`}
              onClick={() => setSelectedStudent(s)}
            >
              {s.name}
            </button>
          ))}
        </div>

        <div className="card">
          <div className="msg-composer">
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
              disabled={(!msgTitle.trim() && !msgBody.trim()) || sending}
              style={{ alignSelf: 'flex-start' }}
            >
              {sendSuccess ? '✅ Sent!' : sending ? '⏳ Sending...' : selectedStudent ? `Send to ${selectedStudent.name} 📣` : 'Broadcast to All 📢'}
            </button>
          </div>
        </div>
      </section>

      {/* Message History (for selected student) */}
      {selectedStudent && messages.length > 0 && (
        <section className="section animate-fadeIn">
          <h2 className="section-title">📜 Messages to {selectedStudent.name} ({messages.length})</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {messages.map((msg) => (
              <div key={msg.id} className="card msg-history-item">
                <div className="msg-history-left">
                  <span className="msg-history-emoji">{msg.emoji}</span>
                  <div className="msg-history-info">
                    <span className="msg-history-title">{msg.title || '(No title)'}</span>
                    <span className="msg-history-meta">
                      {new Date(msg.sentAt).toLocaleString()} · {msg.priority} · {msg.isRead ? '✅ Read' : '📬 Unread'}
                    </span>
                  </div>
                </div>
                <button className="btn btn-icon" onClick={() => handleDeleteMessage(msg.id)} title="Delete">
                  🗑️
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Student Detail Modal — App Usage Table */}
      {selectedStudent && liveActivity[selectedStudent.id] && (
        <section className="section animate-fadeIn">
          <h2 className="section-title">🖥️ {selectedStudent.name} — Live Activity</h2>
          <div className="card">
            <h3 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              Currently viewing: <strong style={{ color: 'var(--text-primary)' }}>
                {liveActivity[selectedStudent.id].activeApp} — {liveActivity[selectedStudent.id].activeTitle}
              </strong>
            </h3>

            {liveActivity[selectedStudent.id].openWindows && (
              <>
                <h4 style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  All Open Windows ({JSON.parse(liveActivity[selectedStudent.id].openWindows || '[]').length})
                </h4>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>App</th>
                      <th>Window Title</th>
                    </tr>
                  </thead>
                  <tbody>
                    {JSON.parse(liveActivity[selectedStudent.id].openWindows || '[]').map((w, i) => (
                      <tr key={i}>
                        <td className="mono">{w.appName}</td>
                        <td>{w.windowTitle}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
