// Activity service — live desktop state and per-day usage.
//
// Live state and daily rollups are addressed by document id rather than
// queried, which makes them index-free, cheap to watch, and instant to read.
// Both live inside gfy_app_usage — a collection the project's existing
// security rules already permit — so no rules deploy is required.
import { db } from './firebase';
import {
  collection, doc, getDoc, getDocs, onSnapshot, query, where,
} from 'firebase/firestore';

const ACTIVITY_COLLECTION = 'gfy_activity';
const USAGE_COLLECTION = 'gfy_app_usage';

// Document ids must match the ones the student app writes (see dataSync.js).
const liveDocId = (studentId) => `${studentId}__live`;
const dailyDocId = (studentId, date) => `${studentId}__${dateKey(date)}`;

export function dateKey(date) {
  if (typeof date === 'string') return date;
  const d = date || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── Live desktop state ──────────────────────────────
export function subscribeToLive(studentId, callback, onError) {
  if (!db || !studentId) return () => {};
  return onSnapshot(
    doc(db, USAGE_COLLECTION, liveDocId(studentId)),
    (snap) => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    (error) => {
      console.error('Live listener error:', error);
      if (onError) onError(error);
    }
  );
}

export async function getLive(studentId) {
  if (!db || !studentId) return null;
  try {
    const snap = await getDoc(doc(db, USAGE_COLLECTION, liveDocId(studentId)));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (error) {
    console.error('Error fetching live state:', error);
    return null;
  }
}

// ── Daily rollup ────────────────────────────────────
export function subscribeToDaily(studentId, date, callback, onError) {
  if (!db || !studentId) return () => {};
  return onSnapshot(
    doc(db, USAGE_COLLECTION, dailyDocId(studentId, date)),
    (snap) => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    (error) => {
      console.error('Daily listener error:', error);
      if (onError) onError(error);
    }
  );
}

export async function getDaily(studentId, date) {
  if (!db || !studentId) return null;
  try {
    const snap = await getDoc(doc(db, USAGE_COLLECTION, dailyDocId(studentId, date)));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (error) {
    console.error('Error fetching daily summary:', error);
    return null;
  }
}

// Pulls a run of days for one student. Reads by id in parallel, so it stays
// index-free no matter how wide the range is.
export async function getDailyRange(studentId, days = 7) {
  if (!db || !studentId) return [];
  const keys = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    keys.push(dateKey(d));
  }

  const results = await Promise.all(keys.map(async (key) => {
    try {
      const snap = await getDoc(doc(db, USAGE_COLLECTION, dailyDocId(studentId, key)));
      return snap.exists()
        ? { date: key, ...snap.data() }
        : { date: key, studySeconds: 0, totalActiveSeconds: 0, apps: [], titles: [] };
    } catch (error) {
      return { date: key, studySeconds: 0, totalActiveSeconds: 0, apps: [], titles: [] };
    }
  }));

  return results;
}

// ── History snapshots ───────────────────────────────
// Equality filter only; ordering is done in memory.
export async function getActivityHistory(studentId, limit = 200) {
  if (!db || !studentId) return [];
  try {
    const snapshot = await getDocs(query(
      collection(db, ACTIVITY_COLLECTION),
      where('studentId', '==', studentId)
    ));
    return snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
      .slice(0, limit);
  } catch (error) {
    console.error('Error fetching activity history:', error);
    return [];
  }
}

// Kept for compatibility with the previous API shape.
export function subscribeToActivity(studentId, callback, onError) {
  return subscribeToLive(studentId, callback, onError);
}

export async function getAppUsage(studentId, date) {
  const daily = await getDaily(studentId, date);
  return (daily && daily.apps) || [];
}

export function subscribeToAppUsage(studentId, date, callback) {
  return subscribeToDaily(studentId, date, (daily) => callback((daily && daily.apps) || []));
}
