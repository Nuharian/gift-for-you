// Study service — Firestore operations for study sessions
import { db } from './firebase';
import {
  collection, doc, getDocs, setDoc, onSnapshot,
  query, orderBy, where,
} from 'firebase/firestore';

const STUDY_SESSIONS_COLLECTION = 'gfy_study_sessions';
const IDLE_EVENTS_COLLECTION = 'gfy_idle_events';

// Get study sessions for a student on a date
export async function getStudySessions(studentId, date) {
  if (!db) return [];
  try {
    const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
    const q = query(
      collection(db, STUDY_SESSIONS_COLLECTION),
      where('studentId', '==', studentId),
      where('date', '==', dateStr),
      orderBy('startTime', 'desc')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('Error fetching study sessions:', error);
    return [];
  }
}

// Subscribe to study sessions in real-time
export function subscribeToStudySessions(studentId, date, callback) {
  if (!db) return () => {};
  const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
  const q = query(
    collection(db, STUDY_SESSIONS_COLLECTION),
    where('studentId', '==', studentId),
    where('date', '==', dateStr),
    orderBy('startTime', 'desc')
  );
  return onSnapshot(q, (snapshot) => {
    const sessions = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(sessions);
  });
}

// Get study stats for a student
export async function getStudyStats(studentId) {
  if (!db) return { todayTotal: 0, weeklyStats: [], streak: 0 };
  try {
    const today = new Date().toISOString().split('T')[0];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Get all sessions for the past 7 days + streak calculation
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysStr = sevenDaysAgo.toISOString().split('T')[0];

    const q = query(
      collection(db, STUDY_SESSIONS_COLLECTION),
      where('studentId', '==', studentId),
      where('date', '>=', sevenDaysStr),
      orderBy('date', 'desc')
    );

    const snapshot = await getDocs(q);
    const sessions = snapshot.docs.map((d) => d.data());

    // Today's total
    const todaySessions = sessions.filter((s) => s.date === today);
    const todayTotal = todaySessions.reduce((sum, s) => sum + (s.durationMin || 0), 0);

    // Weekly stats
    const weeklyStats = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const daySessions = sessions.filter((s) => s.date === dateStr);
      const totalMinutes = daySessions.reduce((sum, s) => sum + (s.durationMin || 0), 0);

      weeklyStats.push({
        date: dateStr,
        dayName: dayNames[d.getDay()],
        totalMinutes,
        isToday: i === 0,
      });
    }

    // Streak calculation
    let streak = 0;
    const d = new Date();
    d.setHours(0, 0, 0, 0);

    // Fetch all sessions for streak (up to 365 days)
    const allQ = query(
      collection(db, STUDY_SESSIONS_COLLECTION),
      where('studentId', '==', studentId),
      orderBy('date', 'desc')
    );
    const allSnapshot = await getDocs(allQ);
    const allSessions = allSnapshot.docs.map((doc) => doc.data());

    if (todayTotal > 0) {
      streak = 1;
      d.setDate(d.getDate() - 1);
    } else {
      d.setDate(d.getDate() - 1);
    }

    for (let i = 0; i < 365; i++) {
      const dateStr = d.toISOString().split('T')[0];
      const daySessions = allSessions.filter((s) => s.date === dateStr);
      const total = daySessions.reduce((sum, s) => sum + (s.durationMin || 0), 0);
      if (total > 0) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }

    return { todayTotal, weeklyStats, streak };
  } catch (error) {
    console.error('Error fetching study stats:', error);
    return { todayTotal: 0, weeklyStats: [], streak: 0 };
  }
}

// Get idle events for a student
export async function getIdleEvents(studentId, date) {
  if (!db) return [];
  try {
    const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
    const startOfDay = new Date(dateStr);
    const endOfDay = new Date(dateStr);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const q = query(
      collection(db, IDLE_EVENTS_COLLECTION),
      where('studentId', '==', studentId),
      where('startedAt', '>=', startOfDay.toISOString()),
      where('startedAt', '<', endOfDay.toISOString()),
      orderBy('startedAt', 'desc')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('Error fetching idle events:', error);
    return [];
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
