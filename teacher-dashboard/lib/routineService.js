// Routine service — the teacher sends a daily routine, the student accepts or
// declines it, and an accepted routine drives the student app's reminders.
//
// Routines live in gfy_messages tagged `kind: 'routine'`. The live Firestore
// rules only admit the existing collections, so a new one would be rejected;
// riding on gfy_messages also means the student app's existing listener
// already receives them. Older app versions that predate routines simply show
// one as an ordinary message, which is why `body` carries a readable summary.
import { db } from './firebase';
import { doc, deleteDoc, writeBatch } from 'firebase/firestore';

const MESSAGES_COLLECTION = 'gfy_messages';

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function generateId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function isRoutine(message) {
  return !!message && message.kind === 'routine';
}

export function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

export function fromMinutes(total) {
  const t = ((total % 1440) + 1440) % 1440;
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}

export function formatDuration(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  if (m < 60) return m + 'm';
  return Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
}

export function formatDays(days) {
  const set = [...new Set(days || [])].sort();
  if (set.length === 0 || set.length === 7) return 'Every day';
  if (set.join() === '1,2,3,4,5') return 'Weekdays';
  if (set.join() === '0,6') return 'Weekends';
  return set.map((d) => DAY_NAMES[d]).join(', ');
}

export function sortTasks(tasks) {
  return [...(tasks || [])].sort((a, b) => (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0));
}

// Plain-text version of the routine, shown by app versions without a routine
// panel and useful anywhere a one-glance summary is needed.
export function summarizeRoutine(routine) {
  const lines = sortTasks(routine.tasks).map((t) =>
    `${t.start} — ${t.title} (${formatDuration(t.durationMin)})`);
  return `${formatDays(routine.days)}\n${lines.join('\n')}`;
}

// Drops empty rows and clamps values, so a half-filled builder never sends a
// task the student app cannot schedule.
export function cleanTasks(tasks) {
  return sortTasks(
    (tasks || [])
      .filter((t) => String(t.title || '').trim() && toMinutes(t.start) !== null)
      .map((t) => ({
        id: t.id || generateId('task'),
        title: String(t.title).trim().slice(0, 120),
        start: t.start,
        durationMin: Math.min(600, Math.max(1, Math.round(Number(t.durationMin) || 30))),
        note: String(t.note || '').trim().slice(0, 300),
      }))
  );
}

// One batched commit for the whole class, like a broadcast message.
export async function sendRoutine(students, routine) {
  if (!db || !students || students.length === 0) return 0;
  const tasks = cleanTasks(routine.tasks);
  if (tasks.length === 0) return 0;

  const days = routine.days && routine.days.length ? [...routine.days].sort() : ALL_DAYS;
  const title = String(routine.title || '').trim() || 'Daily routine';
  const sentAt = new Date().toISOString();
  const body = summarizeRoutine({ tasks, days });
  let sent = 0;

  for (let i = 0; i < students.length; i += 400) {
    const chunk = students.slice(i, i + 400);
    const batch = writeBatch(db);
    for (const student of chunk) {
      const id = generateId('rtn');
      batch.set(doc(db, MESSAGES_COLLECTION, id), {
        id,
        kind: 'routine',
        studentId: student.id,
        studentName: student.name || '',
        from: 'teacher',
        title,
        body,
        emoji: '🗓️',
        color: '#E2D1F9',
        priority: 'normal',
        days,
        tasks,
        status: 'pending',
        respondedAt: null,
        sentAt,
        readAt: null,
        isRead: false,
      });
    }
    await batch.commit();
    sent += chunk.length;
  }
  return sent;
}

export async function deleteRoutine(routineId) {
  if (!db || !routineId) return;
  try {
    await deleteDoc(doc(db, MESSAGES_COLLECTION, routineId));
  } catch (error) {
    console.error('Error deleting routine:', error);
  }
}
