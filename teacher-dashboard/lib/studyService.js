// Study service — sessions, totals and streaks.
//
// Sessions are read with a single equality filter on studentId and sorted in
// memory. The previous version paired that filter with orderBy/range clauses,
// which needed composite indexes that were never deployed, so every call fell
// into its catch block and the dashboard showed 0m for everyone.
import { db } from './firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { getDailyRange, dateKey } from './activityService';

const STUDY_SESSIONS_COLLECTION = 'gfy_study_sessions';

function sessionSeconds(session) {
  if (typeof session.durationSeconds === 'number') return session.durationSeconds;
  return Math.round((session.durationMin || 0) * 60);
}

async function fetchSessions(studentId) {
  if (!db || !studentId) return [];
  try {
    const snapshot = await getDocs(query(
      collection(db, STUDY_SESSIONS_COLLECTION),
      where('studentId', '==', studentId)
    ));
    return snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));
  } catch (error) {
    console.error('Error fetching study sessions:', error);
    return [];
  }
}

export async function getStudySessions(studentId, date) {
  const target = dateKey(date || new Date());
  const sessions = await fetchSessions(studentId);
  return sessions.filter((s) => s.date === target);
}

// Combines the day rollups (which include the session in progress) with
// completed session records, so today's number is right whether or not the
// student has stopped their timer yet.
export async function getStudyStats(studentId) {
  const empty = { todayTotal: 0, todaySeconds: 0, weeklyStats: [], streak: 0, sessions: [] };
  if (!db || !studentId) return empty;

  try {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = dateKey(new Date());

    const [sessions, daily] = await Promise.all([
      fetchSessions(studentId),
      getDailyRange(studentId, 7),
    ]);

    const secondsByDate = {};
    for (const s of sessions) {
      if (!s.date) continue;
      secondsByDate[s.date] = (secondsByDate[s.date] || 0) + sessionSeconds(s);
    }
    // The rollup is authoritative when it is larger: it counts the running
    // session, which has no completed record yet.
    for (const d of daily) {
      const rollup = d.studySeconds || 0;
      if (rollup > (secondsByDate[d.date] || 0)) secondsByDate[d.date] = rollup;
    }

    const todaySeconds = secondsByDate[today] || 0;

    const weeklyStats = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = dateKey(d);
      const seconds = secondsByDate[key] || 0;
      weeklyStats.push({
        date: key,
        dayName: dayNames[d.getDay()],
        totalMinutes: Math.round(seconds / 60),
        totalSeconds: seconds,
        isToday: i === 0,
      });
    }

    // Streak: consecutive days with study time, ending today (or yesterday if
    // today has not started yet).
    let streak = 0;
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    if (todaySeconds > 0) streak = 1;
    cursor.setDate(cursor.getDate() - 1);

    for (let i = 0; i < 365; i++) {
      if ((secondsByDate[dateKey(cursor)] || 0) <= 0) break;
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    return {
      todayTotal: Math.round(todaySeconds / 60),
      todaySeconds,
      weeklyStats,
      streak,
      sessions: sessions.filter((s) => s.date === today),
    };
  } catch (error) {
    console.error('Error computing study stats:', error);
    return empty;
  }
}

export function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatSeconds(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
