// Student service — roster and presence.
//
// Every query here is either a whole-collection read or a document read.
// Nothing combines a filter with an orderBy on another field, so no composite
// index has to exist for the dashboard to work.
import { db } from './firebase';
import { collection, doc, getDocs, getDoc, onSnapshot } from 'firebase/firestore';

const STUDENTS_COLLECTION = 'gfy_students';

// A student whose heartbeat is older than this is treated as offline, even if
// the app never got the chance to write isOnline:false (crash, lost power).
export const OFFLINE_AFTER_MS = 45 * 1000;

function sortByName(students) {
  return students.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

// Derives the status actually shown, so a stale record can never keep a
// student pinned to "studying" forever.
export function decorateStudent(student, now = Date.now()) {
  const lastSeenMs = student.lastSeenMs
    || (student.lastSeen ? new Date(student.lastSeen).getTime() : 0);
  const isStale = !lastSeenMs || (now - lastSeenMs) > OFFLINE_AFTER_MS;
  const isOnline = !!student.isOnline && !isStale;

  // While a session is running the elapsed count keeps growing between
  // heartbeats; extrapolate so the dashboard clock ticks smoothly.
  let liveSessionSeconds = student.currentSessionSeconds || 0;
  let liveTodaySeconds = student.todayStudySeconds || 0;
  if (isOnline && student.studyRunning && lastSeenMs) {
    const drift = Math.max(0, Math.floor((now - lastSeenMs) / 1000));
    liveSessionSeconds += drift;
    liveTodaySeconds += drift;
  }

  // A clean quit writes isOnline:false on the way out. A record still claiming
  // to be online while its heartbeat has aged out therefore means the app
  // stopped without shutting down — it crashed, lost its connection, or the
  // machine went off. That is a fault worth showing the teacher, because it
  // looks identical to "went home" otherwise and can go unnoticed for days.
  const stoppedUnexpectedly = !!student.isOnline && isStale;

  return {
    ...student,
    lastSeenMs,
    isOnline,
    isStale,
    stoppedUnexpectedly,
    status: isOnline ? (student.status || 'online') : 'offline',
    liveSessionSeconds,
    liveTodaySeconds,
  };
}

export async function getAllStudents() {
  if (!db) return [];
  try {
    const snapshot = await getDocs(collection(db, STUDENTS_COLLECTION));
    return sortByName(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (error) {
    console.error('Error fetching students:', error);
    return [];
  }
}

export function subscribeToStudents(callback, onError) {
  if (!db) return () => {};
  return onSnapshot(
    collection(db, STUDENTS_COLLECTION),
    (snapshot) => callback(sortByName(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })))),
    (error) => {
      console.error('Students listener error:', error);
      if (onError) onError(error);
    }
  );
}

export async function getStudent(studentId) {
  if (!db) return null;
  try {
    const docSnap = await getDoc(doc(db, STUDENTS_COLLECTION, studentId));
    return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
  } catch (error) {
    console.error('Error fetching student:', error);
    return null;
  }
}

export function subscribeToStudent(studentId, callback) {
  if (!db) return () => {};
  return onSnapshot(doc(db, STUDENTS_COLLECTION, studentId), (docSnap) => {
    if (docSnap.exists()) callback({ id: docSnap.id, ...docSnap.data() });
  });
}
