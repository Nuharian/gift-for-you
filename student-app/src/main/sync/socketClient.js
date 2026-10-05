// Real-time listener for teacher messages.
//
// The query filters on studentId only. Firestore serves a single equality
// filter from its automatic index; adding `where('isRead','==',false)` plus
// `orderBy('sentAt')` required a composite index that was never deployed, so
// the previous listener failed on every start and no message ever arrived.
// Sorting and unread filtering happen here instead.
const { Notification } = require('electron');
const { getDb } = require('../firebase');
const routineScheduler = require('../routine/routineScheduler');

// Routines share gfy_messages with chat messages, tagged by `kind`.
function isRoutine(message) {
  return !!message && message.kind === 'routine';
}

let unsubscribeMessages = null;
let seededIds = null;
let studentIdRef = null;
let onMessagesChanged = null;

function setupFirebaseListeners(studentId, mainWindow, onChange) {
  const db = getDb();
  if (!db || !studentId) {
    console.warn('Firebase not ready for listeners');
    return;
  }

  studentIdRef = studentId;
  onMessagesChanged = onChange || null;
  stopFirebaseListeners();

  const { collection, query, where, onSnapshot } = require('firebase/firestore');

  const messagesQuery = query(
    collection(db, 'gfy_messages'),
    where('studentId', '==', studentId)
  );

  unsubscribeMessages = onSnapshot(
    messagesQuery,
    (snapshot) => {
      const everything = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((m) => m.from !== 'student')
        .sort((a, b) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')));
      const all = everything.filter((m) => !isRoutine(m));
      const routines = everything.filter(isRoutine);

      // The first snapshot is the existing backlog. Remember those ids so
      // starting the app doesn't replay every message the teacher ever sent,
      // but still surface anything genuinely new that arrives afterwards.
      if (seededIds === null) {
        seededIds = new Set(everything.map((m) => m.id));
      } else {
        for (const change of snapshot.docChanges()) {
          if (change.type !== 'added') continue;
          const msg = { id: change.doc.id, ...change.doc.data() };
          if (msg.from === 'student' || seededIds.has(msg.id)) continue;
          seededIds.add(msg.id);
          if (isRoutine(msg)) deliverRoutine(msg, mainWindow);
          else deliver(msg, mainWindow);
        }
      }

      routineScheduler.setRoutines(routines);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('messages:sync', {
          messages: all,
          unread: all.filter((m) => !m.isRead).length,
        });
        mainWindow.webContents.send('routines:sync', {
          routines,
          today: routineScheduler.getToday(),
          pending: routines.filter((r) => !r.status || r.status === 'pending').length,
        });
      }
      if (onMessagesChanged) onMessagesChanged(all);
    },
    (error) => {
      console.error('Message listener error:', error.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('connection:status', { connected: false, error: error.message });
      }
    }
  );

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('connection:status', { connected: true });
  }

  console.log('🔌 Firebase real-time listeners active');
}

function deliver(message, mainWindow) {
  console.log('💬 New teacher message:', message.title || '(no title)');

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('message:new', message);
    // Urgent messages pull the window forward; everything else waits in the
    // tray so the student is not yanked out of what they are doing.
    if (message.priority === 'urgent') {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.flashFrame(true);
    }
  }

  try {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: (message.emoji || '💛') + ' ' + (message.title || 'Message from your teacher'),
        body: message.body || '',
        urgency: message.priority === 'urgent' ? 'critical' : 'normal',
        silent: false,
      });
      notification.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      });
      notification.show();
    }
  } catch (e) {
    // Notifications are a nicety; never let them break delivery.
  }
}

// A new routine asks the student to accept it before any reminder runs.
function deliverRoutine(routine, mainWindow) {
  console.log('🗓️ New routine from teacher:', routine.title || '(untitled)');

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('routine:new', routine);
    mainWindow.flashFrame(true);
  }

  try {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: '🗓️ New routine: ' + (routine.title || 'Daily routine'),
        body: 'Your teacher sent you a routine. Open Gift For You to accept or decline it.',
        silent: false,
      });
      notification.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('routine:open');
        }
      });
      notification.show();
    }
  } catch (e) {
    // The in-app popup and badge still announce it.
  }
}

// The answer is written onto the routine itself, which the teacher's
// dashboard is already watching.
async function respondToRoutine(routineId, accept) {
  const db = getDb();
  if (!db || !routineId) return { success: false, error: 'Not connected' };
  try {
    const { doc, updateDoc } = require('firebase/firestore');
    const now = new Date().toISOString();
    await updateDoc(doc(db, 'gfy_messages', routineId), {
      status: accept ? 'accepted' : 'declined',
      respondedAt: now,
      isRead: true,
      readAt: now,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Student → teacher replies land in the same collection, tagged `from`.
async function sendReply(text, studentName) {
  const db = getDb();
  if (!db || !studentIdRef || !text || !text.trim()) {
    return { success: false, error: 'Not connected' };
  }
  try {
    const { doc, setDoc } = require('firebase/firestore');
    const id = 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    await setDoc(doc(db, 'gfy_messages', id), {
      id,
      studentId: studentIdRef,
      studentName: studentName || '',
      from: 'student',
      title: '',
      body: text.trim().slice(0, 2000),
      emoji: '🙋',
      color: '#45B7D1',
      priority: 'normal',
      sentAt: new Date().toISOString(),
      isRead: true,       // nothing to show the student
      readByTeacher: false,
      readAt: null,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function stopFirebaseListeners() {
  if (unsubscribeMessages) {
    unsubscribeMessages();
    unsubscribeMessages = null;
  }
  seededIds = null;
}

module.exports = {
  setupFirebaseListeners, stopFirebaseListeners, sendReply, respondToRoutine, isRoutine,
};
