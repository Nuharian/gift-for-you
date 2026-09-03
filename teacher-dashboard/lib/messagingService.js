// Messaging service — two-way teacher ↔ student messages.
//
// Queries filter on studentId only (or read the whole collection) and sort in
// memory, so messaging works without deploying any composite index.
import { db } from './firebase';
import {
  collection, doc, getDocs, setDoc, deleteDoc,
  onSnapshot, query, where, updateDoc, writeBatch,
} from 'firebase/firestore';

const MESSAGES_COLLECTION = 'gfy_messages';

function generateId() {
  return 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function sortNewestFirst(messages) {
  return messages.sort((a, b) => String(b.sentAt || '').localeCompare(String(a.sentAt || '')));
}

export async function sendMessage(studentId, message) {
  if (!db || !studentId) return null;
  try {
    const id = generateId();
    const newMsg = {
      id,
      studentId,
      from: 'teacher',
      title: message.title || '',
      body: message.body || '',
      emoji: message.emoji || '💛',
      color: message.color || '#FFE5D9',
      priority: message.priority || 'normal',
      sentAt: new Date().toISOString(),
      readAt: null,
      isRead: false,
    };
    await setDoc(doc(db, MESSAGES_COLLECTION, id), newMsg);
    return newMsg;
  } catch (error) {
    console.error('Error sending message:', error);
    return null;
  }
}

// One batched commit rather than a write per student, so a class of 30 is a
// single round trip and either all of them get the message or none do.
export async function broadcastMessage(studentIds, message) {
  if (!db || !studentIds || studentIds.length === 0) return 0;
  try {
    const sentAt = new Date().toISOString();
    let sent = 0;

    // Firestore caps a batch at 500 writes.
    for (let i = 0; i < studentIds.length; i += 400) {
      const chunk = studentIds.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const studentId of chunk) {
        const id = generateId();
        batch.set(doc(db, MESSAGES_COLLECTION, id), {
          id,
          studentId,
          from: 'teacher',
          title: message.title || '',
          body: message.body || '',
          emoji: message.emoji || '💛',
          color: message.color || '#FFE5D9',
          priority: message.priority || 'normal',
          sentAt,
          readAt: null,
          isRead: false,
        });
      }
      await batch.commit();
      sent += chunk.length;
    }
    return sent;
  } catch (error) {
    console.error('Error broadcasting:', error);
    return 0;
  }
}

export async function getMessages(studentId) {
  if (!db || !studentId) return [];
  try {
    const snapshot = await getDocs(query(
      collection(db, MESSAGES_COLLECTION),
      where('studentId', '==', studentId)
    ));
    return sortNewestFirst(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (error) {
    console.error('Error fetching messages:', error);
    return [];
  }
}

export function subscribeToMessages(studentId, callback, onError) {
  if (!db || !studentId) return () => {};
  return onSnapshot(
    query(collection(db, MESSAGES_COLLECTION), where('studentId', '==', studentId)),
    (snapshot) => callback(sortNewestFirst(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })))),
    (error) => {
      console.error('Messages listener error:', error);
      if (onError) onError(error);
    }
  );
}

// Watches every student's messages at once so the dashboard can badge unread
// student replies without opening each conversation.
export function subscribeToAllMessages(callback, onError) {
  if (!db) return () => {};
  return onSnapshot(
    collection(db, MESSAGES_COLLECTION),
    (snapshot) => callback(sortNewestFirst(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })))),
    (error) => {
      console.error('All-messages listener error:', error);
      if (onError) onError(error);
    }
  );
}

export async function markAsRead(messageId) {
  if (!db || !messageId) return;
  try {
    await updateDoc(doc(db, MESSAGES_COLLECTION, messageId), {
      isRead: true,
      readAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error marking message as read:', error);
  }
}

// Student replies are marked read on the teacher's side via readByTeacher, so
// the student's own unread state is never disturbed.
export async function markReplyRead(messageId) {
  if (!db || !messageId) return;
  try {
    await updateDoc(doc(db, MESSAGES_COLLECTION, messageId), {
      readByTeacher: true,
      readByTeacherAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error marking reply as read:', error);
  }
}

export async function markThreadRead(messages) {
  const unread = (messages || []).filter((m) => m.from === 'student' && !m.readByTeacher);
  await Promise.all(unread.map((m) => markReplyRead(m.id)));
  return unread.length;
}

export async function deleteMessage(messageId) {
  if (!db || !messageId) return;
  try {
    await deleteDoc(doc(db, MESSAGES_COLLECTION, messageId));
  } catch (error) {
    console.error('Error deleting message:', error);
  }
}

export async function getAllMessages() {
  if (!db) return [];
  try {
    const snapshot = await getDocs(collection(db, MESSAGES_COLLECTION));
    return sortNewestFirst(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (error) {
    console.error('Error fetching all messages:', error);
    return [];
  }
}

export async function getUnreadCount(studentId) {
  const messages = await getMessages(studentId);
  return messages.filter((m) => m.from !== 'student' && !m.isRead).length;
}
