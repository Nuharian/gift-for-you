// Activity service — Firestore operations for activity monitoring data
import { db } from './firebase';
import {
  collection, doc, getDocs, setDoc, onSnapshot,
  query, orderBy, where, limit as firestoreLimit,
} from 'firebase/firestore';

const ACTIVITY_COLLECTION = 'gfy_activity';
const APP_USAGE_COLLECTION = 'gfy_app_usage';
const DAILY_SUMMARY_COLLECTION = 'gfy_daily_summaries';

// Subscribe to latest activity for a student (real-time)
export function subscribeToActivity(studentId, callback) {
  if (!db) return () => {};
  const q = query(
    collection(db, ACTIVITY_COLLECTION),
    where('studentId', '==', studentId),
    orderBy('timestamp', 'desc'),
    firestoreLimit(1)
  );
  return onSnapshot(q, (snapshot) => {
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      callback({ id: doc.id, ...doc.data() });
    }
  });
}

// Get activity history for a student on a specific date
export async function getActivityHistory(studentId, date) {
  if (!db) return [];
  try {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const q = query(
      collection(db, ACTIVITY_COLLECTION),
      where('studentId', '==', studentId),
      where('timestamp', '>=', startOfDay.toISOString()),
      where('timestamp', '<=', endOfDay.toISOString()),
      orderBy('timestamp', 'desc')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('Error fetching activity history:', error);
    return [];
  }
}

// Get app usage for a student on a specific date
export async function getAppUsage(studentId, date) {
  if (!db) return [];
  try {
    const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
    const q = query(
      collection(db, APP_USAGE_COLLECTION),
      where('studentId', '==', studentId),
      where('date', '==', dateStr),
      orderBy('totalActiveSeconds', 'desc')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('Error fetching app usage:', error);
    return [];
  }
}

// Subscribe to app usage in real-time
export function subscribeToAppUsage(studentId, date, callback) {
  if (!db) return () => {};
  const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
  const q = query(
    collection(db, APP_USAGE_COLLECTION),
    where('studentId', '==', studentId),
    where('date', '==', dateStr)
  );
  return onSnapshot(q, (snapshot) => {
    const usage = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.totalActiveSeconds || 0) - (a.totalActiveSeconds || 0));
    callback(usage);
  });
}

// Get daily summaries for a student
export async function getDailySummaries(studentId, fromDate, toDate) {
  if (!db) return [];
  try {
    let q = query(
      collection(db, DAILY_SUMMARY_COLLECTION),
      where('studentId', '==', studentId),
      orderBy('date', 'desc')
    );

    if (fromDate) {
      q = query(q, where('date', '>=', fromDate));
    }
    if (toDate) {
      q = query(q, where('date', '<=', toDate));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('Error fetching daily summaries:', error);
    return [];
  }
}
